use std::{net::SocketAddr, path::PathBuf};

use clap::Parser;

/// Built-in metadata keys so the app works out of the box. Admins can (and
/// should) replace these with their own from the settings page, or via the
/// `TMDB_API_KEY` / `TVDB_API_KEY` environment variables.
pub const DEFAULT_TMDB_API_KEY: &str = "6e6912d7ba759d3a299b4a78d6918ead";
pub const DEFAULT_TVDB_API_KEY: &str = "af67c48d-c88f-49b8-b134-9d24b807c0ba";

#[derive(Debug, Clone, Parser)]
#[command(name = "torrented", version, about)]
pub struct Config {
    /// Address the HTTP server listens on.
    #[arg(long, env = "TORRENTED_LISTEN", default_value = "0.0.0.0:8080")]
    pub listen: SocketAddr,

    /// Directory holding the databases and the streaming cache.
    #[arg(long, env = "TORRENTED_DATA_DIR", default_value = "./data")]
    pub data_dir: PathBuf,

    /// Serve the web UI from this directory instead of the copy embedded in
    /// the binary. Handy while working on the frontend.
    #[arg(long, env = "TORRENTED_WEB_DIR")]
    pub web_dir: Option<PathBuf>,

    /// TMDB API key (v3). Overridden by the value saved in settings.
    #[arg(long, env = "TMDB_API_KEY")]
    pub tmdb_api_key: Option<String>,

    /// TVDB API key (v4). Overridden by the value saved in settings.
    #[arg(long, env = "TVDB_API_KEY")]
    pub tvdb_api_key: Option<String>,

    /// Port used for incoming BitTorrent connections. Random if unset.
    #[arg(long, env = "TORRENTED_PEER_PORT")]
    pub peer_port: Option<u16>,

    /// Path to the ffmpeg binary used for probing and remuxing.
    #[arg(long, env = "TORRENTED_FFMPEG", default_value = "ffmpeg")]
    pub ffmpeg: String,

    /// Path to the ffprobe binary.
    #[arg(long, env = "TORRENTED_FFPROBE", default_value = "ffprobe")]
    pub ffprobe: String,

    /// Mark session cookies as `Secure` (enable when served over HTTPS).
    #[arg(long, env = "TORRENTED_SECURE_COOKIES", default_value_t = false)]
    pub secure_cookies: bool,
}

impl Config {
    pub fn main_db_path(&self) -> PathBuf {
        self.data_dir.join("main.db")
    }

    pub fn media_db_path(&self) -> PathBuf {
        self.data_dir.join("media.db")
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.data_dir.join("cache")
    }

    pub fn tmp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }
}
