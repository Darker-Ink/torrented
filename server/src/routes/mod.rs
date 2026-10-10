mod admin;
mod auth;
mod discover;
mod library;
mod network;
mod progress;
mod requests;
mod stream;
mod torrents;
mod users;

use axum::{
    Json, Router,
    body::Body,
    extract::DefaultBodyLimit,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;
use serde_json::json;
use tower_http::{
    compression::{CompressionLayer, Predicate},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

use crate::state::AppState;

#[derive(RustEmbed)]
#[folder = "../web/dist"]
struct WebAssets;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(discover::router())
        .merge(library::router())
        .merge(torrents::router())
        .merge(stream::router())
        .merge(progress::router())
        .merge(requests::router())
        .merge(admin::router())
        .merge(network::router())
        .fallback(api_not_found);

    let app = Router::new()
        .nest("/api", api)
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024));

    let app = match &state.config.web_dir {
        Some(dir) => {
            let index = dir.join("index.html");
            app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
        }
        None => app.fallback(embedded),
    };

    app.layer(
        CompressionLayer::new().compress_when(
            tower_http::compression::predicate::SizeAbove::new(1024)
                .and(tower_http::compression::predicate::NotForContentType::new("video/"))
                .and(tower_http::compression::predicate::NotForContentType::const_new("application/vnd.sqlite3")),
        ),
    )
    .layer(TraceLayer::new_for_http())
    .with_state(state)
}

async fn api_not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "no such endpoint" })))
}

fn asset_response(path: &str) -> Option<Response> {
    let file = WebAssets::get(path)?;
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Some(
        Response::builder()
            .header(header::CONTENT_TYPE, file.metadata.mimetype())
            .header(header::CACHE_CONTROL, cache)
            .body(Body::from(file.data.into_owned()))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
    )
}

/// Serve the web UI embedded at build time; unknown paths get index.html so
/// client-side routing works.
async fn embedded(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if !path.is_empty()
        && let Some(res) = asset_response(path)
    {
        return res;
    }
    if path.starts_with("assets/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    asset_response("index.html").unwrap_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "The web UI was not built into this binary. Run `npm run build` in web/ and rebuild.",
        )
            .into_response()
    })
}
