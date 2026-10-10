use std::collections::HashMap;

use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

use crate::{
    audit,
    auth::{ClientInfo, CurrentUser, perm},
    bail_bad_request,
    db,
    error::{AppError, AppResult},
    library::transfer::{self, ImportMode},
    settings::{self, Settings},
    state::AppState,
    util,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/overview", get(overview))
        .route("/admin/logs", get(logs))
        .route("/admin/streams", get(streams))
        .route("/admin/library", get(library_info))
        .route("/admin/library/export", get(export))
        .route("/admin/library/import", post(import))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/settings/test-keys", post(test_keys))
}

async fn overview(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    if !user.can(perm::VIEW_LOGS) && !user.can(perm::MANAGE_SETTINGS) {
        return Err(AppError::forbidden("you do not have permission to do that"));
    }
    let mut conn = state.media.acquire().await?;
    let library = transfer::info(&mut conn).await?;
    drop(conn);
    let mut main_conn = state.main.acquire().await?;
    let main_version = db::schema_version(&mut main_conn).await?;
    drop(main_conn);

    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&state.main).await?;
    let pending_requests: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM requests WHERE status = 'pending'")
        .fetch_one(&state.main)
        .await?;
    let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM torrent_jobs WHERE status IN ('resolving', 'probing')")
        .fetch_one(&state.main)
        .await?;
    let failed_jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM torrent_jobs WHERE status = 'error'")
        .fetch_one(&state.main)
        .await?;

    #[derive(Serialize, sqlx::FromRow)]
    struct NowPlaying {
        id: i64,
        username: Option<String>,
        title: Option<String>,
        season_number: Option<i64>,
        episode_number: Option<i64>,
        mode: String,
        started_at: DateTime<Utc>,
        ended_at: Option<DateTime<Utc>>,
        bytes_sent: i64,
    }
    let recent_cutoff = Utc::now() - chrono::Duration::minutes(2);
    let now_playing: Vec<NowPlaying> = sqlx::query_as(
        "SELECT s.id, COALESCE(u.display_name, u.username) AS username, s.title, s.season_number,
                s.episode_number, s.mode, s.started_at, s.ended_at, s.bytes_sent
         FROM stream_history s LEFT JOIN users u ON u.id = s.user_id
         WHERE COALESCE(s.ended_at, s.started_at) > ? ORDER BY s.started_at DESC",
    )
    .bind(recent_cutoff)
    .fetch_all(&state.main)
    .await?;

    Ok(Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "schema": { "main": main_version, "media": library.schema_version },
        "library": library,
        "users": users,
        "pending_requests": pending_requests,
        "running_jobs": jobs,
        "failed_jobs": failed_jobs,
        "now_playing": now_playing,
        "engine": {
            "active": state.engine.active(),
            "cache_bytes": state.engine.cache_usage(),
            "cache_limit": state.settings.cache_max_bytes().await,
            "listen_addr": state.engine.listen_addr(),
            "network": state.engine.status(),
        },
        "tools": state.tools,
    })))
}

#[derive(Deserialize)]
struct LogQuery {
    action: Option<String>,
    q: Option<String>,
    page: Option<i64>,
}

async fn logs(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<LogQuery>,
) -> AppResult<Json<Value>> {
    user.require(perm::VIEW_LOGS)?;
    #[derive(Serialize, sqlx::FromRow)]
    struct Row {
        id: i64,
        user_id: Option<i64>,
        username: Option<String>,
        action: String,
        target: Option<String>,
        details: Option<String>,
        ip: Option<String>,
        created_at: DateTime<Utc>,
    }
    let page = q.page.unwrap_or(1).max(1);
    let limit = 100;
    let action = q.action.filter(|a| !a.is_empty()).map(|a| format!("{a}%"));
    let text = q.q.filter(|a| !a.is_empty()).map(|a| format!("%{a}%"));
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, user_id, username, action, target, details, ip, created_at FROM audit_log
         WHERE (?1 IS NULL OR action LIKE ?1)
           AND (?2 IS NULL OR username LIKE ?2 OR target LIKE ?2 OR details LIKE ?2)
         ORDER BY id DESC LIMIT ?3 OFFSET ?4",
    )
    .bind(&action)
    .bind(&text)
    .bind(limit)
    .bind((page - 1) * limit)
    .fetch_all(&state.main)
    .await?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE (?1 IS NULL OR action LIKE ?1)
           AND (?2 IS NULL OR username LIKE ?2 OR target LIKE ?2 OR details LIKE ?2)",
    )
    .bind(&action)
    .bind(&text)
    .fetch_one(&state.main)
    .await?;
    let rows: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            let details = r.details.as_deref().and_then(|d| serde_json::from_str::<Value>(d).ok());
            let mut v = json!(r);
            v["details"] = json!(details);
            v
        })
        .collect();
    Ok(Json(json!({ "items": rows, "total": total, "page": page, "limit": limit })))
}

#[derive(Deserialize)]
struct PageQuery {
    page: Option<i64>,
}

