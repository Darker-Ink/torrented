use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    audit,
    auth::{ClientInfo, CurrentUser, User, perm},
    error::{AppError, AppResult},
    library::{self, CARD_COLUMNS, MediaCard, files},
    metadata::MediaKind,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/library", get(list).post(add))
        .route("/library/home", get(home))
        .route("/library/genres", get(genres))
        .route("/library/{id}", get(detail).delete(remove))
        .route("/library/{id}/refresh", post(refresh))
        .route("/library/{id}/episodes", get(episodes))
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Progress {
    pub kind: String,
    pub tmdb_id: i64,
    pub season_number: i64,
    pub episode_number: i64,
    pub info_hash: String,
    pub file_index: i64,
    pub position: f64,
    pub duration: Option<f64>,
    pub completed: bool,
    pub updated_at: DateTime<Utc>,
}

async fn cards(state: &AppState, where_sql: &str, order: &str, limit: i64) -> AppResult<Vec<MediaCard>> {
    Ok(sqlx::query_as(&format!(
        "SELECT {CARD_COLUMNS} FROM media m WHERE {where_sql} ORDER BY {order} LIMIT {limit}"
    ))
    .fetch_all(&state.media)
    .await?)
}

const AVAILABLE: &str = "EXISTS (SELECT 1 FROM torrents t WHERE t.media_id = m.id)";

async fn cards_by_tmdb(state: &AppState, keys: &[(String, i64)]) -> AppResult<HashMap<(String, i64), MediaCard>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let ids = keys.iter().map(|k| k.1.to_string()).collect::<Vec<_>>().join(",");
    let rows: Vec<MediaCard> = sqlx::query_as(&format!(
        "SELECT {CARD_COLUMNS} FROM media m WHERE m.tmdb_id IN ({ids})"
    ))
    .fetch_all(&state.media)
    .await?;
    Ok(rows
        .into_iter()
        .map(|c| ((c.kind.clone(), c.tmdb_id), c))
        .collect())
}

/// Shows/movies the user is part-way through, newest first.
pub async fn continue_watching(state: &AppState, user: &User, limit: i64) -> AppResult<Vec<Value>> {
    let progress: Vec<Progress> = sqlx::query_as(
        "SELECT kind, tmdb_id, season_number, episode_number, info_hash, file_index, position, duration,
                completed, updated_at
         FROM watch_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200",
    )
    .bind(user.id)
    .fetch_all(&state.main)
    .await?;

    // Latest entry per title.
    let mut seen = std::collections::HashSet::new();
    let latest: Vec<Progress> = progress
        .into_iter()
        .filter(|p| seen.insert((p.kind.clone(), p.tmdb_id)))
        .collect();
    let keys: Vec<(String, i64)> = latest.iter().map(|p| (p.kind.clone(), p.tmdb_id)).collect();
    let cards = cards_by_tmdb(state, &keys).await?;

    let mut out = Vec::new();
    for p in latest {
        let Some(card) = cards.get(&(p.kind.clone(), p.tmdb_id)) else { continue };
        if !card.available {
            continue;
        }
        let mut target = json!({ "season_number": p.season_number, "episode_number": p.episode_number });
        let mut position = p.position;
        let mut duration = p.duration;
        if p.completed {
            // Finished: suggest the next episode of a show, drop finished movies.
            if p.kind != "tv" {
                continue;
            }
            let next: Option<(i64, i64, Option<String>)> = sqlx::query_as(
                "SELECT e.season_number, e.episode_number, e.name FROM episodes e
                 WHERE e.media_id = ? AND e.season_number > 0
                   AND (e.season_number > ?2 OR (e.season_number = ?2 AND e.episode_number > ?3))
                   AND EXISTS (SELECT 1 FROM file_episodes fe WHERE fe.episode_id = e.id)
                 ORDER BY e.season_number, e.episode_number LIMIT 1",
            )
            .bind(card.id)
            .bind(p.season_number)
            .bind(p.episode_number)
            .fetch_optional(&state.media)
            .await?;
            let Some((s, e, _)) = next else { continue };
            target = json!({ "season_number": s, "episode_number": e });
            position = 0.0;
            duration = None;
        }
        let episode_name: Option<String> = if p.kind == "tv" {
            sqlx::query_scalar(
                "SELECT name FROM episodes WHERE media_id = ? AND season_number = ? AND episode_number = ?",
            )
            .bind(card.id)
            .bind(target["season_number"].as_i64())
            .bind(target["episode_number"].as_i64())
            .fetch_optional(&state.media)
            .await?
            .flatten()
        } else {
            None
        };
        target["episode_name"] = json!(episode_name);
        out.push(json!({
            "media": card,
            "target": target,
            "position": position,
            "duration": duration,
            "updated_at": p.updated_at,
        }));
        if out.len() as i64 >= limit {
            break;
        }
    }
    Ok(out)
}

