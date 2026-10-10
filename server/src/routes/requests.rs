use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, patch, post},
};
use base64::Engine as _;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::types::Json as SqlJson;

use crate::{
    audit,
    auth::{ClientInfo, CurrentUser, perm},
    bail_bad_request,
    error::{AppError, AppResult},
    library,
    metadata::MediaKind,
    state::AppState,
    torrents::review,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/requests", get(list).post(create))
        .route("/requests/{id}", patch(update).delete(remove))
        .route("/requests/{id}/review", post(recheck))
}

#[derive(Serialize, sqlx::FromRow)]
struct RequestRow {
    id: i64,
    user_id: i64,
    requested_by: String,
    kind: String,
    tmdb_id: i64,
    title: String,
    year: Option<i64>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    overview: Option<String>,
    seasons: Option<SqlJson<Vec<i64>>>,
    note: Option<String>,
    status: String,
    response: Option<String>,
    handled_by_name: Option<String>,
    has_torrent: bool,
    torrent_name: Option<String>,
    torrent_info_hash: Option<String>,
    torrent_attached: bool,
    review_status: Option<String>,
    review: Option<SqlJson<Value>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

const SELECT: &str = "SELECT r.id, r.user_id, COALESCE(u.display_name, u.username) AS requested_by, r.kind,
        r.tmdb_id, r.title, r.year, r.poster_path, r.backdrop_path, r.overview, r.seasons, r.note, r.status,
        r.response, COALESCE(h.display_name, h.username) AS handled_by_name,
        r.torrent_source IS NOT NULL AS has_torrent, r.torrent_name, r.torrent_info_hash, r.torrent_attached,
        r.review_status, r.review, r.created_at, r.updated_at
    FROM requests r JOIN users u ON u.id = r.user_id LEFT JOIN users h ON h.id = r.handled_by";

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
    scope: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Value>> {
    let all = q.scope.as_deref() == Some("all") && user.can(perm::MANAGE_REQUESTS);
    let mut sql = format!("{SELECT} WHERE 1 = 1");
    if !all {
        sql.push_str(&format!(" AND r.user_id = {}", user.id));
    }
    if let Some(status) = q.status.filter(|s| ["pending", "approved", "declined", "available"].contains(&s.as_str())) {
        sql.push_str(&format!(" AND r.status = '{status}'"));
    }
    sql.push_str(" ORDER BY r.status != 'pending', r.created_at DESC LIMIT 500");
    let rows: Vec<RequestRow> = sqlx::query_as(&sql).fetch_all(&state.main).await?;

    // Attach library ids so the UI can link straight to the title.
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let media_id = match MediaKind::parse(&r.kind) {
            Some(k) => library::find_by_tmdb(&state.media, k, r.tmdb_id).await?,
            None => None,
        };
        let mut v = json!(r);
        v["media_id"] = json!(media_id);
        out.push(v);
    }
    Ok(Json(json!(out)))
}

#[derive(Deserialize)]
struct CreateBody {
    kind: String,
    tmdb_id: i64,
    seasons: Option<Vec<i64>>,
    note: Option<String>,
    /// Magnet link, info hash or link to a .torrent file.
    torrent: Option<String>,
    /// A .torrent file, base64 encoded.
    torrent_file: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Json(body): Json<CreateBody>,
) -> AppResult<Json<Value>> {
    user.require(perm::REQUEST)?;
    let kind = MediaKind::parse(&body.kind).ok_or_else(|| AppError::bad_request("invalid kind"))?;

    if let Some(id) = library::find_by_tmdb(&state.media, kind, body.tmdb_id).await? {
        let has_sources: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM torrents WHERE media_id = ?)")
            .bind(id)
            .fetch_one(&state.media)
            .await?;
        if has_sources && kind == MediaKind::Movie {
            return Err(AppError::conflict("this is already available to watch"));
        }
    }
    let open: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM requests WHERE kind = ? AND tmdb_id = ? AND status IN ('pending', 'approved')",
    )
    .bind(kind.as_str())
    .bind(body.tmdb_id)
    .fetch_optional(&state.main)
    .await?;
    if open.is_some() {
        return Err(AppError::conflict("someone has already requested this"));
    }

    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let details = state
        .metadata
        .tmdb
        .details(&key, &lang, kind, body.tmdb_id)
        .await
        .map_err(|e| AppError::Upstream(format!("{e:#}")))?;

    // A suggested torrent is validated (and downloaded, for links) up front
    // so mistakes show up in the dialog rather than in the review.
    let upload = match body.torrent_file.as_deref().filter(|f| !f.is_empty()) {
        Some(b64) => Some(Bytes::from(
            base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .map_err(|_| AppError::bad_request("the .torrent file couldn't be read"))?,
        )),
        None => None,
    };
    let source = match (&upload, body.torrent.as_deref().map(str::trim).filter(|t| !t.is_empty())) {
        (Some(_), _) => Some("upload".to_string()),
        (None, Some(t)) => Some(t.to_string()),
        (None, None) => None,
    };
    let metainfo = match &source {
        Some(s) => review::prepare(s, upload).await?,
        None => None,
    };

    let auto = user.can(perm::AUTO_APPROVE);
    let now = Utc::now();
    let note = body.note.map(|n| n.trim().chars().take(500).collect::<String>()).filter(|n| !n.is_empty());
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO requests (user_id, kind, tmdb_id, title, year, poster_path, backdrop_path, overview,
            seasons, note, status, handled_by, torrent_source, torrent_metainfo, review_status,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user.id)
    .bind(kind.as_str())
    .bind(body.tmdb_id)
    .bind(&details.title)
    .bind(details.year)
    .bind(&details.poster_path)
    .bind(&details.backdrop_path)
    .bind(&details.overview)
    .bind(body.seasons.filter(|s| !s.is_empty()).map(SqlJson))
    .bind(note)
    .bind(if auto { "approved" } else { "pending" })
    .bind(auto.then_some(user.id))
    .bind(&source)
    .bind(metainfo.as_deref())
    .bind(source.as_ref().map(|_| "checking"))
    .bind(now)
    .bind(now)
    .fetch_one(&state.main)
    .await?;

    let media_id = if auto {
        Some(library::add_or_refresh(&state, kind, body.tmdb_id).await?)
    } else {
        None
    };
    audit::log(
        &state,
        Some(&user),
        &client,
        "request.create",
        Some(details.title.clone()),
        Some(json!({ "kind": kind, "tmdb_id": body.tmdb_id, "auto_approved": auto, "torrent": source.is_some() })),
    )
    .await;
    if source.is_some() {
        review::spawn(&state, id);
    }
    Ok(Json(json!({ "id": id, "status": if auto { "approved" } else { "pending" }, "media_id": media_id })))
}

