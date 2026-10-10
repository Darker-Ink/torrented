//! Adding torrents to titles and working out what is inside them.
//!
//! 1. Metadata is resolved (instantly for .torrent files, from peers for
//!    magnet links) without downloading content.
//! 2. Every file is classified and its name parsed; video files are mapped
//!    to episodes of the show.
//! 3. Optionally each video file is partially scanned with ffprobe, which
//!    only pulls the pieces holding the container headers, to confirm codecs,
//!    resolution and duration. Durations that don't fit the mapped episodes
//!    are reported as warnings.

use std::sync::{Arc, LazyLock};

use anyhow::Context;
use bytes::Bytes;
use chrono::Utc;
use serde::Serialize;
use sqlx::{SqlitePool, types::Json};
use tokio::sync::Semaphore;

use super::{
    engine::{ResolvedTorrent, TorrentSource},
    parser::{self, FileKind},
};
use crate::{
    auth::User,
    error::{AppError, AppResult},
    library,
    metadata::MediaKind,
    state::AppState,
    streaming::ffmpeg::ProbeResult,
};

static PROBES: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(2)));
const MAX_TORRENT_FILE: usize = 10 * 1024 * 1024;

pub enum AddInput {
    Magnet(String),
    File(Bytes),
    Url(String),
}

#[derive(Debug, Serialize)]
pub struct AddOutcome {
    pub info_hash: String,
    pub name: Option<String>,
    pub status: String,
}

fn magnet_for(info_hash: &str, name: &str, trackers: &[String]) -> String {
    let mut m = format!(
        "magnet:?xt=urn:btih:{info_hash}&dn={}",
        urlencoding::encode(name)
    );
    for t in trackers.iter().take(20) {
        m.push_str("&tr=");
        m.push_str(&urlencoding::encode(t));
    }
    m
}

async fn fetch_torrent_url(url: &str) -> AppResult<Bytes> {
    let parsed = url::Url::parse(url).map_err(|_| AppError::bad_request("invalid URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::bad_request("only http(s) URLs are supported"));
    }
    let client = reqwest::Client::new();
    let res = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| AppError::bad_request(format!("could not download torrent: {e}")))?;
    if !res.status().is_success() {
        return Err(AppError::bad_request(format!(
            "could not download torrent: HTTP {}",
            res.status()
        )));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::bad_request(format!("could not download torrent: {e}")))?;
    if bytes.len() > MAX_TORRENT_FILE {
        return Err(AppError::bad_request("torrent file is too large"));
    }
    Ok(bytes)
}

