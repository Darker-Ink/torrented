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
    pub started_at: Instant,
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