async fn watchlist_cards(state: &AppState, user: &User) -> AppResult<Vec<MediaCard>> {
    let keys: Vec<(String, i64)> =
        sqlx::query_as("SELECT kind, tmdb_id FROM watchlist WHERE user_id = ? ORDER BY added_at DESC")
            .bind(user.id)
            .fetch_all(&state.main)
            .await?;
    let cards = cards_by_tmdb(state, &keys).await?;
    Ok(keys.iter().filter_map(|k| cards.get(k).cloned()).collect())
}

async fn home(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> AppResult<Json<Value>> {
    let mut rows = Vec::new();

    let cw = continue_watching(&state, &user, 20).await?;
    if !cw.is_empty() {
        rows.push(json!({ "id": "continue", "title": "Continue Watching", "type": "continue", "items": cw }));
    }

    let recent: Vec<MediaCard> = sqlx::query_as(&format!(
        "SELECT {CARD_COLUMNS} FROM media m WHERE {AVAILABLE}
         ORDER BY (SELECT MAX(t.added_at) FROM torrents t WHERE t.media_id = m.id) DESC LIMIT 24"
    ))
    .fetch_all(&state.media)
    .await?;
    let hero: Vec<&MediaCard> = recent
        .iter()
        .filter(|c| c.backdrop_path.is_some())
        .take(6)
        .collect();
    let hero = json!(hero);
    if !recent.is_empty() {
        rows.push(json!({ "id": "recent", "title": "Recently Added", "type": "media", "items": recent }));
    }

    let list = watchlist_cards(&state, &user).await?;
    if !list.is_empty() {
        rows.push(json!({ "id": "my-list", "title": "My List", "type": "media", "items": list }));
    }

    let movies = cards(&state, &format!("m.kind = 'movie' AND {AVAILABLE}"), "m.rating DESC", 24).await?;
    if !movies.is_empty() {
        rows.push(json!({ "id": "movies", "title": "Movies", "type": "media", "items": movies }));
    }
    let shows = cards(&state, &format!("m.kind = 'tv' AND {AVAILABLE}"), "m.rating DESC", 24).await?;
    if !shows.is_empty() {
        rows.push(json!({ "id": "shows", "title": "TV Shows", "type": "media", "items": shows }));
    }

    // Genre rows for genres with enough titles to be worth a row.
    let genre_counts: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT g.value, COUNT(*) AS n FROM media m, json_each(m.genres) g WHERE {AVAILABLE}
         GROUP BY g.value HAVING n >= 3 ORDER BY n DESC LIMIT 8"
    ))
    .fetch_all(&state.media)
    .await?;
    for (genre, _) in genre_counts {
        let items: Vec<MediaCard> = sqlx::query_as(&format!(
            "SELECT {CARD_COLUMNS} FROM media m WHERE {AVAILABLE}
             AND EXISTS (SELECT 1 FROM json_each(m.genres) g WHERE g.value = ?)
             ORDER BY random() LIMIT 24"
        ))
        .bind(&genre)
        .fetch_all(&state.media)
        .await?;
        rows.push(json!({ "id": format!("genre-{genre}"), "title": genre, "type": "media", "items": items }));
    }

    if user.can(perm::ADD_TORRENTS) {
        let missing = cards(&state, &format!("NOT {AVAILABLE}"), "m.added_at DESC", 24).await?;
        if !missing.is_empty() {
            rows.push(json!({ "id": "needs-sources", "title": "Waiting for a Torrent", "type": "media", "items": missing }));
        }
    }

    Ok(Json(json!({ "hero": hero, "rows": rows })))
}

