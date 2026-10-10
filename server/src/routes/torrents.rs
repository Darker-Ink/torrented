use axum::{
    Json, Router,
    extract::{Multipart, Path, State},
    routing::{delete, get, patch, post},
};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::types::Json as SqlJson;

use crate::{
    audit,
    auth::{ClientInfo, CurrentUser, User, perm},
    bail_bad_request,
    error::{AppError, AppResult},
    library,
    state::AppState,
    torrents::scan::{self, AddInput},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/library/{id}/torrents", post(add_json))
        .route("/library/{id}/torrents/upload", post(add_upload))
        .route("/library/{id}/sources", get(sources))
        .route("/torrents", get(list_all))
        .route("/torrents/active", get(active))
        .route("/torrents/jobs", get(jobs))
        .route("/torrents/jobs/{info_hash}", delete(dismiss_job))
        .route("/torrents/{id}", get(get_one).delete(remove))
        .route("/torrents/{id}/remap", post(remap))
        .route("/torrents/{id}/probe", post(probe_all))
        .route("/torrents/{id}/files/{file_id}", patch(update_file))
        .route("/torrents/{id}/files/{file_id}/probe", post(probe_one))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TorrentRow {
    pub id: i64,
    pub info_hash: String,
    pub media_id: i64,
    pub name: String,
    pub magnet: String,
    pub total_size: i64,
    pub piece_length: Option<i64>,
    pub file_count: i64,
    pub trackers: SqlJson<Vec<String>>,
    pub resolution: Option<String>,
    pub source: Option<String>,
    pub video_codec: Option<String>,
    pub audio: Option<String>,
    pub hdr: Option<String>,
    pub release_group: Option<String>,
    pub added_at: DateTime<Utc>,
}

const TORRENT_COLUMNS: &str = "id, info_hash, media_id, name, magnet, total_size, piece_length, file_count, \
    trackers, resolution, source, video_codec, audio, hdr, release_group, added_at";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FileRow {
    pub id: i64,
    pub file_index: i64,
    pub path: String,
    pub size: i64,
    pub kind: String,
    pub is_sample: bool,
    pub season_number: Option<i64>,
    pub episode_numbers: SqlJson<Vec<i64>>,
    pub mapping: String,
    pub language: Option<String>,
    pub container: Option<String>,
    pub resolution: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub duration: Option<f64>,
    pub probe: Option<SqlJson<Value>>,
    pub probed_at: Option<DateTime<Utc>>,
    pub linked_episodes: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct JobRow {
    pub info_hash: String,
    pub kind: String,
    pub tmdb_id: i64,
    pub name: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub warnings: SqlJson<Vec<String>>,
    pub user_id: Option<i64>,
    pub added_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

const JOB_SELECT: &str = "SELECT j.info_hash, j.kind, j.tmdb_id, j.name, j.status, j.error, j.warnings, j.user_id,
        COALESCE(u.display_name, u.username) AS added_by, j.created_at, j.updated_at
    FROM torrent_jobs j LEFT JOIN users u ON u.id = j.user_id";

async fn load_torrent(state: &AppState, id: i64) -> AppResult<TorrentRow> {
    sqlx::query_as(&format!("SELECT {TORRENT_COLUMNS} FROM torrents WHERE id = ?"))
        .bind(id)
        .fetch_optional(&state.media)
        .await?
        .ok_or_else(|| AppError::not_found("torrent not found"))
}

async fn load_files(state: &AppState, torrent_id: i64) -> AppResult<Vec<FileRow>> {
    Ok(sqlx::query_as(
        "SELECT f.id, f.file_index, f.path, f.size, f.kind, f.is_sample, f.season_number, f.episode_numbers,
                f.mapping, f.language, f.container, f.resolution, f.width, f.height, f.video_codec,
                f.audio_codec, f.duration, f.probe, f.probed_at,
                (SELECT COUNT(*) FROM file_episodes fe WHERE fe.file_id = f.id) AS linked_episodes
         FROM torrent_files f WHERE f.torrent_id = ? ORDER BY f.kind != 'video', f.path",
    )
    .bind(torrent_id)
    .fetch_all(&state.media)
    .await?)
}

/// Users may edit torrents they added themselves; managers can edit any.
async fn require_edit(state: &AppState, user: &User, info_hash: &str) -> AppResult<()> {
    if user.can(perm::MANAGE_TORRENTS) {
        return Ok(());
    }
    let owner: Option<Option<i64>> = sqlx::query_scalar("SELECT user_id FROM torrent_jobs WHERE info_hash = ?")
        .bind(info_hash)
        .fetch_optional(&state.main)
        .await?;
    if user.can(perm::ADD_TORRENTS) && owner.flatten() == Some(user.id) {
        return Ok(());
    }
    Err(AppError::forbidden("you can only change torrents you added"))
}

#[derive(Deserialize)]
struct AddBody {
    source: String,
}

async fn add_json(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
    Json(body): Json<AddBody>,
) -> AppResult<Json<Value>> {
    user.require(perm::ADD_TORRENTS)?;
    let source = body.source.trim().to_string();
    if source.is_empty() {
        bail_bad_request!("paste a magnet link or a link to a .torrent file");
    }
    let input = if source.starts_with("magnet:") {
        AddInput::Magnet(source)
    } else if source.len() == 40 && source.chars().all(|c| c.is_ascii_hexdigit()) {
        AddInput::Magnet(format!("magnet:?xt=urn:btih:{source}"))
    } else {
        AddInput::Url(source)
    };
    let outcome = scan::add_torrent(&state, id, input, &user).await?;
    audit::log(
        &state,
        Some(&user),
        &client,
        "torrent.add",
        Some(outcome.info_hash.clone()),
        Some(json!({ "media_id": id, "name": outcome.name })),
    )
    .await;
    Ok(Json(json!(outcome)))
}

async fn add_upload(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
    mut multipart: Multipart,
) -> AppResult<Json<Value>> {
    user.require(perm::ADD_TORRENTS)?;
    let mut data: Option<Bytes> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        if field.name() == Some("torrent") {
            data = Some(field.bytes().await.map_err(|e| AppError::bad_request(e.to_string()))?);
        }
    }
    let data = data.ok_or_else(|| AppError::bad_request("no torrent file uploaded"))?;
    let outcome = scan::add_torrent(&state, id, AddInput::File(data), &user).await?;
    audit::log(
        &state,
        Some(&user),
        &client,
        "torrent.add",
        Some(outcome.info_hash.clone()),
        Some(json!({ "media_id": id, "name": outcome.name })),
    )
    .await;
    Ok(Json(json!(outcome)))
}

async fn sources(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let media = library::get_media(&state.media, id).await?;
    let torrents: Vec<TorrentRow> = sqlx::query_as(&format!(
        "SELECT {TORRENT_COLUMNS} FROM torrents WHERE media_id = ? ORDER BY added_at DESC"
    ))
    .bind(id)
    .fetch_all(&state.media)
    .await?;
    let jobs: Vec<JobRow> = sqlx::query_as(&format!(
        "{JOB_SELECT} WHERE j.kind = ? AND j.tmdb_id = ? ORDER BY j.created_at DESC"
    ))
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .fetch_all(&state.main)
    .await?;

    let mut out = Vec::new();
    for t in torrents {
        let files = load_files(&state, t.id).await?;
        let job = jobs.iter().find(|j| j.info_hash == t.info_hash);
        out.push(json!({ "torrent": t, "files": files, "job": job }));
    }
    let pending: Vec<&JobRow> = jobs
        .iter()
        .filter(|j| j.status == "resolving" || j.status == "error")
        .filter(|j| !out.iter().any(|o| o["torrent"]["info_hash"] == j.info_hash))
        .collect();
    Ok(Json(json!({ "torrents": out, "pending": pending })))
}

async fn list_all(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_TORRENTS)?;
    #[derive(Serialize, sqlx::FromRow)]
    struct Row {
        id: i64,
        info_hash: String,
        name: String,
        total_size: i64,
        file_count: i64,
        resolution: Option<String>,
        added_at: DateTime<Utc>,
        media_id: i64,
        media_title: String,
        media_kind: String,
        media_tmdb_id: i64,
        poster_path: Option<String>,
    }
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT t.id, t.info_hash, t.name, t.total_size, t.file_count, t.resolution, t.added_at,
                m.id AS media_id, m.title AS media_title, m.kind AS media_kind, m.tmdb_id AS media_tmdb_id, m.poster_path
         FROM torrents t JOIN media m ON m.id = t.media_id ORDER BY t.added_at DESC",
    )
    .fetch_all(&state.media)
    .await?;
    let jobs: Vec<JobRow> = sqlx::query_as(&format!("{JOB_SELECT} ORDER BY j.created_at DESC"))
        .fetch_all(&state.main)
        .await?;
    let rows: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            let job = jobs.iter().find(|j| j.info_hash == r.info_hash);
            let mut v = json!(r);
            v["job"] = json!(job);
            v
        })
        .collect();
    Ok(Json(json!(rows)))
}

