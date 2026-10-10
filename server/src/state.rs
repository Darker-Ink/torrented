use std::{ops::Deref, sync::Arc, time::Instant};

use sqlx::SqlitePool;

use crate::{
    config::Config, metadata::Metadata, settings::Settings, streaming::ffmpeg::MediaTools,
    torrents::engine::TorrentEngine,
};

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

pub struct Inner {
    pub config: Config,
    pub main: SqlitePool,
    pub media: SqlitePool,
    pub settings: Settings,
    pub metadata: Metadata,
    pub engine: Arc<TorrentEngine>,
    pub tools: MediaTools,
    /// Random key that lets local helper processes (ffmpeg/ffprobe) read the
    /// raw stream endpoint without a user session.
    pub internal_key: String,
    /// Short-lived tokens that let devices without a session (Chromecast)
    /// read one torrent's files.
    pub stream_tokens: dashmap::DashMap<String, StreamToken>,
    pub started_at: Instant,
}

#[derive(Debug, Clone)]
pub struct StreamToken {
    pub user_id: i64,
    pub torrent_id: i64,
    pub expires: Instant,
}

impl AppState {
    pub fn new(inner: Inner) -> Self {
        Self(Arc::new(inner))
    }
}

impl Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Inner {
    /// URL that local helpers (ffmpeg/ffprobe) use to read a torrent file.
    pub fn internal_stream_url(&self, file_id: i64, purpose: StreamPurpose) -> String {
        let addr = self.config.listen;
        let host = match addr.ip() {
            ip if ip.is_unspecified() && ip.is_ipv4() => "127.0.0.1".to_string(),
            ip if ip.is_unspecified() => "[::1]".to_string(),
            std::net::IpAddr::V6(ip) => format!("[{ip}]"),
            ip => ip.to_string(),
        };
        format!(
            "http://{host}:{}/api/internal/files/{file_id}/raw?key={}&purpose={}",
            addr.port(),
            self.internal_key,
            purpose.as_str()
        )
    }
}

/// Why a helper process is reading a file; decides the read-ahead window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamPurpose {
    /// ffprobe reading headers: only fetch what it touches.
    Probe,
    /// ffmpeg remuxing/transcoding for a viewer.
    Playback,
}

impl StreamPurpose {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Probe => "probe",
            Self::Playback => "playback",
        }
    }
}

/// Read-ahead used while scanning files: enough for container headers.
pub const PROBE_READAHEAD: u64 = 4 * 1024 * 1024;
