mod audit;
mod auth;
mod config;
mod db;
mod error;
mod library;
mod metadata;
mod routes;
mod settings;
mod state;
mod streaming;
mod torrents;
mod util;

use std::{net::SocketAddr, time::Instant};

use anyhow::Context;
use clap::Parser;
use tracing_subscriber::EnvFilter;

use crate::{
    config::Config,
    metadata::Metadata,
    settings::Settings,
    state::{AppState, Inner},
    streaming::ffmpeg::MediaTools,
    torrents::engine::TorrentEngine,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,librqbit=warn,librqbit_dht=warn,tower_http=warn")),
        )
        .init();

    let config = Config::parse();
    tokio::fs::create_dir_all(&config.data_dir)
        .await
        .with_context(|| format!("creating data dir {}", config.data_dir.display()))?;
    tokio::fs::create_dir_all(config.tmp_dir()).await?;
    tracing::info!(data_dir = %config.data_dir.display(), "starting torrented {}", env!("CARGO_PKG_VERSION"));

    let main_db = db::open_pool(&config.main_db_path()).await?;
    let v = db::migrate_pool(&main_db, "main", db::main::MIGRATIONS).await?;
    tracing::info!(schema_version = v, "main database ready");

    let media_db = db::open_pool(&config.media_db_path()).await?;
    let v = db::migrate_pool(&media_db, "media", db::media::MIGRATIONS).await?;
    tracing::info!(schema_version = v, "media database ready");

    let settings = Settings::load(main_db.clone(), &config).await?;
    let tools = MediaTools::detect(&config.ffmpeg, &config.ffprobe).await;
    let engine = TorrentEngine::start(&config.data_dir, config.cache_dir(), config.peer_port).await?;

    let http = reqwest::Client::builder()
        .user_agent(concat!("torrented/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let state = AppState::new(Inner {
        config: config.clone(),
        main: main_db,
        media: media_db,
        settings,
        metadata: Metadata::new(http),
        engine: engine.clone(),
        tools,
        internal_key: util::random_token(32),
        started_at: Instant::now(),
    });

    {
        let st = state.clone();
        engine.spawn_sweeper(move || {
            let st = st.clone();
            async move {
                (
                    st.settings.idle_timeout().await,
                    st.settings.cache_max_bytes().await,
                )
            }
        });
    }
    torrents::scan::resume_jobs(&state).await;

    let app = routes::router(state.clone());
    let listener = tokio::net::TcpListener::bind(config.listen)
        .await
        .with_context(|| format!("binding {}", config.listen))?;
    let shown = if config.listen.ip().is_unspecified() {
        format!("http://localhost:{}", config.listen.port())
    } else {
        format!("http://{}", config.listen)
    };
    tracing::info!("listening on {shown}");

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("shutting down");
    engine.shutdown().await;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