async fn streams(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<PageQuery>,
) -> AppResult<Json<Value>> {
    user.require(perm::VIEW_LOGS)?;
    #[derive(Serialize, sqlx::FromRow)]
    struct Row {
        id: i64,
        username: Option<String>,
        kind: Option<String>,
        tmdb_id: Option<i64>,
        title: Option<String>,
        season_number: Option<i64>,
        episode_number: Option<i64>,
        mode: String,
        ip: Option<String>,
        user_agent: Option<String>,
        started_at: DateTime<Utc>,
        ended_at: Option<DateTime<Utc>>,
        bytes_sent: i64,
    }
    let page = q.page.unwrap_or(1).max(1);
    let limit = 100;
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT s.id, COALESCE(u.display_name, u.username) AS username, s.kind, s.tmdb_id, s.title,
                s.season_number, s.episode_number, s.mode, s.ip, s.user_agent, s.started_at, s.ended_at,
                s.bytes_sent
         FROM stream_history s LEFT JOIN users u ON u.id = s.user_id
         ORDER BY s.id DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind((page - 1) * limit)
    .fetch_all(&state.main)
    .await?;
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stream_history")
        .fetch_one(&state.main)
        .await?;
    Ok(Json(json!({ "items": rows, "total": total, "page": page, "limit": limit })))
}

async fn library_info(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_LIBRARY)?;
    let mut conn = state.media.acquire().await?;
    Ok(Json(json!(transfer::info(&mut conn).await?)))
}

/// Deletes the temp file once the download body is dropped.
struct TempFile(std::path::PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn export(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
) -> AppResult<Response> {
    user.require(perm::MANAGE_LIBRARY)?;
    let path = state.config.tmp_dir().join(format!("export-{}.db", util::random_token(8)));
    transfer::export(&state.media, &path).await?;
    let file = tokio::fs::File::open(&path).await.map_err(anyhow::Error::from)?;
    let len = file.metadata().await.map_err(anyhow::Error::from)?.len();
    let guard = TempFile(path);
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(futures::StreamExt::map(stream, move |chunk| {
        let _keep = &guard;
        chunk
    }));
    audit::log(&state, Some(&user), &client, "library.export", None, None).await;
    let filename = format!("torrented-library-{}.db", Utc::now().format("%Y%m%d"));
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.sqlite3".to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        body,
    )
        .into_response())
}

#[derive(Deserialize)]
struct ImportQuery {
    mode: Option<String>,
}

async fn import(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Query(q): Query<ImportQuery>,
    mut multipart: Multipart,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_LIBRARY)?;
    let mode = match q.mode.as_deref() {
        Some("replace") => ImportMode::Replace,
        _ => ImportMode::Merge,
    };
    let path = state.config.tmp_dir().join(format!("import-{}.db", util::random_token(8)));
    let _guard = TempFile(path.clone());
    let mut received = false;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let mut out = tokio::fs::File::create(&path).await.map_err(anyhow::Error::from)?;
        while let Some(chunk) = field.chunk().await.map_err(|e| AppError::bad_request(e.to_string()))? {
            out.write_all(&chunk).await.map_err(anyhow::Error::from)?;
        }
        out.flush().await.map_err(anyhow::Error::from)?;
        received = true;
    }
    if !received {
        bail_bad_request!("no file uploaded");
    }
    let result = transfer::import(&state.media, &path, mode)
        .await
        .map_err(|e| AppError::bad_request(format!("{e:#}")))?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let _ = tokio::fs::remove_file(format!("{}{suffix}", path.display())).await;
    }
    audit::log(
        &state,
        Some(&user),
        &client,
        "library.import",
        None,
        Some(json!({
            "mode": if mode == ImportMode::Replace { "replace" } else { "merge" },
            "titles_added": result.titles_added,
            "torrents_added": result.torrents_added,
        })),
    )
    .await;
    Ok(Json(json!(result)))
}

async fn get_settings(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    Ok(Json(json!({
        "definitions": settings::DEFS,
        "values": state.settings.snapshot().await,
    })))
}

async fn put_settings(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Json(values): Json<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    let mut changed = Vec::new();
    for (key, value) in &values {
        if settings::is_masked(value) {
            continue;
        }
        let value = value.trim();
        Settings::validate(key, value).map_err(AppError::bad_request)?;
        if state.settings.get(key).await != value {
            state.settings.set(key, value).await?;
            changed.push(key.clone());
        }
    }
    if !changed.is_empty() {
        audit::log(&state, Some(&user), &client, "settings.update", None, Some(json!({ "keys": changed }))).await;
    }
    // VPN and seedbox changes restart the torrent session.
    if changed.iter().any(|k| k.starts_with("vpn_") || k == "seedbox_provider" || k == "seedbox_mode" || k == "seedbox_api_key") {
        crate::network::apply(&state).await;
    }
    Ok(Json(json!({
        "definitions": settings::DEFS,
        "values": state.settings.snapshot().await,
    })))
}

#[derive(Deserialize)]
struct TestKeys {
    tmdb_api_key: Option<String>,
    tvdb_api_key: Option<String>,
}

async fn test_keys(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<TestKeys>,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_SETTINGS)?;
    let tmdb_key = match body.tmdb_api_key.filter(|k| !k.is_empty() && !settings::is_masked(k)) {
        Some(k) => k,
        None => state.settings.tmdb_api_key().await,
    };
    let tvdb_key = match body.tvdb_api_key.filter(|k| !k.is_empty() && !settings::is_masked(k)) {
        Some(k) => k,
        None => state.settings.tvdb_api_key().await,
    };
    let tmdb = state.metadata.tmdb.validate_key(&tmdb_key).await;
    let tvdb = state.metadata.tvdb.validate_key(&tvdb_key).await;
    Ok(Json(json!({
        "tmdb": { "ok": tmdb.is_ok(), "error": tmdb.err().map(|e| e.to_string()) },
        "tvdb": { "ok": tvdb.is_ok(), "error": tvdb.err().map(|e| e.to_string()) },
    })))
}