async fn active(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    if !user.can(perm::MANAGE_TORRENTS) && !user.can(perm::VIEW_LOGS) {
        return Err(AppError::forbidden("you do not have permission to do that"));
    }
    Ok(Json(json!({
        "torrents": state.engine.active(),
        "cache_bytes": state.engine.cache_usage(),
        "cache_limit": state.settings.cache_max_bytes().await,
        "listen_addr": state.engine.listen_addr(),
    })))
}

async fn jobs(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Vec<JobRow>>> {
    user.require(perm::ADD_TORRENTS)?;
    let rows: Vec<JobRow> = if user.can(perm::MANAGE_TORRENTS) {
        sqlx::query_as(&format!(
            "{JOB_SELECT} WHERE j.status != 'done' ORDER BY j.created_at DESC LIMIT 100"
        ))
        .fetch_all(&state.main)
        .await?
    } else {
        sqlx::query_as(&format!(
            "{JOB_SELECT} WHERE j.status != 'done' AND j.user_id = ? ORDER BY j.created_at DESC LIMIT 100"
        ))
        .bind(user.id)
        .fetch_all(&state.main)
        .await?
    };
    Ok(Json(rows))
}

async fn dismiss_job(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(info_hash): Path<String>,
) -> AppResult<Json<Value>> {
    require_edit(&state, &user, &info_hash).await?;
    sqlx::query("DELETE FROM torrent_jobs WHERE info_hash = ? AND status = 'error'")
        .bind(&info_hash)
        .execute(&state.main)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn get_one(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let t = load_torrent(&state, id).await?;
    let files = load_files(&state, id).await?;
    let job: Option<JobRow> = sqlx::query_as(&format!("{JOB_SELECT} WHERE j.info_hash = ?"))
        .bind(&t.info_hash)
        .fetch_optional(&state.main)
        .await?;
    Ok(Json(json!({ "torrent": t, "files": files, "job": job })))
}

async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let t = load_torrent(&state, id).await?;
    require_edit(&state, &user, &t.info_hash).await?;
    let _ = state.engine.evict(&t.info_hash).await;
    sqlx::query("DELETE FROM torrents WHERE id = ?")
        .bind(id)
        .execute(&state.media)
        .await?;
    sqlx::query("DELETE FROM torrent_jobs WHERE info_hash = ?")
        .bind(&t.info_hash)
        .execute(&state.main)
        .await?;
    audit::log(&state, Some(&user), &client, "torrent.remove", Some(t.info_hash), Some(json!({ "name": t.name }))).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct RemapBody {
    #[serde(default)]
    reset: bool,
}

async fn remap(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    body: Option<Json<RemapBody>>,
) -> AppResult<Json<Value>> {
    let t = load_torrent(&state, id).await?;
    require_edit(&state, &user, &t.info_hash).await?;
    if body.is_some_and(|b| b.reset) {
        sqlx::query("UPDATE torrent_files SET mapping = 'auto' WHERE torrent_id = ? AND mapping = 'manual'")
            .bind(id)
            .execute(&state.media)
            .await?;
    }
    scan::apply_auto_mapping(&state.media, id).await?;
    Ok(Json(json!({ "files": load_files(&state, id).await? })))
}

#[derive(Deserialize)]
struct UpdateFile {
    season_number: Option<i64>,
    episode_numbers: Option<Vec<i64>>,
    mapping: Option<String>,
}

async fn update_file(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path((id, file_id)): Path<(i64, i64)>,
    Json(body): Json<UpdateFile>,
) -> AppResult<Json<Value>> {
    let t = load_torrent(&state, id).await?;
    require_edit(&state, &user, &t.info_hash).await?;
    let mapping = body.mapping.unwrap_or_else(|| "manual".into());
    if !["auto", "manual", "ignored"].contains(&mapping.as_str()) {
        bail_bad_request!("mapping must be auto, manual or ignored");
    }
    let res = if mapping == "manual" {
        let mut eps = body.episode_numbers.unwrap_or_default();
        eps.sort_unstable();
        eps.dedup();
        sqlx::query(
            "UPDATE torrent_files SET mapping = 'manual', season_number = ?, episode_numbers = ?
             WHERE id = ? AND torrent_id = ?",
        )
        .bind(body.season_number)
        .bind(SqlJson(&eps))
        .bind(file_id)
        .bind(id)
        .execute(&state.media)
        .await?
    } else {
        sqlx::query("UPDATE torrent_files SET mapping = ? WHERE id = ? AND torrent_id = ?")
            .bind(&mapping)
            .bind(file_id)
            .bind(id)
            .execute(&state.media)
            .await?
    };
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("file not found"));
    }
    scan::apply_auto_mapping(&state.media, id).await?;
    audit::log(
        &state,
        Some(&user),
        &client,
        "torrent.map_file",
        Some(t.info_hash),
        Some(json!({ "file_id": file_id, "mapping": mapping })),
    )
    .await;
    Ok(Json(json!({ "files": load_files(&state, id).await? })))
}

