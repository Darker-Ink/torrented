use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{delete, get, post},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};

use super::library::continue_watching;
use crate::{
    auth::{CurrentUser, User},
    error::{AppError, AppResult},
    library::{self, CARD_COLUMNS, MediaCard, files},
    metadata::MediaKind,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/progress", post(report))
        .route("/progress/continue", get(continue_list))
        .route("/progress/watched", post(mark_watched))
        .route("/progress/{kind}/{tmdb_id}", delete(forget))
        .route("/watchlist", get(watchlist).post(add_watchlist))
        .route("/watchlist/{kind}/{tmdb_id}", delete(remove_watchlist))
}

/// Anything past this fraction counts as watched.
const COMPLETED_AT: f64 = 0.92;

#[derive(Deserialize)]
struct Report {
    file_id: i64,
    position: f64,
    duration: Option<f64>,
    session_id: Option<i64>,
}

async fn upsert(
    state: &AppState,
    user: &User,
    kind: &str,
    tmdb_id: i64,
    season: i64,
    episode: i64,
    info_hash: &str,
    file_index: i64,
    position: f64,
    duration: Option<f64>,
    completed: bool,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO watch_progress (user_id, kind, tmdb_id, season_number, episode_number, info_hash,
            file_index, position, duration, completed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, kind, tmdb_id, season_number, episode_number) DO UPDATE SET
            info_hash = excluded.info_hash, file_index = excluded.file_index,
            position = excluded.position, duration = COALESCE(excluded.duration, watch_progress.duration),
            completed = excluded.completed, updated_at = excluded.updated_at",
    )
    .bind(user.id)
    .bind(kind)
    .bind(tmdb_id)
    .bind(season)
    .bind(episode)
    .bind(info_hash)
    .bind(file_index)
    .bind(position)
    .bind(duration)
    .bind(completed)
    .bind(Utc::now())
    .execute(&state.main)
    .await?;
    Ok(())
}

async fn report(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<Report>,
) -> AppResult<Json<Value>> {
    let ctx = files::file_context(&state.media, body.file_id)
        .await?
        .ok_or_else(|| AppError::not_found("file not found"))?;
    let duration = body.duration.filter(|d| d.is_finite() && *d > 0.0).or(ctx.duration);
    let position = body.position.max(0.0);
    let completed = duration.is_some_and(|d| position / d >= COMPLETED_AT);

    if ctx.media_kind == "tv" {
        if let Some(season) = ctx.season_number {
            for ep in ctx.episode_numbers.0.iter() {
                upsert(
                    &state, &user, &ctx.media_kind, ctx.tmdb_id, season, *ep, &ctx.info_hash,
                    ctx.file_index, position, duration, completed,
                )
                .await?;
            }
        }
    } else {
        upsert(
            &state, &user, &ctx.media_kind, ctx.tmdb_id, -1, -1, &ctx.info_hash, ctx.file_index, position,
            duration, completed,
        )
        .await?;
    }
    state.engine.touch(&ctx.info_hash);

    if let Some(sid) = body.session_id {
        sqlx::query("UPDATE stream_history SET ended_at = ? WHERE id = ? AND user_id = ?")
            .bind(Utc::now())
            .bind(sid)
            .bind(user.id)
            .execute(&state.main)
            .await?;
    }
    Ok(Json(json!({ "completed": completed })))
}

async fn continue_list(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    Ok(Json(json!(continue_watching(&state, &user, 50).await?)))
}

#[derive(Deserialize)]
struct MarkWatched {
    media_id: i64,
    season_number: Option<i64>,
    episode_number: Option<i64>,
    watched: bool,
}

/// Mark a movie, a whole season, or a single episode as (un)watched.
async fn mark_watched(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<MarkWatched>,
) -> AppResult<Json<Value>> {
    let media = library::get_media(&state.media, body.media_id).await?;
    let targets: Vec<(i64, i64)> = if media.kind == "movie" {
        vec![(-1, -1)]
    } else {
        library::episodes(&state.media, media.id, body.season_number)
            .await?
            .into_iter()
            .filter(|e| body.episode_number.is_none_or(|n| n == e.episode_number))
            .map(|e| (e.season_number, e.episode_number))
            .collect()
    };
    for (s, e) in targets {
        if body.watched {
            upsert(&state, &user, &media.kind, media.tmdb_id, s, e, "", -1, 0.0, None, true).await?;
        } else {
            sqlx::query(
                "DELETE FROM watch_progress WHERE user_id = ? AND kind = ? AND tmdb_id = ?
                 AND season_number = ? AND episode_number = ?",
            )
            .bind(user.id)
            .bind(&media.kind)
            .bind(media.tmdb_id)
            .bind(s)
            .bind(e)
            .execute(&state.main)
            .await?;
        }
    }
    Ok(Json(json!({ "ok": true })))
}

async fn forget(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((kind, tmdb_id)): Path<(String, i64)>,
) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM watch_progress WHERE user_id = ? AND kind = ? AND tmdb_id = ? AND completed = 0")
        .bind(user.id)
        .bind(&kind)
        .bind(tmdb_id)
        .execute(&state.main)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn watchlist(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Vec<MediaCard>>> {
    let keys: Vec<(String, i64)> =
        sqlx::query_as("SELECT kind, tmdb_id FROM watchlist WHERE user_id = ? ORDER BY added_at DESC")
            .bind(user.id)
            .fetch_all(&state.main)
            .await?;
    let mut out = Vec::new();
    for (kind, tmdb_id) in keys {
        let card: Option<MediaCard> = sqlx::query_as(&format!(
            "SELECT {CARD_COLUMNS} FROM media m WHERE m.kind = ? AND m.tmdb_id = ?"
        ))
        .bind(&kind)
        .bind(tmdb_id)
        .fetch_optional(&state.media)
        .await?;
        out.extend(card);
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
struct WatchlistBody {
    kind: String,
    tmdb_id: i64,
}

async fn add_watchlist(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<WatchlistBody>,
) -> AppResult<Json<Value>> {
    let kind = MediaKind::parse(&body.kind).ok_or_else(|| AppError::bad_request("invalid kind"))?;
    sqlx::query("INSERT OR IGNORE INTO watchlist (user_id, kind, tmdb_id, added_at) VALUES (?, ?, ?, ?)")
        .bind(user.id)
        .bind(kind.as_str())
        .bind(body.tmdb_id)
        .bind(Utc::now())
        .execute(&state.main)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn remove_watchlist(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((kind, tmdb_id)): Path<(String, i64)>,
) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM watchlist WHERE user_id = ? AND kind = ? AND tmdb_id = ?")
        .bind(user.id)
        .bind(&kind)
        .bind(tmdb_id)
        .execute(&state.main)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
