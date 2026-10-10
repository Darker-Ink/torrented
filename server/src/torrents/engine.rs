//! BitTorrent engine wrapper.
//!
//! Torrents are never fully downloaded. When somebody starts streaming a file
//! the torrent is added to the session with only that file selected, pieces
//! are fetched in the order the reader needs them, and once nobody has read
//! from the torrent for a while it is removed again together with its cached
//! pieces. The cache directory is wiped on startup, so nothing accumulates.

use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, bail};
use bytes::Bytes;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, DhtSessionConfig, ListenerMode,
    ListenerOptions, ManagedTorrent, Session, SessionOptions,
    api::TorrentIdOrHash,
    dht::DhtPersistenceConfig,
};
use serde::Serialize;

const RESOLVE_TIMEOUT: Duration = Duration::from_secs(120);
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
/// Always keep a just-touched torrent around for at least this long, even if
/// the cache is over its limit, so seeking doesn't thrash.
const MIN_LINGER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub enum TorrentSource {
    Magnet(String),
    File(Bytes),
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedFile {
    pub index: usize,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct ResolvedTorrent {
    pub info_hash: String,
    pub name: String,
    pub total_size: u64,
    pub piece_length: u32,
    pub files: Vec<ResolvedFile>,
    pub torrent_bytes: Bytes,
    pub trackers: Vec<String>,
}

struct Entry {
    handle: Arc<ManagedTorrent>,
    name: String,
    selected: HashSet<usize>,
    leases: HashMap<usize, usize>,
    last_access: Instant,
    started: Instant,
}

impl Entry {
    fn active(&self) -> usize {
        self.leases.values().sum()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ActiveTorrent {
    pub info_hash: String,
    pub name: String,
    pub active_streams: usize,
    pub files: Vec<usize>,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub peers: usize,
    pub cache_bytes: u64,
    pub idle_seconds: u64,
    pub age_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileProgress {
    pub info_hash: String,
    pub file_index: usize,
    pub size: u64,
    pub downloaded: u64,
    pub download_mbps: f64,
    pub peers: usize,
}

pub struct TorrentEngine {
    session: Arc<Session>,
    static_peers: Vec<SocketAddr>,
    cache_dir: PathBuf,
    entries: Mutex<HashMap<String, Entry>>,
    add_lock: tokio::sync::Mutex<()>,
}


impl TorrentEngine {
    pub async fn start(
        data_dir: &Path,
        cache_dir: PathBuf,
        peer_port: Option<u16>,
        static_peers: Vec<SocketAddr>,
    ) -> anyhow::Result<Arc<Self>> {
        // Nothing in the cache survives a restart.
        if cache_dir.exists() {
            tokio::fs::remove_dir_all(&cache_dir)
                .await
                .with_context(|| format!("clearing cache dir {}", cache_dir.display()))?;
        }
        tokio::fs::create_dir_all(&cache_dir).await?;

        let listen_addr: SocketAddr = ([0, 0, 0, 0], peer_port.unwrap_or(0)).into();
        // Local service discovery always uses IPv6 multicast.
        let ipv6 = std::net::UdpSocket::bind("[::]:0").is_ok();
        if !ipv6 {
            tracing::info!("IPv6 is unavailable on this host; using IPv4 only");
        }
        let opts = SessionOptions {
            dht: Some(DhtSessionConfig {
                persistence: Some(DhtPersistenceConfig {
                    dump_interval: None,
                    config_filename: Some(data_dir.join("dht.json")),
                }),
                ..Default::default()
            }),
            fastresume: false,
            persistence: None,
            listen: Some(ListenerOptions {
                mode: ListenerMode::TcpAndUtp,
                listen_addr,
                enable_upnp_port_forwarding: true,
                ipv4_only: true,
                ..Default::default()
            }),
            ipv4_only: true,
            disable_local_service_discovery: !ipv6,
            // Each open stream holds one of these permits while it's alive.
            runtime_worker_threads: Some(256),
            peer_limit: Some(120),
            client_name_and_version: Some(format!("torrented/{}", env!("CARGO_PKG_VERSION"))),
            ..Default::default()
        };
        // Never download more than active streams are about to read.
        librqbit::set_stream_only(true);
        let session = Session::new_with_opts(cache_dir.clone(), opts)
            .await
            .context("starting torrent session")?;
        tracing::info!(listen = ?session.listen_addr(), "torrent session started");

        Ok(Arc::new(Self {
            session,
            static_peers,
            cache_dir,
            entries: Mutex::new(HashMap::new()),
            add_lock: tokio::sync::Mutex::new(()),
        }))
    }

    fn initial_peers(&self) -> Option<Vec<SocketAddr>> {
        (!self.static_peers.is_empty()).then(|| self.static_peers.clone())
    }

    pub fn listen_addr(&self) -> Option<SocketAddr> {
        self.session.listen_addr()
    }

    /// Fetch a torrent's metadata (from the file itself, or from peers for a
    /// magnet link) without downloading any content.
    pub async fn resolve(&self, source: TorrentSource) -> anyhow::Result<ResolvedTorrent> {
        let (add, magnet_trackers) = match &source {
            TorrentSource::Magnet(m) => {
                let trackers = url::Url::parse(m)
                    .map(|u| {
                        u.query_pairs()
                            .filter(|(k, _)| k == "tr")
                            .map(|(_, v)| v.into_owned())
                            .collect()
                    })
                    .unwrap_or_default();
                (AddTorrent::from_url(m.clone()), trackers)
            }
            TorrentSource::File(b) => (AddTorrent::from_bytes(b.clone()), Vec::new()),
        };
        let opts = AddTorrentOptions {
            list_only: true,
            initial_peers: self.initial_peers(),
            ..Default::default()
        };
        let res = tokio::time::timeout(RESOLVE_TIMEOUT, self.session.add_torrent(add, Some(opts)))
            .await
            .map_err(|_| anyhow::anyhow!("timed out fetching torrent metadata from peers"))??;

        match res {
            AddTorrentResponse::ListOnly(r) => {
                let info = &r.info;
                let mut trackers: Vec<String> = magnet_trackers;
                if let Ok(parsed) = librqbit::torrent_from_bytes(&r.torrent_bytes) {
                    for t in parsed.iter_announce() {
                        let t = String::from_utf8_lossy(t.as_ref()).into_owned();
                        if !trackers.contains(&t) {
                            trackers.push(t);
                        }
                    }
                }
                let files = info
                    .iter_file_details_ext()
                    .enumerate()
                    .filter(|(_, f)| !f.details.attrs().padding)
                    .map(|(index, f)| ResolvedFile {
                        index,
                        path: f.details.filename.to_vec().join("/"),
                        size: f.details.len,
                    })
                    .collect::<Vec<_>>();
                let total_size = files.iter().map(|f| f.size).sum();
                Ok(ResolvedTorrent {
                    info_hash: r.info_hash.as_string(),
                    name: info
                        .name()
                        .map(|n| n.into_owned())
                        .unwrap_or_else(|| r.info_hash.as_string()),
                    total_size,
                    piece_length: info.info().piece_length,
                    files,
                    torrent_bytes: r.torrent_bytes,
                    trackers,
                })
            }
            AddTorrentResponse::AlreadyManaged(_, handle) | AddTorrentResponse::Added(_, handle) => {
                let metadata = handle
                    .metadata
                    .load_full()
                    .context("torrent metadata not available yet")?;
                let files = metadata
                    .file_infos
                    .iter()
                    .enumerate()
                    .filter(|(_, f)| !f.attrs.padding)
                    .map(|(index, f)| ResolvedFile {
                        index,
                        path: f
                            .relative_filename
                            .components()
                            .map(|c| c.as_os_str().to_string_lossy().into_owned())
                            .collect::<Vec<_>>()
                            .join("/"),
                        size: f.len,
                    })
                    .collect::<Vec<_>>();
                Ok(ResolvedTorrent {
                    info_hash: handle.info_hash().as_string(),
                    name: handle.name().unwrap_or_else(|| handle.info_hash().as_string()),
                    total_size: files.iter().map(|f| f.size).sum(),
                    piece_length: metadata.info.info().piece_length,
                    files,
                    torrent_bytes: metadata.torrent_bytes.clone(),
                    trackers: Vec::new(),
                })
            }
        }
    }

    /// Make sure `file_index` of the torrent is being fetched and return a
    /// lease that keeps the torrent alive while held.
    pub async fn acquire(
        self: &Arc<Self>,
        info_hash: &str,
        torrent_bytes: Bytes,
        file_index: usize,
    ) -> anyhow::Result<Lease> {
        let _guard = self.add_lock.lock().await;
        let existing = {
            let mut entries = self.entries.lock().unwrap();
            entries.get_mut(info_hash).map(|e| {
                *e.leases.entry(file_index).or_default() += 1;
                e.last_access = Instant::now();
                let newly_selected = e.selected.insert(file_index);
                (e.handle.clone(), newly_selected, e.selected.clone())
            })
        };

        let lease = Lease {
            engine: self.clone(),
            info_hash: info_hash.to_string(),
            file_index,
        };

        if let Some((handle, newly_selected, selected)) = existing {
            if newly_selected {
                self.session.update_only_files(&handle, &selected).await?;
            }
            if handle.is_paused() {
                self.session.unpause(&handle).await?;
            }
            return Ok(lease);
        }

        let output = self.cache_dir.join(info_hash);
        let opts = AddTorrentOptions {
            only_files: Some(vec![file_index]),
            overwrite: true,
            output_folder: Some(output.to_string_lossy().into_owned()),
            initial_peers: self.initial_peers(),
            ..Default::default()
        };
        let res = self
            .session
            .add_torrent(AddTorrent::from_bytes(torrent_bytes), Some(opts))
            .await;
        let handle = match res {
            Ok(r) => r.into_handle().context("torrent was not added")?,
            Err(e) => {
                std::mem::forget(lease);
                return Err(e);
            }
        };
        if let Err(e) = tokio::time::timeout(INIT_TIMEOUT, handle.wait_until_initialized())
            .await
            .map_err(|_| anyhow::anyhow!("torrent took too long to initialize"))
            .and_then(|r| r)
        {
            std::mem::forget(lease);
            let _ = self.session.delete(handle.id().into(), true).await;
            return Err(e);
        }

        let now = Instant::now();
        self.entries.lock().unwrap().insert(
            info_hash.to_string(),
            Entry {
                name: handle.name().unwrap_or_else(|| info_hash.to_string()),
                handle,
                selected: HashSet::from([file_index]),
                leases: HashMap::from([(file_index, 1)]),
                last_access: now,
                started: now,
            },
        );
        Ok(lease)
    }

    /// Open a reader for the leased file. Only `readahead` bytes past the
    /// read position are ever requested from peers.
    pub async fn open_stream(&self, lease: &Lease, readahead: u64) -> anyhow::Result<librqbit::FileStream> {
        let handle = self
            .entries
            .lock()
            .unwrap()
            .get(&lease.info_hash)
            .map(|e| e.handle.clone())
            .context("torrent is no longer active")?;
        let stream = handle.stream(lease.file_index).await?;
        stream.set_readahead(readahead);
        Ok(stream)
    }

    fn release(&self, info_hash: &str, file_index: usize) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(e) = entries.get_mut(info_hash) {
            if let Some(n) = e.leases.get_mut(&file_index) {
                *n = n.saturating_sub(1);
            }
            e.last_access = Instant::now();
        }
    }

    pub fn touch(&self, info_hash: &str) {
        if let Some(e) = self.entries.lock().unwrap().get_mut(info_hash) {
            e.last_access = Instant::now();
        }
    }

    pub fn file_progress(&self, info_hash: &str, file_index: usize) -> Option<FileProgress> {
        let handle = self.entries.lock().unwrap().get(info_hash)?.handle.clone();
        let stats = handle.stats();
        let (mbps, peers) = stats
            .live
            .as_ref()
            .map(|l| (l.download_speed.mbps, l.snapshot.peer_stats.live as usize))
            .unwrap_or((0.0, 0));
        let size = handle
            .metadata
            .load()
            .as_ref()
            .and_then(|m| m.file_infos.get(file_index).map(|f| f.len))
            .unwrap_or(0);
        Some(FileProgress {
            info_hash: info_hash.to_string(),
            file_index,
            size,
            downloaded: stats.file_progress.get(file_index).copied().unwrap_or(0),
            download_mbps: mbps,
            peers,
        })
    }

    pub fn active(&self) -> Vec<ActiveTorrent> {
        let entries = self.entries.lock().unwrap();
        entries
            .iter()
            .map(|(hash, e)| {
                let stats = e.handle.stats();
                let (down, up, peers) = stats
                    .live
                    .as_ref()
                    .map(|l| {
                        (l.download_speed.mbps, l.upload_speed.mbps, l.snapshot.peer_stats.live as usize)
                    })
                    .unwrap_or((0.0, 0.0, 0));
                let mut files: Vec<usize> = e.selected.iter().copied().collect();
                files.sort_unstable();
                ActiveTorrent {
                    info_hash: hash.clone(),
                    name: e.name.clone(),
                    active_streams: e.active(),
                    files,
                    downloaded_bytes: stats.progress_bytes,
                    uploaded_bytes: stats.uploaded_bytes,
                    download_mbps: down,
                    upload_mbps: up,
                    peers,
                    cache_bytes: dir_usage(&self.cache_dir.join(hash)),
                    idle_seconds: e.last_access.elapsed().as_secs(),
                    age_seconds: e.started.elapsed().as_secs(),
                }
            })
            .collect()
    }

    pub fn cache_usage(&self) -> u64 {
        dir_usage(&self.cache_dir)
    }

    /// Stop a torrent and delete its cached data.
    pub async fn evict(&self, info_hash: &str) -> anyhow::Result<()> {
        let entry = self.entries.lock().unwrap().remove(info_hash);
        if let Some(e) = entry {
            tracing::info!(info_hash, name = %e.name, "evicting torrent from cache");
            self.session
                .delete(TorrentIdOrHash::Id(e.handle.id()), true)
                .await?;
        }
        let dir = self.cache_dir.join(info_hash);
        if dir.exists() {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
        Ok(())
    }

    /// Evict idle torrents. Called periodically.
    pub async fn sweep(&self, idle_timeout: Duration, max_cache_bytes: u64) {
        let mut victims: Vec<String> = Vec::new();
        let mut idle: Vec<(Instant, String)> = Vec::new();
        {
            let entries = self.entries.lock().unwrap();
            for (hash, e) in entries.iter() {
                if e.active() > 0 {
                    continue;
                }
                if e.last_access.elapsed() >= idle_timeout {
                    victims.push(hash.clone());
                } else if e.last_access.elapsed() >= MIN_LINGER {
                    idle.push((e.last_access, hash.clone()));
                }
            }
        }
        for hash in &victims {
            if let Err(e) = self.evict(hash).await {
                tracing::warn!(info_hash = %hash, error = %e, "failed to evict torrent");
            }
        }

        // Over the size limit: drop the least recently used idle torrents.
        idle.sort();
        let mut usage = self.cache_usage();
        for (_, hash) in idle {
            if usage <= max_cache_bytes {
                break;
            }
            let freed = dir_usage(&self.cache_dir.join(&hash));
            if self.evict(&hash).await.is_ok() {
                usage = usage.saturating_sub(freed);
            }
        }
        if usage > max_cache_bytes {
            tracing::debug!(usage, max_cache_bytes, "stream cache over limit with active streams");
        }
    }

    pub fn spawn_sweeper<F, Fut>(self: &Arc<Self>, limits: F)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = (Duration, u64)> + Send,
    {
        let engine = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(15));
            loop {
                tick.tick().await;
                let Some(engine) = engine.upgrade() else { break };
                let (idle, max) = limits().await;
                engine.sweep(idle, max).await;
            }
        });
    }

    pub async fn shutdown(&self) {
        let hashes: Vec<String> = self.entries.lock().unwrap().keys().cloned().collect();
        for h in hashes {
            let _ = self.evict(&h).await;
        }
        self.session.stop().await;
    }
}

/// Keeps a torrent file selected and the torrent alive while held.
pub struct Lease {
    engine: Arc<TorrentEngine>,
    pub info_hash: String,
    pub file_index: usize,
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.engine.release(&self.info_hash, self.file_index);
    }
}

/// Bytes actually used on disk (cache files are sparse).
fn dir_usage(path: &Path) -> u64 {
    fn walk(path: &Path, total: &mut u64) {
        let Ok(rd) = std::fs::read_dir(path) else { return };
        for entry in rd.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                walk(&entry.path(), total);
            } else {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    *total += meta.blocks() * 512;
                }
                #[cfg(not(unix))]
                {
                    *total += meta.len();
                }
            }
        }
    }
    let mut total = 0;
    walk(path, &mut total);
    total
}

pub fn validate_magnet(s: &str) -> anyhow::Result<()> {
    if !s.starts_with("magnet:?") {
        bail!("not a magnet link");
    }
    if !s.contains("xt=urn:btih:") && !s.contains("xt=urn:btmh:") {
        bail!("magnet link has no info hash");
    }
    Ok(())
}