async fn probe_all(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let t = load_torrent(&state, id).await?;
    require_edit(&state, &user, &t.info_hash).await?;
    if !state.tools.can_probe() {
        bail_bad_request!("ffprobe is not installed on the server");
    }
    sqlx::query("UPDATE torrent_jobs SET status = 'probing', updated_at = ? WHERE info_hash = ?")
        .bind(Utc::now())
        .bind(&t.info_hash)
        .execute(&state.main)
        .await?;
    let st = state.clone();
    tokio::spawn(async move {
        let warnings = scan::probe_torrent(&st, id).await;
        let _ = sqlx::query("UPDATE torrent_jobs SET status = 'done', warnings = ?, updated_at = ? WHERE info_hash = ?")
            .bind(SqlJson(&warnings))
            .bind(Utc::now())
            .bind(&t.info_hash)
            .execute(&st.main)
            .await;
    });
    Ok(Json(json!({ "ok": true })))
}

async fn probe_one(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, file_id)): Path<(i64, i64)>,
) -> AppResult<Json<Value>> {
    let t = load_torrent(&state, id).await?;
    require_edit(&state, &user, &t.info_hash).await?;
    let warning = scan::probe_file(&state, file_id).await?;
    Ok(Json(json!({ "warning": warning, "files": load_files(&state, id).await? })))
}
