//! Exporting and importing the shareable library database.

use std::path::Path;

use anyhow::{Context, bail};
use serde::Serialize;
use sqlx::{Connection, SqliteConnection, SqlitePool};

use crate::db;

#[derive(Debug, Serialize)]
pub struct LibraryInfo {
    pub schema_version: i64,
    pub library_id: Option<String>,
    pub created_at: Option<String>,
    pub titles: i64,
    pub movies: i64,
    pub shows: i64,
    pub episodes: i64,
    pub torrents: i64,
    pub files: i64,
    pub total_size: i64,
}

pub async fn info(conn: &mut SqliteConnection) -> anyhow::Result<LibraryInfo> {
    let meta = |key: &'static str| {
        sqlx::query_scalar::<_, String>("SELECT value FROM schema_meta WHERE key = ?").bind(key)
    };
    let count = |sql: &'static str| sqlx::query_scalar::<_, i64>(sql);
    Ok(LibraryInfo {
        schema_version: db::schema_version(conn).await?,
        library_id: meta("library_id").fetch_optional(&mut *conn).await?,
        created_at: meta("created_at").fetch_optional(&mut *conn).await?,
        titles: count("SELECT COUNT(*) FROM media").fetch_one(&mut *conn).await?,
        movies: count("SELECT COUNT(*) FROM media WHERE kind = 'movie'").fetch_one(&mut *conn).await?,
        shows: count("SELECT COUNT(*) FROM media WHERE kind = 'tv'").fetch_one(&mut *conn).await?,
        episodes: count("SELECT COUNT(*) FROM episodes").fetch_one(&mut *conn).await?,
        torrents: count("SELECT COUNT(*) FROM torrents").fetch_one(&mut *conn).await?,
        files: count("SELECT COUNT(*) FROM torrent_files").fetch_one(&mut *conn).await?,
        total_size: count("SELECT COALESCE(SUM(total_size), 0) FROM torrents").fetch_one(&mut *conn).await?,
    })
}

/// Write a consistent, compacted copy of the library to `dest`.
pub async fn export(pool: &SqlitePool, dest: &Path) -> anyhow::Result<()> {
    if dest.exists() {
        tokio::fs::remove_file(dest).await?;
    }
    sqlx::query("VACUUM INTO ?")
        .bind(dest.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .context("exporting library")?;
    // Exports are self-contained single files.
    let mut conn = db::open_connection(dest).await?;
    sqlx::query("PRAGMA journal_mode = DELETE").execute(&mut conn).await?;
    conn.close().await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    /// Add titles/torrents that aren't present yet, keep everything else.
    Merge,
    /// Replace the whole library with the imported one.
    Replace,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub source_version: i64,
    pub migrated_to: i64,
    pub titles_added: i64,
    pub torrents_added: i64,
    pub files_added: i64,
}

async fn columns(conn: &mut SqliteConnection, table: &str, skip: &[&str]) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(&format!("PRAGMA main.table_info({table})"))
            .fetch_all(&mut *conn)
            .await?;
    Ok(rows
        .into_iter()
        .map(|r| r.1)
        .filter(|c| !skip.contains(&c.as_str()))
        .collect())
}