#[derive(Deserialize)]
struct ListQuery {
    kind: Option<String>,
    genre: Option<String>,
    q: Option<String>,
    sort: Option<String>,
    available: Option<String>,
    page: Option<i64>,
    limit: Option<i64>,
}

async fn list(
    State(state): State<AppState>,
    CurrentUser(_): CurrentUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Value>> {
    let mut clauses = vec!["1 = 1".to_string()];
    let mut binds: Vec<String> = Vec::new();
    if let Some(k) = q.kind.as_deref().and_then(MediaKind::parse) {
        clauses.push(format!("m.kind = '{}'", k.as_str()));
    }
    if let Some(g) = q.genre.filter(|g| !g.is_empty()) {
        clauses.push("EXISTS (SELECT 1 FROM json_each(m.genres) g WHERE g.value = ?)".into());
        binds.push(g);
    }
    if let Some(text) = q.q.filter(|t| !t.trim().is_empty()) {
        clauses.push("(m.title LIKE ? OR m.original_title LIKE ?)".into());
        let like = format!("%{}%", text.trim());
        binds.push(like.clone());
        binds.push(like);
    }
    match q.available.as_deref() {
        Some("all") => {}
        Some("missing") => clauses.push(format!("NOT {AVAILABLE}")),
        _ => clauses.push(AVAILABLE.to_string()),
    }
    let order = match q.sort.as_deref() {
        Some("title") => "m.sort_title ASC",
        Some("year") => "m.year DESC, m.sort_title",
        Some("rating") => "m.rating DESC",
        _ => "m.added_at DESC",
    };
    let limit = q.limit.unwrap_or(60).clamp(1, 200);
    let page = q.page.unwrap_or(1).max(1);
    let where_sql = clauses.join(" AND ");

    let sql = format!(
        "SELECT {CARD_COLUMNS} FROM media m WHERE {where_sql} ORDER BY {order} LIMIT {limit} OFFSET {}",
        (page - 1) * limit
    );
    let mut query = sqlx::query_as::<_, MediaCard>(&sql);
    for b in &binds {
        query = query.bind(b);
    }
    let items = query.fetch_all(&state.media).await?;

    let count_sql = format!("SELECT COUNT(*) FROM media m WHERE {where_sql}");
    let mut count = sqlx::query_scalar::<_, i64>(&count_sql);
    for b in &binds {
        count = count.bind(b);
    }
    let total = count.fetch_one(&state.media).await?;

    Ok(Json(json!({ "items": items, "total": total, "page": page, "limit": limit })))
}

async fn genres(State(state): State<AppState>, CurrentUser(_): CurrentUser) -> AppResult<Json<Vec<String>>> {
    let genres: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT g.value FROM media m, json_each(m.genres) g ORDER BY g.value",
    )
    .fetch_all(&state.media)
    .await?;
    Ok(Json(genres))
}

#[derive(Deserialize)]
struct AddBody {
    kind: String,
    tmdb_id: i64,
}

async fn add(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Json(body): Json<AddBody>,
) -> AppResult<Json<Value>> {
    user.require(perm::ADD_MEDIA)?;
    let kind = MediaKind::parse(&body.kind).ok_or_else(|| AppError::bad_request("kind must be movie or tv"))?;
    if let Some(id) = library::find_by_tmdb(&state.media, kind, body.tmdb_id).await? {
        return Ok(Json(json!({ "id": id, "created": false })));
    }
    let id = library::add_or_refresh(&state, kind, body.tmdb_id).await?;
    let media = library::get_media(&state.media, id).await?;
    audit::log(
        &state,
        Some(&user),
        &client,
        "library.add",
        Some(media.title.clone()),
        Some(json!({ "kind": kind, "tmdb_id": body.tmdb_id })),
    )
    .await;
    Ok(Json(json!({ "id": id, "created": true })))
}