/// Attach a torrent to a title. Resolution and scanning continue in the
/// background; progress is visible through `torrent_jobs`.
pub async fn add_torrent(
    state: &AppState,
    media_id: i64,
    input: AddInput,
    user: &User,
) -> AppResult<AddOutcome> {
    let media = library::get_media(&state.media, media_id).await?;

    let input = match input {
        AddInput::Url(u) if u.starts_with("magnet:") => AddInput::Magnet(u),
        AddInput::Url(u) => AddInput::File(fetch_torrent_url(&u).await?),
        other => other,
    };

    let (info_hash, name, magnet, resolved) = match input {
        AddInput::Magnet(m) => {
            super::engine::validate_magnet(&m).map_err(|e| AppError::bad_request(e.to_string()))?;
            let parsed = librqbit::Magnet::parse(&m)
                .map_err(|e| AppError::bad_request(format!("invalid magnet link: {e}")))?;
            let hash = parsed
                .as_id20()
                .ok_or_else(|| AppError::bad_request("only BitTorrent v1 magnet links are supported"))?
                .as_string();
            (hash, parsed.name.clone(), m, None)
        }
        AddInput::File(bytes) => {
            let resolved = state
                .engine
                .resolve(TorrentSource::File(bytes))
                .await
                .map_err(|e| AppError::bad_request(format!("invalid torrent file: {e:#}")))?;
            let magnet = magnet_for(&resolved.info_hash, &resolved.name, &resolved.trackers);
            (
                resolved.info_hash.clone(),
                Some(resolved.name.clone()),
                magnet,
                Some(resolved),
            )
        }
        AddInput::Url(_) => unreachable!(),
    };

    let existing: Option<String> = sqlx::query_scalar(
        "SELECT m.title FROM torrents t JOIN media m ON m.id = t.media_id WHERE t.info_hash = ?",
    )
    .bind(&info_hash)
    .fetch_optional(&state.media)
    .await?;
    if let Some(title) = existing {
        return Err(AppError::conflict(format!("this torrent is already attached to {title}")));
    }
    let running: Option<String> = sqlx::query_scalar(
        "SELECT status FROM torrent_jobs WHERE info_hash = ? AND status IN ('resolving', 'probing')",
    )
    .bind(&info_hash)
    .fetch_optional(&state.main)
    .await?;
    if running.is_some() {
        return Err(AppError::conflict("this torrent is already being added"));
    }

    let now = Utc::now();
    sqlx::query(
        "INSERT INTO torrent_jobs (info_hash, kind, tmdb_id, name, magnet, status, error, warnings, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'resolving', NULL, '[]', ?, ?, ?)
         ON CONFLICT (info_hash) DO UPDATE SET
            kind = excluded.kind, tmdb_id = excluded.tmdb_id, name = excluded.name,
            magnet = excluded.magnet, status = 'resolving', error = NULL, warnings = '[]',
            user_id = excluded.user_id, created_at = excluded.created_at,
            updated_at = excluded.updated_at",
    )
    .bind(&info_hash)
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .bind(&name)
    .bind(&magnet)
    .bind(user.id)
    .bind(now)
    .bind(now)
    .execute(&state.main)
    .await?;

    let st = state.clone();
    let hash = info_hash.clone();
    tokio::spawn(async move {
        process(st, media_id, hash, magnet, resolved).await;
    });

    Ok(AddOutcome {
        info_hash,
        name,
        status: "resolving".into(),
    })
}

async fn set_job(state: &AppState, info_hash: &str, status: &str, error: Option<String>) {
    let _ = sqlx::query("UPDATE torrent_jobs SET status = ?, error = ?, updated_at = ? WHERE info_hash = ?")
        .bind(status)
        .bind(error)
        .bind(Utc::now())
        .bind(info_hash)
        .execute(&state.main)
        .await;
}

async fn process(
    state: AppState,
    media_id: i64,
    info_hash: String,
    magnet: String,
    resolved: Option<ResolvedTorrent>,
) {
    let resolved = match resolved {
        Some(r) => r,
        None => match state.engine.resolve(TorrentSource::Magnet(magnet.clone())).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(info_hash, error = %e, "failed to resolve magnet");
                set_job(&state, &info_hash, "error", Some(format!("{e:#}"))).await;
                return;
            }
        },
    };

    let torrent_id = match store_resolved(&state, media_id, &resolved, &magnet).await {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!(info_hash, error = %e, "failed to store torrent");
            set_job(&state, &info_hash, "error", Some(e.to_string())).await;
            return;
        }
    };
    if let Err(e) = apply_auto_mapping(&state.media, torrent_id).await {
        tracing::warn!(info_hash, error = %e, "auto mapping failed");
    }
    if let Err(e) = mark_requests_available(&state, media_id).await {
        tracing::warn!(error = %e, "failed to update requests");
    }

    if state.tools.can_probe() && state.settings.probe_on_add().await {
        set_job(&state, &info_hash, "probing", None).await;
        let warnings = probe_torrent(&state, torrent_id).await;
        let _ = sqlx::query("UPDATE torrent_jobs SET warnings = ? WHERE info_hash = ?")
            .bind(Json(&warnings))
            .bind(&info_hash)
            .execute(&state.main)
            .await;
    }
    set_job(&state, &info_hash, "done", None).await;
}

