//! Seedbox support: let a service download torrents and stream the files
//! from it over HTTPS instead of from the swarm.
//!
//! In "prefer" mode files come from the seedbox when it has them and from
//! peers otherwise. In "only" mode this machine never talks to peers at all;
//! even torrent metadata comes from the seedbox.

pub mod torbox;

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, bail};
use bytes::Bytes;
use serde::Serialize;

use crate::{settings::Settings, state::AppState};

const LIST_TTL: Duration = Duration::from_secs(20);
const PENDING_TTL: Duration = Duration::from_secs(3);
const LINK_TTL: Duration = Duration::from_secs(60 * 60);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Prefer,
    Only,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub api_key: String,
    pub mode: Mode,
    pub add_on_import: bool,
}

impl Config {
    pub async fn load(settings: &Settings) -> Option<Self> {
        if settings.get("seedbox_provider").await != "torbox" {
            return None;
        }
        let api_key = settings.get("seedbox_api_key").await;
        if api_key.trim().is_empty() {
            return None;
        }
        Some(Self {
            api_key: api_key.trim().to_string(),
            mode: if settings.get("seedbox_mode").await == "only" { Mode::Only } else { Mode::Prefer },
            add_on_import: settings.get("seedbox_add_on_import").await == "true",
        })
    }
}

/// Where a file's bytes come from right now.
pub enum FileSource {
    Swarm,
    Remote(String),
    /// Seedbox only, and it doesn't have the file yet.
    Pending(String),
}

/// What the seedbox has for one torrent.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum RemoteState {
    Missing,
    Downloading { progress: f64, detail: String },
    Ready,
}

pub struct Seedbox {
    api: torbox::TorBox,
    /// For relaying file bodies: no overall timeout, streams run for hours.
    stream: reqwest::Client,
    list: tokio::sync::Mutex<Option<(Instant, String, Vec<torbox::Torrent>)>>,
    links: Mutex<HashMap<(i64, i64), (String, Instant)>>,
}

impl Default for Seedbox {
    fn default() -> Self {
        Self::new()
    }
}

impl Seedbox {
    pub fn new() -> Self {
        Self {
            api: torbox::TorBox::new(),
            stream: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                .read_timeout(Duration::from_secs(60))
                .build()
                .expect("building HTTP client"),
            list: tokio::sync::Mutex::new(None),
            links: Mutex::new(HashMap::new()),
        }
    }

    pub fn stream_client(&self) -> &reqwest::Client {
        &self.stream
    }

    pub async fn is_cached(&self, key: &str, info_hash: &str) -> anyhow::Result<bool> {
        if self.find(key, info_hash).await?.is_some_and(|t| t.ready()) {
            return Ok(true);
        }
        self.api.is_cached(key, info_hash).await
    }

    pub async fn test(&self, key: &str) -> anyhow::Result<serde_json::Value> {
        self.api.me(key).await
    }

    async fn torrents(&self, key: &str, fresh: bool) -> anyhow::Result<Vec<torbox::Torrent>> {
        self.torrents_max_age(key, if fresh { Duration::ZERO } else { LIST_TTL }).await
    }

    async fn torrents_max_age(&self, key: &str, max_age: Duration) -> anyhow::Result<Vec<torbox::Torrent>> {
        let mut cache = self.list.lock().await;
        if let Some((at, k, list)) = cache.as_ref()
            && k == key
            && at.elapsed() < max_age
        {
            return Ok(list.clone());
        }
        let list = self.api.list(key).await?;
        *cache = Some((Instant::now(), key.to_string(), list.clone()));
        Ok(list)
    }

    async fn invalidate(&self) {
        *self.list.lock().await = None;
    }