async fn refresh(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_LIBRARY)?;
    let media = library::get_media(&state.media, id).await?;
    let kind = MediaKind::parse(&media.kind).unwrap_or(MediaKind::Movie);
    library::add_or_refresh(&state, kind, media.tmdb_id).await?;
    audit::log(&state, Some(&user), &client, "library.refresh", Some(media.title), None).await;
    Ok(Json(json!({ "ok": true })))
}

async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    user.require(perm::MANAGE_LIBRARY)?;
    let media = library::get_media(&state.media, id).await?;
    let hashes: Vec<String> = sqlx::query_scalar("SELECT info_hash FROM torrents WHERE media_id = ?")
        .bind(id)
        .fetch_all(&state.media)
        .await?;
    for h in &hashes {
        let _ = state.engine.evict(h).await;
    }
    sqlx::query("DELETE FROM media WHERE id = ?")
        .bind(id)
        .execute(&state.media)
        .await?;
    sqlx::query("DELETE FROM torrent_jobs WHERE kind = ? AND tmdb_id = ?")
        .bind(&media.kind)
        .bind(media.tmdb_id)
        .execute(&state.main)
        .await?;
    audit::log(&state, Some(&user), &client, "library.remove", Some(media.title), None).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Serialize, sqlx::FromRow)]
struct SeasonWithAvailability {
    id: i64,
    season_number: i64,
    name: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    air_date: Option<String>,
    episode_count: i64,
    available_episodes: i64,
}

async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let media = library::get_media(&state.media, id).await?;
    let is_tv = media.kind == "tv";

    let seasons: Vec<SeasonWithAvailability> = if is_tv {
        sqlx::query_as(
            "SELECT s.id, s.season_number, s.name, s.overview, s.poster_path, s.air_date, s.episode_count,
                    (SELECT COUNT(DISTINCT e.id) FROM episodes e JOIN file_episodes fe ON fe.episode_id = e.id
                     WHERE e.media_id = s.media_id AND e.season_number = s.season_number) AS available_episodes
             FROM seasons s WHERE s.media_id = ? ORDER BY s.season_number = 0, s.season_number",
        )
        .bind(id)
        .fetch_all(&state.media)
        .await?
    } else {
        Vec::new()
    };

    let progress: Vec<Progress> = sqlx::query_as(
        "SELECT kind, tmdb_id, season_number, episode_number, info_hash, file_index, position, duration,
                completed, updated_at
         FROM watch_progress WHERE user_id = ? AND kind = ? AND tmdb_id = ? ORDER BY updated_at DESC",
    )
    .bind(user.id)
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .fetch_all(&state.main)
    .await?;

    let in_watchlist: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM watchlist WHERE user_id = ? AND kind = ? AND tmdb_id = ?)",
    )
    .bind(user.id)
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .fetch_one(&state.main)
    .await?;

    let torrent_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM torrents WHERE media_id = ?")
        .bind(id)
        .fetch_one(&state.media)
        .await?;

    // What the big play button should do.
    let play = if is_tv {
        next_up(&state, id, progress.first()).await?
    } else {
        let files = files::files_for_movie(&state.media, id).await?;
        let resume = progress.first().filter(|p| !p.completed).map(|p| p.position);
        files.first().map(|f| {
            json!({ "file_id": f.file_id, "position": resume.unwrap_or(0.0), "duration": f.duration })
        })
    };

    let movie_files = if is_tv {
        Vec::new()
    } else {
        files::files_for_movie(&state.media, id).await?
    };

    let request: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, status FROM requests WHERE kind = ? AND tmdb_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .fetch_optional(&state.main)
    .await?;

    Ok(Json(json!({
        "media": media,
        "seasons": seasons,
        "in_watchlist": in_watchlist,
        "torrent_count": torrent_count,
        "play": play,
        "files": movie_files,
        "progress": progress.first(),
        "request": request.map(|(id, status)| json!({ "id": id, "status": status })),
    })))
}

