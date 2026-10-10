//! Browsing TMDB for titles that may or may not be in the library yet.

use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    auth::CurrentUser,
    error::{AppError, AppResult},
    library,
    metadata::{MediaKind, SearchItem, tmdb::Page},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/discover/search", get(search))
        .route("/discover/genres/{kind}", get(genres))
        .route("/discover/genre/{kind}/{genre}", get(by_genre))
        .route("/discover/list/{kind}/{list}", get(list))
        .route("/discover/title/{kind}/{tmdb_id}", get(details))
}

fn kind(s: &str) -> AppResult<MediaKind> {
    MediaKind::parse(s).ok_or_else(|| AppError::bad_request("kind must be movie or tv"))
}

fn upstream(e: anyhow::Error) -> AppError {
    AppError::Upstream(format!("{e:#}"))
}

/// Attach library and request status to search results.
pub async fn annotate(state: &AppState, items: &[SearchItem]) -> AppResult<Vec<Value>> {
    let mut in_library: HashMap<(String, i64), (i64, bool)> = HashMap::new();
    let mut requests: HashMap<(String, i64), String> = HashMap::new();
    if !items.is_empty() {
        let ids: Vec<String> = items.iter().map(|i| i.tmdb_id.to_string()).collect();
        let list = ids.join(",");
        let rows: Vec<(i64, String, i64, bool)> = sqlx::query_as(&format!(
            "SELECT m.id, m.kind, m.tmdb_id, EXISTS (SELECT 1 FROM torrents t WHERE t.media_id = m.id)
             FROM media m WHERE m.tmdb_id IN ({list})"
        ))
        .fetch_all(&state.media)
        .await?;
        for (id, k, tmdb, available) in rows {
            in_library.insert((k, tmdb), (id, available));
        }
        let rows: Vec<(String, i64, String)> = sqlx::query_as(&format!(
            "SELECT kind, tmdb_id, status FROM requests
             WHERE tmdb_id IN ({list}) AND status IN ('pending', 'approved')"
        ))
        .fetch_all(&state.main)
        .await?;
        for (k, tmdb, status) in rows {
            requests.insert((k, tmdb), status);
        }
    }
    Ok(items
        .iter()
        .map(|item| {
            let key = (item.kind.as_str().to_string(), item.tmdb_id);
            let lib = in_library.get(&key);
            let mut v = serde_json::to_value(item).unwrap_or_default();
            v["media_id"] = json!(lib.map(|l| l.0));
            v["available"] = json!(lib.is_some_and(|l| l.1));
            v["request_status"] = json!(requests.get(&key));
            v
        })
        .collect())
}

async fn page_json(state: &AppState, page: Page) -> AppResult<Json<Value>> {
    let results = annotate(state, &page.results).await?;
    Ok(Json(json!({
        "page": page.page,
        "total_pages": page.total_pages,
        "total_results": page.total_results,
        "results": results,
    })))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    kind: Option<String>,
    page: Option<u32>,
}

async fn search(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Value>> {
    let query = q.q.trim();
    if query.is_empty() {
        return Ok(Json(json!({ "page": 1, "total_pages": 0, "total_results": 0, "results": [] })));
    }
    let kind = q.kind.as_deref().and_then(MediaKind::parse);
    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let page = state
        .metadata
        .tmdb
        .search(&key, &lang, query, kind, q.page.unwrap_or(1).clamp(1, 500))
        .await
        .map_err(upstream)?;
    page_json(&state, page).await
}

#[derive(Deserialize)]
struct PageQuery {
    page: Option<u32>,
}

async fn list(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Path((k, list)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> AppResult<Json<Value>> {
    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let page = state
        .metadata
        .tmdb
        .list(&key, &lang, kind(&k)?, &list, q.page.unwrap_or(1).clamp(1, 500))
        .await
        .map_err(upstream)?;
    page_json(&state, page).await
}

async fn genres(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Path(k): Path<String>,
) -> AppResult<Json<Value>> {
    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let genres = state
        .metadata
        .tmdb
        .genres(&key, &lang, kind(&k)?)
        .await
        .map_err(upstream)?;
    Ok(Json(json!(
        genres
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect::<Vec<_>>()
    )))
}

async fn by_genre(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Path((k, genre)): Path<(String, i64)>,
    Query(q): Query<PageQuery>,
) -> AppResult<Json<Value>> {
    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let page = state
        .metadata
        .tmdb
        .discover_genre(&key, &lang, kind(&k)?, genre, q.page.unwrap_or(1).clamp(1, 500))
        .await
        .map_err(upstream)?;
    page_json(&state, page).await
}

async fn details(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Path((k, tmdb_id)): Path<(String, i64)>,
) -> AppResult<Json<Value>> {
    let kind = kind(&k)?;
    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let details = state
        .metadata
        .tmdb
        .details(&key, &lang, kind, tmdb_id)
        .await
        .map_err(upstream)?;
    let media_id = library::find_by_tmdb(&state.media, kind, tmdb_id).await?;
    let request: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, status FROM requests WHERE kind = ? AND tmdb_id = ? AND status IN ('pending', 'approved')
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(kind.as_str())
    .bind(tmdb_id)
    .fetch_optional(&state.main)
    .await?;
    let mut v = serde_json::to_value(&details).unwrap_or_default();
    v["media_id"] = json!(media_id);
    v["request"] = json!(request.map(|(id, status)| json!({ "id": id, "status": status })));
    Ok(Json(v))
}
