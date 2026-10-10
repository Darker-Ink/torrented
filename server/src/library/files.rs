//! Picking which torrent file to play.

use serde::Serialize;
use sqlx::{SqlitePool, types::Json};

use crate::error::AppResult;

/// 4K releases are nearly always HEVC, which most browsers need transcoded,
/// so 1080p is preferred when several sources exist.
pub const RESOLUTION_RANK: &str = "CASE f.resolution
    WHEN '1080p' THEN 5 WHEN '720p' THEN 4 WHEN '2160p' THEN 3 WHEN '576p' THEN 2 WHEN '480p' THEN 1
    ELSE 0 END";

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PlayableFile {
    pub file_id: i64,
    pub torrent_id: i64,
    pub torrent_name: String,
    pub path: String,
    pub size: i64,
    pub resolution: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub duration: Option<f64>,
    pub source: Option<String>,
    pub hdr: Option<String>,
    pub release_group: Option<String>,
}

const PLAYABLE_COLUMNS: &str = "f.id AS file_id, t.id AS torrent_id, t.name AS torrent_name, f.path, f.size, \
    f.resolution, f.video_codec, f.audio_codec, f.duration, t.source, t.hdr, t.release_group";

pub async fn files_for_episode(pool: &SqlitePool, episode_id: i64) -> AppResult<Vec<PlayableFile>> {
    Ok(sqlx::query_as(&format!(
        "SELECT {PLAYABLE_COLUMNS} FROM file_episodes fe
         JOIN torrent_files f ON f.id = fe.file_id
         JOIN torrents t ON t.id = f.torrent_id
         WHERE fe.episode_id = ? AND f.mapping != 'ignored'
         ORDER BY {RESOLUTION_RANK} DESC, f.size DESC"
    ))
    .bind(episode_id)
    .fetch_all(pool)
    .await?)
}

/// Video files of a movie, best first.
pub async fn files_for_movie(pool: &SqlitePool, media_id: i64) -> AppResult<Vec<PlayableFile>> {
    Ok(sqlx::query_as(&format!(
        "SELECT {PLAYABLE_COLUMNS} FROM torrent_files f
         JOIN torrents t ON t.id = f.torrent_id
         WHERE t.media_id = ? AND f.kind = 'video' AND f.mapping != 'ignored' AND f.is_sample = 0
         ORDER BY {RESOLUTION_RANK} DESC, f.size DESC"
    ))
    .bind(media_id)
    .fetch_all(pool)
    .await?)
}

/// Everything needed to stream a file and attribute progress to it.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileContext {
    pub file_id: i64,
    pub file_index: i64,
    pub path: String,
    pub size: i64,
    pub kind: String,
    pub container: Option<String>,
    pub duration: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub resolution: Option<String>,
    pub season_number: Option<i64>,
    pub episode_numbers: Json<Vec<i64>>,
    pub probe: Option<Json<serde_json::Value>>,
    pub torrent_id: i64,
    pub info_hash: String,
    #[serde(skip)]
    pub metainfo: Option<Vec<u8>>,
    pub media_id: i64,
    pub media_kind: String,
    pub tmdb_id: i64,
    pub title: String,
}

pub async fn file_context(pool: &SqlitePool, file_id: i64) -> AppResult<Option<FileContext>> {
    Ok(sqlx::query_as(
        "SELECT f.id AS file_id, f.file_index, f.path, f.size, f.kind, f.container, f.duration,
                f.video_codec, f.audio_codec, f.resolution, f.season_number, f.episode_numbers, f.probe,
                t.id AS torrent_id, t.info_hash, t.metainfo,
                m.id AS media_id, m.kind AS media_kind, m.tmdb_id, m.title
         FROM torrent_files f
         JOIN torrents t ON t.id = f.torrent_id
         JOIN media m ON m.id = t.media_id
         WHERE f.id = ?",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await?)
}