fn list(cols: &[String], prefix: &str) -> String {
    cols.iter()
        .map(|c| format!("{prefix}{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

async fn count(conn: &mut SqliteConnection, table: &str) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar(&format!("SELECT COUNT(*) FROM main.{table}"))
        .fetch_one(&mut *conn)
        .await?)
}

/// Import a library file. The file is first migrated to the current schema
/// on its own, then merged row by row using natural keys (TMDB ids, info
/// hashes, file indexes, episode numbers) so ids never clash.
pub async fn import(pool: &SqlitePool, file: &Path, mode: ImportMode) -> anyhow::Result<ImportResult> {
    let source_version = {
        let mut conn = db::open_connection(file)
            .await
            .context("the uploaded file is not a SQLite database")?;
        let has_media: Option<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media'")
                .fetch_optional(&mut conn)
                .await
                .context("the uploaded file is not a SQLite database")?;
        if has_media.is_none() {
            bail!("the uploaded file is not a torrented library");
        }
        let v = db::schema_version(&mut conn).await?;
        db::migrate(&mut conn, "imported media", db::media::MIGRATIONS).await?;
        conn.close().await?;
        v
    };

    let mut conn = pool.acquire().await?;
    sqlx::query("ATTACH DATABASE ? AS src")
        .bind(file.to_string_lossy().as_ref())
        .execute(&mut *conn)
        .await?;

    let result = merge(&mut conn, mode, source_version).await;

    let _ = sqlx::query("DETACH DATABASE src").execute(&mut *conn).await;
    result
}


async fn merge(conn: &mut SqliteConnection, mode: ImportMode, source_version: i64) -> anyhow::Result<ImportResult> {
    let before_media = count(conn, "media").await?;
    let before_torrents = count(conn, "torrents").await?;
    let before_files = count(conn, "torrent_files").await?;

    let mut tx = conn.begin().await?;
    if mode == ImportMode::Replace {
        sqlx::query("DELETE FROM main.media").execute(&mut *tx).await?;
    }

    let media_cols = columns(&mut tx, "media", &["id"]).await?;
    sqlx::query(&format!(
        "INSERT INTO main.media ({cols}) SELECT {src} FROM src.media s
         WHERE NOT EXISTS (SELECT 1 FROM main.media m WHERE m.kind = s.kind AND m.tmdb_id = s.tmdb_id)",
        cols = list(&media_cols, ""),
        src = list(&media_cols, "s."),
    ))
    .execute(&mut *tx)
    .await?;

    let season_cols = columns(&mut tx, "seasons", &["id", "media_id"]).await?;
    sqlx::query(&format!(
        "INSERT OR IGNORE INTO main.seasons (media_id, {cols})
         SELECT m.id, {src} FROM src.seasons s
         JOIN src.media sm ON sm.id = s.media_id
         JOIN main.media m ON m.kind = sm.kind AND m.tmdb_id = sm.tmdb_id",
        cols = list(&season_cols, ""),
        src = list(&season_cols, "s."),
    ))
    .execute(&mut *tx)
    .await?;

    let ep_cols = columns(&mut tx, "episodes", &["id", "media_id"]).await?;
    sqlx::query(&format!(
        "INSERT OR IGNORE INTO main.episodes (media_id, {cols})
         SELECT m.id, {src} FROM src.episodes s
         JOIN src.media sm ON sm.id = s.media_id
         JOIN main.media m ON m.kind = sm.kind AND m.tmdb_id = sm.tmdb_id",
        cols = list(&ep_cols, ""),
        src = list(&ep_cols, "s."),
    ))
    .execute(&mut *tx)
    .await?;

    let torrent_cols = columns(&mut tx, "torrents", &["id", "media_id"]).await?;
    sqlx::query(&format!(
        "INSERT OR IGNORE INTO main.torrents (media_id, {cols})
         SELECT m.id, {src} FROM src.torrents s
         JOIN src.media sm ON sm.id = s.media_id
         JOIN main.media m ON m.kind = sm.kind AND m.tmdb_id = sm.tmdb_id",
        cols = list(&torrent_cols, ""),
        src = list(&torrent_cols, "s."),
    ))
    .execute(&mut *tx)
    .await?;

    let file_cols = columns(&mut tx, "torrent_files", &["id", "torrent_id"]).await?;
    sqlx::query(&format!(
        "INSERT OR IGNORE INTO main.torrent_files (torrent_id, {cols})
         SELECT t.id, {src} FROM src.torrent_files s
         JOIN src.torrents st ON st.id = s.torrent_id
         JOIN main.torrents t ON t.info_hash = st.info_hash",
        cols = list(&file_cols, ""),
        src = list(&file_cols, "s."),
    ))
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO main.file_episodes (file_id, episode_id)
         SELECT f.id, e.id FROM src.file_episodes sfe
         JOIN src.torrent_files sf ON sf.id = sfe.file_id
         JOIN src.torrents st ON st.id = sf.torrent_id
         JOIN main.torrents t ON t.info_hash = st.info_hash
         JOIN main.torrent_files f ON f.torrent_id = t.id AND f.file_index = sf.file_index
         JOIN src.episodes se ON se.id = sfe.episode_id
         JOIN src.media sm ON sm.id = se.media_id
         JOIN main.media m ON m.kind = sm.kind AND m.tmdb_id = sm.tmdb_id
         JOIN main.episodes e ON e.media_id = m.id AND e.season_number = se.season_number
                             AND e.episode_number = se.episode_number",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let after_media = count(conn, "media").await?;
    let after_torrents = count(conn, "torrents").await?;
    let after_files = count(conn, "torrent_files").await?;
    let (bm, bt, bf) = if mode == ImportMode::Replace {
        (0, 0, 0)
    } else {
        (before_media, before_torrents, before_files)
    };
    Ok(ImportResult {
        source_version,
        migrated_to: db::media::latest_version(),
        titles_added: after_media - bm,
        torrents_added: after_torrents - bt,
        files_added: after_files - bf,
    })
}