/// For a show: resume the in-progress episode, otherwise the one after the
/// last finished episode, otherwise the first available one.
async fn next_up(state: &AppState, media_id: i64, last: Option<&Progress>) -> AppResult<Option<Value>> {
    #[derive(sqlx::FromRow)]
    struct Ep {
        id: i64,
        season_number: i64,
        episode_number: i64,
        name: Option<String>,
    }
    let base = "SELECT e.id, e.season_number, e.episode_number, e.name FROM episodes e
                WHERE e.media_id = ? AND EXISTS (SELECT 1 FROM file_episodes fe WHERE fe.episode_id = e.id)";

    let (ep, position): (Option<Ep>, f64) = match last {
        Some(p) if !p.completed && p.season_number >= 0 => (
            sqlx::query_as(&format!("{base} AND e.season_number = ? AND e.episode_number = ?"))
                .bind(media_id)
                .bind(p.season_number)
                .bind(p.episode_number)
                .fetch_optional(&state.media)
                .await?,
            p.position,
        ),
        Some(p) => (
            sqlx::query_as(&format!(
                "{base} AND (e.season_number > ?2 OR (e.season_number = ?2 AND e.episode_number > ?3))
                 AND e.season_number > 0 ORDER BY e.season_number, e.episode_number LIMIT 1"
            ))
            .bind(media_id)
            .bind(p.season_number)
            .bind(p.episode_number)
            .fetch_optional(&state.media)
            .await?,
            0.0,
        ),
        None => (None, 0.0),
    };
    let ep = match ep {
        Some(e) => Some(e),
        None => sqlx::query_as(&format!(
            "{base} ORDER BY e.season_number = 0, e.season_number, e.episode_number LIMIT 1"
        ))
        .bind(media_id)
        .fetch_optional(&state.media)
        .await?,
    };
    let Some(ep) = ep else { return Ok(None) };
    let files = files::files_for_episode(&state.media, ep.id).await?;
    Ok(files.first().map(|f| {
        json!({
            "file_id": f.file_id,
            "position": position,
            "duration": f.duration,
            "season_number": ep.season_number,
            "episode_number": ep.episode_number,
            "episode_name": ep.name,
        })
    }))
}

#[derive(Deserialize)]
struct EpisodesQuery {
    season: Option<i64>,
}

async fn episodes(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Query(q): Query<EpisodesQuery>,
) -> AppResult<Json<Value>> {
    let media = library::get_media(&state.media, id).await?;
    let episodes = library::episodes(&state.media, id, q.season).await?;

    let progress: Vec<Progress> = sqlx::query_as(
        "SELECT kind, tmdb_id, season_number, episode_number, info_hash, file_index, position, duration,
                completed, updated_at
         FROM watch_progress WHERE user_id = ? AND kind = ? AND tmdb_id = ?",
    )
    .bind(user.id)
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .fetch_all(&state.main)
    .await?;
    let progress: HashMap<(i64, i64), &Progress> = progress
        .iter()
        .map(|p| ((p.season_number, p.episode_number), p))
        .collect();

    let mut out = Vec::with_capacity(episodes.len());
    for e in episodes {
        let files = files::files_for_episode(&state.media, e.id).await?;
        let p = progress.get(&(e.season_number, e.episode_number));
        let mut v = serde_json::to_value(&e).unwrap_or_default();
        v["files"] = json!(files);
        v["progress"] = json!(p.map(|p| json!({
            "position": p.position,
            "duration": p.duration,
            "completed": p.completed,
        })));
        out.push(v);
    }
    Ok(Json(json!(out)))
}
