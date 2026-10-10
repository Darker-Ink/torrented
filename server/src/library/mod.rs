//! Library (media.db) models and queries.

pub mod files;
pub mod transfer;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool, types::Json};

use crate::{
    error::{AppError, AppResult},
    metadata::{CastMember, EpisodeInfo, MediaDetails, MediaKind},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Media {
    pub id: i64,
    pub kind: String,
    pub tmdb_id: i64,
    pub tvdb_id: Option<i64>,
    pub imdb_id: Option<String>,
    pub title: String,
    pub original_title: Option<String>,
    pub overview: Option<String>,
    pub tagline: Option<String>,
    pub status: Option<String>,
    pub release_date: Option<String>,
    pub year: Option<i64>,
    pub runtime: Option<i64>,
    pub rating: Option<f64>,
    pub vote_count: Option<i64>,
    pub certification: Option<String>,
    pub original_language: Option<String>,
    pub genres: Json<Vec<String>>,
    pub networks: Json<Vec<String>>,
    pub cast_members: Json<Vec<CastMember>>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub logo_path: Option<String>,
    pub trailer_key: Option<String>,
    pub added_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight shape used for rows and grids.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MediaCard {
    pub id: i64,
    pub kind: String,
    pub tmdb_id: i64,
    pub title: String,
    pub year: Option<i64>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub logo_path: Option<String>,
    pub rating: Option<f64>,
    pub certification: Option<String>,
    pub runtime: Option<i64>,
    pub genres: Json<Vec<String>>,
    pub added_at: DateTime<Utc>,
    pub available: bool,
}

pub const CARD_COLUMNS: &str = "m.id, m.kind, m.tmdb_id, m.title, m.year, m.overview, m.poster_path, \
    m.backdrop_path, m.logo_path, m.rating, m.certification, m.runtime, m.genres, m.added_at, \
    EXISTS (SELECT 1 FROM torrents t WHERE t.media_id = m.id) AS available";


#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Episode {
    pub id: i64,
    pub media_id: i64,
    pub season_number: i64,
    pub episode_number: i64,
    pub absolute_number: Option<i64>,
    pub name: Option<String>,
    pub overview: Option<String>,
    pub still_path: Option<String>,
    pub air_date: Option<String>,
    pub runtime: Option<i64>,
    pub rating: Option<f64>,
}

pub async fn get_media(pool: &SqlitePool, id: i64) -> AppResult<Media> {
    sqlx::query_as("SELECT * FROM media WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found("title not found"))
}

pub async fn find_by_tmdb(pool: &SqlitePool, kind: MediaKind, tmdb_id: i64) -> AppResult<Option<i64>> {
    Ok(sqlx::query_scalar("SELECT id FROM media WHERE kind = ? AND tmdb_id = ?")
        .bind(kind.as_str())
        .bind(tmdb_id)
        .fetch_optional(pool)
        .await?)
}

fn sort_title(title: &str) -> String {
    let lower = title.to_lowercase();
    for article in ["the ", "a ", "an "] {
        if let Some(rest) = lower.strip_prefix(article) {
            return rest.to_string();
        }
    }
    lower
}

async fn upsert_media(conn: &mut SqliteConnection, d: &MediaDetails) -> sqlx::Result<i64> {
    let now = Utc::now();
    sqlx::query_scalar(
        "INSERT INTO media (
            kind, tmdb_id, tvdb_id, imdb_id, title, original_title, sort_title, overview, tagline,
            status, release_date, year, runtime, rating, vote_count, certification,
            original_language, genres, networks, cast_members, poster_path, backdrop_path,
            logo_path, trailer_key, added_at, updated_at, metadata_refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (kind, tmdb_id) DO UPDATE SET
            tvdb_id = excluded.tvdb_id, imdb_id = excluded.imdb_id, title = excluded.title,
            original_title = excluded.original_title, sort_title = excluded.sort_title,
            overview = excluded.overview, tagline = excluded.tagline, status = excluded.status,
            release_date = excluded.release_date, year = excluded.year, runtime = excluded.runtime,
            rating = excluded.rating, vote_count = excluded.vote_count,
            certification = excluded.certification, original_language = excluded.original_language,
            genres = excluded.genres, networks = excluded.networks,
            cast_members = excluded.cast_members, poster_path = excluded.poster_path,
            backdrop_path = excluded.backdrop_path, logo_path = excluded.logo_path,
            trailer_key = excluded.trailer_key, updated_at = excluded.updated_at,
            metadata_refreshed_at = excluded.metadata_refreshed_at
        RETURNING id",
    )
    .bind(d.kind.as_str())
    .bind(d.tmdb_id)
    .bind(d.tvdb_id)
    .bind(&d.imdb_id)
    .bind(&d.title)
    .bind(&d.original_title)
    .bind(sort_title(&d.title))
    .bind(&d.overview)
    .bind(&d.tagline)
    .bind(&d.status)
    .bind(&d.release_date)
    .bind(d.year)
    .bind(d.runtime)
    .bind(d.rating)
    .bind(d.vote_count)
    .bind(&d.certification)
    .bind(&d.original_language)
    .bind(Json(&d.genres))
    .bind(Json(&d.networks))
    .bind(Json(&d.cast))
    .bind(&d.poster_path)
    .bind(&d.backdrop_path)
    .bind(&d.logo_path)
    .bind(&d.trailer_key)
    .bind(now)
    .bind(now)
    .bind(now)
    .fetch_one(&mut *conn)
    .await
}

async fn sync_seasons(
    conn: &mut SqliteConnection,
    media_id: i64,
    d: &MediaDetails,
    episodes: &[EpisodeInfo],
) -> sqlx::Result<()> {
    for s in &d.seasons {
        sqlx::query(
            "INSERT INTO seasons (media_id, season_number, name, overview, poster_path, air_date, episode_count)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (media_id, season_number) DO UPDATE SET
                name = excluded.name, overview = excluded.overview,
                poster_path = excluded.poster_path, air_date = excluded.air_date,
                episode_count = excluded.episode_count",
        )
        .bind(media_id)
        .bind(s.season_number)
        .bind(&s.name)
        .bind(&s.overview)
        .bind(&s.poster_path)
        .bind(&s.air_date)
        .bind(s.episode_count)
        .execute(&mut *conn)
        .await?;
    }
    // Seasons that only TVDB knows about.
    let mut extra: Vec<i64> = episodes.iter().map(|e| e.season_number).collect();
    extra.sort_unstable();
    extra.dedup();
    for season in extra {
        let count = episodes.iter().filter(|e| e.season_number == season).count() as i64;
        sqlx::query(
            "INSERT INTO seasons (media_id, season_number, name, episode_count) VALUES (?, ?, ?, ?)
             ON CONFLICT (media_id, season_number) DO UPDATE SET
                episode_count = MAX(seasons.episode_count, excluded.episode_count)",
        )
        .bind(media_id)
        .bind(season)
        .bind(if season == 0 { "Specials".to_string() } else { format!("Season {season}") })
        .bind(count)
        .execute(&mut *conn)
        .await?;
    }

    for e in episodes {
        sqlx::query(
            "INSERT INTO episodes (
                media_id, season_number, episode_number, absolute_number, name, overview,
                still_path, air_date, runtime, rating, tmdb_id, tvdb_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (media_id, season_number, episode_number) DO UPDATE SET
                absolute_number = COALESCE(excluded.absolute_number, episodes.absolute_number),
                name = excluded.name, overview = excluded.overview,
                still_path = COALESCE(excluded.still_path, episodes.still_path),
                air_date = excluded.air_date, runtime = excluded.runtime,
                rating = excluded.rating, tmdb_id = COALESCE(excluded.tmdb_id, episodes.tmdb_id),
                tvdb_id = COALESCE(excluded.tvdb_id, episodes.tvdb_id)",
        )
        .bind(media_id)
        .bind(e.season_number)
        .bind(e.episode_number)
        .bind(e.absolute_number)
        .bind(&e.name)
        .bind(&e.overview)
        .bind(&e.still_path)
        .bind(&e.air_date)
        .bind(e.runtime)
        .bind(e.rating)
        .bind(e.tmdb_id)
        .bind(e.tvdb_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Add a title to the library (or refresh it if it's already there) using
/// fresh metadata. Returns the media id.
pub async fn add_or_refresh(
    state: &AppState,
    kind: MediaKind,
    tmdb_id: i64,
) -> AppResult<i64> {
    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let details = state
        .metadata
        .tmdb
        .details(&key, &lang, kind, tmdb_id)
        .await
        .map_err(|e| AppError::Upstream(format!("{e:#}")))?;
    let episodes = match kind {
        MediaKind::Tv => state
            .metadata
            .all_episodes(&state.settings, &details)
            .await
            .map_err(|e| AppError::Upstream(format!("{e:#}")))?,
        MediaKind::Movie => Vec::new(),
    };

    let mut tx = state.media.begin().await?;
    let id = upsert_media(&mut tx, &details).await?;
    if kind == MediaKind::Tv {
        sync_seasons(&mut tx, id, &details, &episodes).await?;
    }
    tx.commit().await?;

    // New episodes may now match files that previously didn't map.
    if kind == MediaKind::Tv {
        let torrents: Vec<i64> = sqlx::query_scalar("SELECT id FROM torrents WHERE media_id = ?")
            .bind(id)
            .fetch_all(&state.media)
            .await?;
        for t in torrents {
            crate::torrents::scan::apply_auto_mapping(&state.media, t).await?;
        }
    }
    Ok(id)
}


pub async fn episodes(pool: &SqlitePool, media_id: i64, season: Option<i64>) -> AppResult<Vec<Episode>> {
    Ok(sqlx::query_as(
        "SELECT id, media_id, season_number, episode_number, absolute_number, name, overview,
                still_path, air_date, runtime, rating
         FROM episodes WHERE media_id = ? AND (?2 IS NULL OR season_number = ?2)
         ORDER BY season_number, episode_number",
    )
    .bind(media_id)
    .bind(season)
    .fetch_all(pool)
    .await?)
}