    pub async fn find(&self, key: &str, info_hash: &str) -> anyhow::Result<Option<torbox::Torrent>> {
        let pick = |list: Vec<torbox::Torrent>| list.into_iter().find(|t| t.hash.eq_ignore_ascii_case(info_hash));
        let found = pick(self.torrents(key, false).await?);
        // Something still downloading changes quickly; don't trust an old answer.
        if found.as_ref().is_some_and(|t| !t.ready()) {
            return Ok(pick(self.torrents_max_age(key, PENDING_TTL).await?));
        }
        Ok(found)
    }

    /// State of every torrent in the account, by info hash.
    pub async fn states(&self, key: &str) -> anyhow::Result<HashMap<String, RemoteState>> {
        Ok(self
            .torrents(key, false)
            .await?
            .into_iter()
            .map(|t| (t.hash.to_ascii_lowercase(), state_of(&t)))
            .collect())
    }

    /// Make sure the seedbox has the torrent, adding it if needed.
    pub async fn ensure(
        &self,
        key: &str,
        info_hash: &str,
        magnet: Option<&str>,
        metainfo: Option<Bytes>,
    ) -> anyhow::Result<Option<torbox::Torrent>> {
        if let Some(t) = self.find(key, info_hash).await? {
            return Ok(Some(t));
        }
        tracing::info!(info_hash, "adding torrent to TorBox");
        self.api.add(key, magnet, metainfo).await?;
        self.invalidate().await;
        let list = self.torrents(key, true).await?;
        Ok(list.into_iter().find(|t| t.hash.eq_ignore_ascii_case(info_hash)))
    }

    async fn link(&self, key: &str, torrent_id: i64, file_id: i64) -> anyhow::Result<String> {
        if let Some((url, at)) = self.links.lock().unwrap().get(&(torrent_id, file_id))
            && at.elapsed() < LINK_TTL
        {
            return Ok(url.clone());
        }
        let url = self.api.download_link(key, torrent_id, file_id).await?;
        self.links
            .lock()
            .unwrap()
            .insert((torrent_id, file_id), (url.clone(), Instant::now()));
        Ok(url)
    }

    /// Forget a link that stopped working so the next request gets a new one.
    pub fn drop_link(&self, url: &str) {
        self.links.lock().unwrap().retain(|_, (u, _)| u != url);
    }

    /// Fetch a torrent's metadata through the seedbox (seedbox only mode).
    pub async fn resolve(&self, key: &str, info_hash: &str, magnet: &str) -> anyhow::Result<Bytes> {
        let deadline = Instant::now() + RESOLVE_TIMEOUT;
        let mut torrent = self.ensure(key, info_hash, Some(magnet), None).await?;
        loop {
            if let Some(t) = &torrent
                && !t.files.is_empty()
                && let Ok(bytes) = self.api.export_torrent(key, t.id).await
            {
                return Ok(bytes);
            }
            if Instant::now() > deadline {
                bail!("TorBox hasn't found the torrent's metadata yet");
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
            torrent = self.find_fresh(key, info_hash).await?;
        }
    }

    async fn find_fresh(&self, key: &str, info_hash: &str) -> anyhow::Result<Option<torbox::Torrent>> {
        let list = self.torrents(key, true).await?;
        Ok(list.into_iter().find(|t| t.hash.eq_ignore_ascii_case(info_hash)))
    }
}

fn state_of(t: &torbox::Torrent) -> RemoteState {
    if t.ready() {
        RemoteState::Ready
    } else {
        RemoteState::Downloading {
            progress: t.progress.clamp(0.0, 1.0),
            detail: t.download_state.clone(),
        }
    }
}

/// Match a file in the torrent (path relative to the torrent's root) to the
/// seedbox's copy, whose names include the torrent folder.
fn match_file<'a>(t: &'a torbox::Torrent, path: &str, size: u64) -> Option<&'a torbox::File> {
    let norm = |s: &str| s.replace('\\', "/").trim_start_matches('/').to_lowercase();
    let path = norm(path);
    let same_size: Vec<&torbox::File> = t.files.iter().filter(|f| f.size == size).collect();
    same_size
        .iter()
        .find(|f| {
            let n = norm(&f.name);
            n == path || n.ends_with(&format!("/{path}"))
        })
        .or_else(|| {
            let file_name = path.rsplit('/').next().unwrap_or(&path).to_string();
            same_size.iter().find(|f| norm(&f.short_name) == file_name)
        })
        .or_else(|| (same_size.len() == 1).then(|| &same_size[0]))
        .copied()
}