#[derive(Deserialize)]
struct UpdateBody {
    status: String,
    response: Option<String>,
    /// Attach the suggested torrent on approval. Defaults to yes unless the
    /// review found a problem.
    attach_torrent: Option<bool>,
}

async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
    Json(body): Json<UpdateBody>,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_REQUESTS)?;
    if !["approved", "declined", "pending"].contains(&body.status.as_str()) {
        bail_bad_request!("status must be approved, declined or pending");
    }
    let (kind, tmdb_id, title, review_status): (String, i64, String, Option<String>) =
        sqlx::query_as("SELECT kind, tmdb_id, title, review_status FROM requests WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.main)
            .await?
            .ok_or_else(|| AppError::not_found("request not found"))?;

    let mut media_id = None;
    if body.status == "approved"
        && let Some(k) = MediaKind::parse(&kind)
    {
        media_id = Some(library::add_or_refresh(&state, k, tmdb_id).await?);
    }
    sqlx::query("UPDATE requests SET status = ?, response = ?, handled_by = ?, updated_at = ? WHERE id = ?")
        .bind(&body.status)
        .bind(body.response.filter(|r| !r.trim().is_empty()))
        .bind(user.id)
        .bind(Utc::now())
        .bind(id)
        .execute(&state.main)
        .await?;

    let mut torrent_error = None;
    let attach = body
        .attach_torrent
        .unwrap_or(matches!(review_status.as_deref(), Some("pass" | "warn")));
    if body.status == "approved"
        && attach
        && let Err(e) = review::attach(&state, id, user.id).await
    {
        torrent_error = Some(e.to_string());
    }
    audit::log(
        &state,
        Some(&user),
        &client,
        &format!("request.{}", body.status),
        Some(title),
        Some(json!({ "request_id": id })),
    )
    .await;
    Ok(Json(json!({ "ok": true, "media_id": media_id, "torrent_error": torrent_error })))
}

/// Run the torrent review again, e.g. once more seeders turn up.
async fn recheck(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let (owner, has_torrent, attached): (i64, bool, bool) = sqlx::query_as(
        "SELECT user_id, torrent_source IS NOT NULL, torrent_attached FROM requests WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.main)
    .await?
    .ok_or_else(|| AppError::not_found("request not found"))?;
    if owner != user.id && !user.can(perm::MANAGE_REQUESTS) {
        return Err(AppError::forbidden("you can't review this request"));
    }
    if !has_torrent {
        bail_bad_request!("this request has no torrent");
    }
    if attached {
        bail_bad_request!("the torrent is already attached");
    }
    sqlx::query("UPDATE requests SET review_status = 'checking' WHERE id = ?")
        .bind(id)
        .execute(&state.main)
        .await?;
    review::spawn(&state, id);
    Ok(Json(json!({ "ok": true })))
}

async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let (owner, status): (i64, String) = sqlx::query_as("SELECT user_id, status FROM requests WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.main)
        .await?
        .ok_or_else(|| AppError::not_found("request not found"))?;
    let own_pending = owner == user.id && status == "pending";
    if !own_pending && !user.can(perm::MANAGE_REQUESTS) {
        return Err(AppError::forbidden("you can only cancel your own pending requests"));
    }
    sqlx::query("DELETE FROM requests WHERE id = ?")
        .bind(id)
        .execute(&state.main)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