async fn store_resolved(
    state: &AppState,
    media_id: i64,
    r: &ResolvedTorrent,
    magnet: &str,
) -> anyhow::Result<i64> {
    let release = parser::parse(&r.name);
    let mut tx = state.media.begin().await?;
    let torrent_id: i64 = sqlx::query_scalar(
        "INSERT INTO torrents (
            info_hash, media_id, name, magnet, metainfo, total_size, piece_length, file_count,
            trackers, resolution, source, video_codec, audio, hdr, release_group, added_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id",
    )
    .bind(&r.info_hash)
    .bind(media_id)
    .bind(&r.name)
    .bind(magnet)
    .bind(r.torrent_bytes.as_ref())
    .bind(r.total_size as i64)
    .bind(r.piece_length as i64)
    .bind(r.files.len() as i64)
    .bind(Json(&r.trackers))
    .bind(&release.resolution)
    .bind(&release.source)
    .bind(&release.video_codec)
    .bind(&release.audio)
    .bind(&release.hdr)
    .bind(&release.release_group)
    .bind(Utc::now())
    .fetch_one(&mut *tx)
    .await
    .context("saving torrent")?;

    for f in &r.files {
        let kind = parser::file_kind(&f.path);
        let parsed = parser::parse_path(&f.path, &r.name);
        let sample = kind == FileKind::Video && parser::is_sample(&f.path, f.size);
        let language = (kind == FileKind::Subtitle)
            .then(|| parser::subtitle_language(&f.path))
            .flatten();
        sqlx::query(
            "INSERT INTO torrent_files (
                torrent_id, file_index, path, size, kind, is_sample, season_number,
                episode_numbers, mapping, language, container, resolution, video_codec
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(torrent_id)
        .bind(f.index as i64)
        .bind(&f.path)
        .bind(f.size as i64)
        .bind(kind.as_str())
        .bind(sample)
        .bind(parsed.season)
        .bind(Json(&parsed.episodes))
        .bind(if sample { "ignored" } else { "auto" })
        .bind(language)
        .bind(parser::extension(&f.path))
        .bind(parsed.release.resolution.or(release.resolution.clone()))
        .bind(parsed.release.video_codec.or(release.video_codec.clone()))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(torrent_id)
}

#[derive(sqlx::FromRow)]
struct MappingRow {
    id: i64,
    path: String,
    mapping: String,
    season_number: Option<i64>,
    episode_numbers: Json<Vec<i64>>,
}

/// Recompute file→episode links for a torrent. Files whose mapping was set
/// by hand keep their season/episodes; `auto` files are re-parsed.
pub async fn apply_auto_mapping(pool: &SqlitePool, torrent_id: i64) -> anyhow::Result<()> {
    let (media_id, kind, torrent_name): (i64, String, String) = sqlx::query_as(
        "SELECT t.media_id, m.kind, t.name FROM torrents t JOIN media m ON m.id = t.media_id WHERE t.id = ?",
    )
    .bind(torrent_id)
    .fetch_one(pool)
    .await?;

    let files: Vec<MappingRow> = sqlx::query_as(
        "SELECT id, path, mapping, season_number, episode_numbers FROM torrent_files
         WHERE torrent_id = ? AND kind = 'video'",
    )
    .bind(torrent_id)
    .fetch_all(pool)
    .await?;

    let mut tx = pool.begin().await?;
    for f in files {
        sqlx::query("DELETE FROM file_episodes WHERE file_id = ?")
            .bind(f.id)
            .execute(&mut *tx)
            .await?;
        if kind != MediaKind::Tv.as_str() || f.mapping == "ignored" {
            continue;
        }

        let (season, episodes) = if f.mapping == "manual" {
            (f.season_number, f.episode_numbers.0.clone())
        } else {
            let parsed = parser::parse_path(&f.path, &torrent_name);
            resolve_auto(&mut tx, media_id, &parsed).await?
        };
        let Some(season) = season else { continue };

        let mut linked = Vec::new();
        for ep in &episodes {
            let id: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM episodes WHERE media_id = ? AND season_number = ? AND episode_number = ?",
            )
            .bind(media_id)
            .bind(season)
            .bind(ep)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(id) = id {
                sqlx::query("INSERT OR IGNORE INTO file_episodes (file_id, episode_id) VALUES (?, ?)")
                    .bind(f.id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                linked.push(*ep);
            }
        }
        if f.mapping == "auto" {
            sqlx::query("UPDATE torrent_files SET season_number = ?, episode_numbers = ? WHERE id = ?")
                .bind(season)
                .bind(Json(&episodes))
                .bind(f.id)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

async fn resolve_auto(
    conn: &mut sqlx::SqliteConnection,
    media_id: i64,
    parsed: &parser::ParsedFile,
) -> anyhow::Result<(Option<i64>, Vec<i64>)> {
    if parsed.season.is_some() && !parsed.episodes.is_empty() {
        return Ok((parsed.season, parsed.episodes.clone()));
    }

    // Absolute numbering (anime): look the numbers up on the show.
    if !parsed.absolute_episodes.is_empty() {
        let mut season = None;
        let mut eps = Vec::new();
        for abs in &parsed.absolute_episodes {
            let row: Option<(i64, i64)> = sqlx::query_as(
                "SELECT season_number, episode_number FROM episodes
                 WHERE media_id = ? AND absolute_number = ? AND season_number > 0",
            )
            .bind(media_id)
            .bind(abs)
            .fetch_optional(&mut *conn)
            .await?;
            if let Some((s, e)) = row {
                season.get_or_insert(s);
                if Some(s) == season {
                    eps.push(e);
                }
            }
        }
        if season.is_some() {
            return Ok((season, eps));
        }
        // No absolute numbers known; assume a single-season show.
        return Ok((Some(parsed.season.unwrap_or(1)), parsed.absolute_episodes.clone()));
    }

    // Episode numbers but no season: fine if the show only has one.
    if parsed.season.is_none() && !parsed.episodes.is_empty() {
        let seasons: Vec<i64> = sqlx::query_scalar(
            "SELECT DISTINCT season_number FROM episodes WHERE media_id = ? AND season_number > 0",
        )
        .bind(media_id)
        .fetch_all(&mut *conn)
        .await?;
        if seasons.len() == 1 {
            return Ok((Some(seasons[0]), parsed.episodes.clone()));
        }
    }
    Ok((parsed.season, parsed.episodes.clone()))
}

async fn mark_requests_available(state: &AppState, media_id: i64) -> anyhow::Result<()> {
    let media = library::get_media(&state.media, media_id).await?;
    sqlx::query(
        "UPDATE requests SET status = 'available', updated_at = ?
         WHERE kind = ? AND tmdb_id = ? AND status IN ('pending', 'approved')",
    )
    .bind(Utc::now())
    .bind(&media.kind)
    .bind(media.tmdb_id)
    .execute(&state.main)
    .await?;
    Ok(())
}

/// Probe every playable video file in a torrent. Returns human readable
/// warnings about anything that looks off.
pub async fn probe_torrent(state: &AppState, torrent_id: i64) -> Vec<String> {
    let files: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, path FROM torrent_files
         WHERE torrent_id = ? AND kind = 'video' AND mapping != 'ignored' ORDER BY file_index",
    )
    .bind(torrent_id)
    .fetch_all(&state.media)
    .await
    .unwrap_or_default();

    let mut warnings = Vec::new();
    for (file_id, path) in files {
        match probe_file(state, file_id).await {
            Ok(Some(w)) => warnings.push(format!("{path}: {w}")),
            Ok(None) => {}
            Err(e) => warnings.push(format!("{path}: could not be scanned ({e})")),
        }
    }
    warnings
}

#[derive(sqlx::FromRow)]
struct ProbeTarget {
    info_hash: String,
    metainfo: Option<Vec<u8>>,
    file_index: i64,
}

/// Partially download a file's headers and record what's in it. Returns a
/// warning if the duration doesn't match the episodes it's mapped to.
pub async fn probe_file(state: &AppState, file_id: i64) -> AppResult<Option<String>> {
    if !state.tools.can_probe() {
        return Err(AppError::bad_request("ffprobe is not installed"));
    }
    let target: ProbeTarget = sqlx::query_as(
        "SELECT t.info_hash, t.metainfo, f.file_index FROM torrent_files f
         JOIN torrents t ON t.id = f.torrent_id WHERE f.id = ?",
    )
    .bind(file_id)
    .fetch_optional(&state.media)
    .await?
    .ok_or_else(|| AppError::not_found("file not found"))?;
    let metainfo = target
        .metainfo
        .ok_or_else(|| AppError::bad_request("torrent has no metadata"))?;

    let _permit = PROBES.clone().acquire_owned().await.map_err(anyhow::Error::from)?;
    let _lease = state
        .engine
        .acquire(&target.info_hash, Bytes::from(metainfo), target.file_index as usize)
        .await?;
    let probe = state
        .tools
        .probe(&state.internal_stream_url(file_id))
        .await
        .map_err(|e| AppError::Upstream(format!("{e:#}")))?;
    store_probe(&state.media, file_id, &probe).await?;
    Ok(duration_warning(&state.media, file_id, &probe).await?)
}

pub async fn store_probe(pool: &SqlitePool, file_id: i64, p: &ProbeResult) -> AppResult<()> {
    #[derive(Serialize)]
    struct Summary<'a> {
        format: &'a Option<String>,
        bitrate: Option<i64>,
        pix_fmt: &'a Option<String>,
        video_profile: &'a Option<String>,
        hdr: bool,
        audio: &'a [crate::streaming::ffmpeg::AudioTrack],
        subtitles: &'a [crate::streaming::ffmpeg::SubtitleTrack],
    }
    let summary = Summary {
        format: &p.format,
        bitrate: p.bitrate,
        pix_fmt: &p.pix_fmt,
        video_profile: &p.video_profile,
        hdr: p.hdr,
        audio: &p.audio,
        subtitles: &p.subtitles,
    };
    sqlx::query(
        "UPDATE torrent_files SET resolution = COALESCE(?, resolution), width = ?, height = ?,
            video_codec = ?, audio_codec = ?, duration = ?, probe = ?, probed_at = ?
         WHERE id = ?",
    )
    .bind(p.resolution_label())
    .bind(p.width)
    .bind(p.height)
    .bind(&p.video_codec)
    .bind(p.primary_audio_codec())
    .bind(p.duration)
    .bind(Json(&summary))
    .bind(Utc::now())
    .bind(file_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn duration_warning(pool: &SqlitePool, file_id: i64, p: &ProbeResult) -> AppResult<Option<String>> {
    let Some(duration) = p.duration else {
        return Ok(None);
    };
    let runtimes: Vec<Option<i64>> = sqlx::query_scalar(
        "SELECT e.runtime FROM file_episodes fe JOIN episodes e ON e.id = fe.episode_id WHERE fe.file_id = ?",
    )
    .bind(file_id)
    .fetch_all(pool)
    .await?;
    if runtimes.is_empty() || runtimes.iter().any(|r| r.is_none()) {
        return Ok(None);
    }
    let expected: i64 = runtimes.iter().flatten().sum::<i64>() * 60;
    if expected == 0 {
        return Ok(None);
    }
    let ratio = duration / expected as f64;
    if !(0.6..=1.6).contains(&ratio) {
        return Ok(Some(format!(
            "runs {} min but is mapped to {} episode(s) totalling about {} min",
            (duration / 60.0).round(),
            runtimes.len(),
            expected / 60
        )));
    }
    Ok(None)
}

/// Re-run jobs interrupted by a restart.
pub async fn resume_jobs(state: &AppState) {
    let jobs: Vec<(String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT info_hash, kind, tmdb_id, magnet FROM torrent_jobs WHERE status IN ('resolving', 'probing')",
    )
    .fetch_all(&state.main)
    .await
    .unwrap_or_default();
    for (info_hash, kind, tmdb_id, magnet) in jobs {
        let in_library: Option<i64> = sqlx::query_scalar("SELECT id FROM torrents WHERE info_hash = ?")
            .bind(&info_hash)
            .fetch_optional(&state.media)
            .await
            .ok()
            .flatten();
        if in_library.is_some() {
            set_job(state, &info_hash, "done", None).await;
            continue;
        }
        let media_id = MediaKind::parse(&kind)
            .map(|k| library::find_by_tmdb(&state.media, k, tmdb_id));
        let media_id = match media_id {
            Some(f) => f.await.ok().flatten(),
            None => None,
        };
        match (media_id, magnet) {
            (Some(media_id), Some(magnet)) => {
                tracing::info!(info_hash, "resuming torrent resolution");
                let st = state.clone();
                tokio::spawn(async move { process(st, media_id, info_hash, magnet, None).await });
            }
            _ => set_job(state, &info_hash, "error", Some("interrupted by a restart".into())).await,
        }
    }
}