/// Decide where to read a file from, adding the torrent to the seedbox on
/// the way if it isn't there yet.
pub async fn locate(
    state: &AppState,
    info_hash: &str,
    magnet: Option<&str>,
    metainfo: Option<&[u8]>,
    path: &str,
    size: u64,
) -> FileSource {
    let Some(cfg) = Config::load(&state.settings).await else {
        return FileSource::Swarm;
    };
    let fallback = |msg: String| match cfg.mode {
        Mode::Prefer => FileSource::Swarm,
        Mode::Only => FileSource::Pending(msg),
    };
    let torrent = match state
        .seedbox
        .ensure(&cfg.api_key, info_hash, magnet, metainfo.map(Bytes::copy_from_slice))
        .await
    {
        Ok(Some(t)) => t,
        Ok(None) => return fallback("TorBox is queueing the torrent".into()),
        Err(e) => {
            tracing::warn!(info_hash, error = %format!("{e:#}"), "seedbox lookup failed");
            return fallback(format!("{e:#}"));
        }
    };
    if !torrent.ready() {
        return fallback(format!(
            "TorBox is downloading this ({:.0}%)",
            torrent.progress.clamp(0.0, 1.0) * 100.0
        ));
    }
    let Some(file) = match_file(&torrent, path, size) else {
        return fallback("TorBox's copy doesn't have this file".into());
    };
    match state.seedbox.link(&cfg.api_key, torrent.id, file.id).await {
        Ok(url) => FileSource::Remote(url),
        Err(e) => fallback(format!("{e:#}")),
    }
}

/// Fetch metadata through the seedbox when peers are off limits.
pub async fn resolve_metadata(state: &AppState, info_hash: &str, magnet: &str) -> anyhow::Result<Bytes> {
    let cfg = Config::load(&state.settings).await.context("no seedbox configured")?;
    state.seedbox.resolve(&cfg.api_key, info_hash, magnet).await
}

/// Hand a newly attached torrent to the seedbox so it's ready before anyone
/// presses play.
pub fn prefetch(state: &AppState, info_hash: String, magnet: String, metainfo: Option<Bytes>) {
    let state = state.clone();
    tokio::spawn(async move {
        let Some(cfg) = Config::load(&state.settings).await else { return };
        if !cfg.add_on_import {
            return;
        }
        if let Err(e) = state.seedbox.ensure(&cfg.api_key, &info_hash, Some(&magnet), metainfo).await {
            tracing::warn!(info_hash, error = %format!("{e:#}"), "couldn't add torrent to the seedbox");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: i64, name: &str, size: u64) -> torbox::File {
        torbox::File {
            id,
            name: name.into(),
            short_name: name.rsplit('/').next().unwrap().into(),
            size,
        }
    }

    #[test]
    fn matches_files() {
        let t = torbox::Torrent {
            id: 1,
            hash: "x".into(),
            download_state: String::new(),
            download_finished: true,
            download_present: true,
            progress: 1.0,
            files: vec![
                file(10, "Show.S01/Show.S01E01.mkv", 100),
                file(11, "Show.S01/Show.S01E02.mkv", 100),
                file(12, "Show.S01/Subs/en.srt", 5),
            ],
        };
        assert_eq!(match_file(&t, "Show.S01E02.mkv", 100).map(|f| f.id), Some(11));
        assert_eq!(match_file(&t, "Subs/en.srt", 5).map(|f| f.id), Some(12));
        assert!(match_file(&t, "Show.S01E03.mkv", 100).is_none());
    }
}
