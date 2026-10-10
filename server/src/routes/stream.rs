use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRequestParts, Path, Query, State},
    http::{HeaderMap, Method, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use bytes::Bytes;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;
use tokio_util::io::ReaderStream;

use crate::{
    auth::{ClientInfo, CurrentUser, USER_COLUMNS, User, perm},
    error::{AppError, AppResult},
    library::files::{self, FileContext},
    state::{AppState, PROBE_READAHEAD, StreamPurpose, StreamToken},
    streaming::{
        self, CountingStream,
        ffmpeg::{self, ClientCaps, PlaybackMode, ProbeResult, TranscodeOptions},
        subtitles,
    },
    torrents::{engine::Lease, parser, scan},
    util,
};

pub fn router() -> Router<AppState> {
    // Cast receivers fetch media and captions cross-origin; access is
    // controlled by the session cookie or a per-torrent token, never by CORS.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::HEAD])
        .allow_headers(Any)
        .expose_headers([header::CONTENT_RANGE, header::CONTENT_LENGTH, header::ACCEPT_RANGES]);
    Router::new()
        .route("/play/{file_id}", get(play))
        .route("/play/{file_id}/cast", post(cast_token))
        .route("/stream/{file_id}", get(stream_direct))
        .route("/stream/{file_id}/transcode", get(stream_transcode))
        .route("/stream/{file_id}/vtt", get(subtitle_vtt))
        .route("/stream/{file_id}/subs/{track}", get(embedded_subtitles))
        .route("/stream/{file_id}/status", get(status))
        .route("/internal/files/{file_id}/raw", get(internal_raw))
        .layer(cors)
}

/// A signed-in user, or a device holding a stream token for one torrent.
struct StreamAccess {
    user: User,
    torrent_id: Option<i64>,
}

impl StreamAccess {
    fn check(&self, ctx: &FileContext) -> AppResult<()> {
        self.user.require(perm::STREAM)?;
        match self.torrent_id {
            Some(t) if t != ctx.torrent_id => Err(AppError::forbidden("this link is for a different title")),
            _ => Ok(()),
        }
    }
}

impl FromRequestParts<AppState> for StreamAccess {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parts.uri.query().and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v.into_owned())
        });
        if let Some(token) = token {
            let grant = state
                .stream_tokens
                .get(&token)
                .map(|g| g.clone())
                .filter(|g| g.expires > Instant::now())
                .ok_or(AppError::Unauthorized)?;
            let user: User = sqlx::query_as(&format!(
                "SELECT {USER_COLUMNS} FROM users WHERE id = ? AND disabled = 0"
            ))
            .bind(grant.user_id)
            .fetch_optional(&state.main)
            .await?
            .ok_or(AppError::Unauthorized)?;
            return Ok(Self { user, torrent_id: Some(grant.torrent_id) });
        }
        let CurrentUser(user) = CurrentUser::from_request_parts(parts, state).await?;
        Ok(Self { user, torrent_id: None })
    }
}

/// Hand out a token so a cast device can stream this file (and its
/// subtitles) without a session. Valid for 12 hours.
async fn cast_token(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(file_id): Path<i64>,
) -> AppResult<Json<Value>> {
    user.require(perm::STREAM)?;
    let ctx = context(&state, file_id).await?;
    let now = Instant::now();
    state.stream_tokens.retain(|_, g| g.expires > now);
    let token = util::random_token(24);
    state.stream_tokens.insert(
        token.clone(),
        StreamToken {
            user_id: user.id,
            torrent_id: ctx.torrent_id,
            expires: now + std::time::Duration::from_secs(12 * 3600),
        },
    );
    Ok(Json(json!({ "token": token })))
}

async fn context(state: &AppState, file_id: i64) -> AppResult<FileContext> {
    files::file_context(&state.media, file_id)
        .await?
        .ok_or_else(|| AppError::not_found("file not found"))
}

/// Holds the torrent lease for as long as a response body is alive and
/// records how much was sent once it's done.
struct StreamGuard {
    state: AppState,
    session_id: Option<i64>,
    counter: Arc<AtomicU64>,
    _lease: Option<Lease>,
    _child: Option<tokio::process::Child>,
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        let Some(sid) = self.session_id else { return };
        let bytes = self.counter.load(Ordering::Relaxed) as i64;
        let state = self.state.clone();
        tokio::spawn(async move {
            let _ = sqlx::query(
                "UPDATE stream_history SET bytes_sent = bytes_sent + ?, ended_at = ? WHERE id = ?",
            )
            .bind(bytes)
            .bind(Utc::now())
            .bind(sid)
            .execute(&state.main)
            .await;
        });
    }
}

async fn serve_file(
    state: &AppState,
    ctx: &FileContext,
    headers: &HeaderMap,
    session_id: Option<i64>,
    readahead: u64,
) -> AppResult<Response> {
    let metainfo = ctx
        .metainfo
        .clone()
        .ok_or_else(|| AppError::bad_request("torrent has no metadata"))?;
    let lease = state
        .engine
        .acquire(&ctx.info_hash, Bytes::from(metainfo), ctx.file_index as usize)
        .await?;
    let reader = state.engine.open_stream(&lease, readahead).await?;
    let counter = Arc::new(AtomicU64::new(0));
    let guard = StreamGuard {
        state: state.clone(),
        session_id,
        counter: counter.clone(),
        _lease: Some(lease),
        _child: None,
    };
    let mime = streaming::mime_for(&ctx.path);
    Ok(streaming::serve_reader(
        reader,
        ctx.size as u64,
        mime.to_str().unwrap_or("application/octet-stream"),
        headers,
        counter,
        Some(Box::new(guard)),
    )
    .await)
}

#[derive(Deserialize)]
struct SessionQuery {
    sid: Option<i64>,
}

async fn own_session(state: &AppState, user: &User, sid: Option<i64>) -> AppResult<Option<i64>> {
    let Some(sid) = sid else { return Ok(None) };
    let owned: Option<i64> = sqlx::query_scalar("SELECT id FROM stream_history WHERE id = ? AND user_id = ?")
        .bind(sid)
        .bind(user.id)
        .fetch_optional(&state.main)
        .await?;
    Ok(owned)
}

async fn stream_direct(
    State(state): State<AppState>,
    access: StreamAccess,
    Path(file_id): Path<i64>,
    Query(q): Query<SessionQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let ctx = context(&state, file_id).await?;
    access.check(&ctx)?;
    let sid = own_session(&state, &access.user, q.sid).await?;
    let readahead = state.settings.readahead_bytes().await;
    serve_file(&state, &ctx, &headers, sid, readahead).await
}

#[derive(Deserialize)]
struct InternalQuery {
    key: String,
    purpose: Option<StreamPurpose>,
}

/// Raw file access for local ffmpeg/ffprobe processes.
async fn internal_raw(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
    Query(q): Query<InternalQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    if q.key != state.internal_key {
        return Err(AppError::forbidden("invalid key"));
    }
    let ctx = context(&state, file_id).await?;
    let readahead = match q.purpose {
        Some(StreamPurpose::Probe) => PROBE_READAHEAD,
        _ => state.settings.readahead_bytes().await,
    };
    serve_file(&state, &ctx, &headers, None, readahead).await
}

#[derive(Deserialize)]
struct TranscodeQuery {
    sid: Option<i64>,
    start: Option<f64>,
    audio: Option<usize>,
    #[serde(default)]
    hevc: bool,
    #[serde(default)]
    ac3: bool,
}

fn stored_probe(ctx: &FileContext) -> Option<ProbeResult> {
    let p = ctx.probe.as_ref()?;
    let mut r: ProbeResult = serde_json::from_value(p.0.clone()).ok()?;
    r.video_codec = ctx.video_codec.clone();
    r.duration = ctx.duration;
    if r.format.is_none() {
        r.format = ctx.container.clone();
    }
    Some(r)
}

async fn stream_transcode(
    State(state): State<AppState>,
    access: StreamAccess,
    Path(file_id): Path<i64>,
    Query(q): Query<TranscodeQuery>,
) -> AppResult<Response> {
    if !state.tools.can_transcode() {
        return Err(AppError::bad_request("ffmpeg is not installed on the server"));
    }
    let ctx = context(&state, file_id).await?;
    access.check(&ctx)?;
    let sid = own_session(&state, &access.user, q.sid).await?;
    let probe = stored_probe(&ctx);
    let ext = parser::extension(&ctx.path).unwrap_or_default();
    let caps = ClientCaps { hevc: q.hevc, ac3: q.ac3, mkv: false };
    let mut plan = ffmpeg::plan(&ext, probe.as_ref(), caps, true);
    if plan.mode == PlaybackMode::Direct {
        // The client asked for a remux anyway (e.g. seeking a remuxed stream).
        plan.copy_audio = true;
    }
    // A specific audio track other than the default always needs re-encoding
    // to keep things simple for the browser.
    let copy_audio = plan.copy_audio && q.audio.is_none_or(|a| a == 0);

    let opts = TranscodeOptions {
        start: q.start.unwrap_or(0.0).max(0.0),
        audio_stream: q.audio,
        transcode_video: plan.transcode_video,
        copy_audio,
    };
    let mut child = state
        .tools
        .spawn_stream(&state.internal_stream_url(file_id, StreamPurpose::Playback), &opts)?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("ffmpeg has no stdout"))?;
    let counter = Arc::new(AtomicU64::new(0));
    let guard = StreamGuard {
        state: state.clone(),
        session_id: sid,
        counter: counter.clone(),
        _lease: None,
        _child: Some(child),
    };
    let body = Body::from_stream(CountingStream::new(
        ReaderStream::with_capacity(stdout, 256 * 1024),
        counter,
        Some(Box::new(guard)),
    ));
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "none")
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()))
}

async fn subtitle_vtt(
    State(state): State<AppState>,
    access: StreamAccess,
    Path(file_id): Path<i64>,
) -> AppResult<Response> {
    let ctx = context(&state, file_id).await?;
    access.check(&ctx)?;
    if ctx.kind != "subtitle" {
        return Err(AppError::bad_request("not a subtitle file"));
    }
    if ctx.size > 20 * 1024 * 1024 {
        return Err(AppError::bad_request("subtitle file is too large"));
    }
    let metainfo = ctx
        .metainfo
        .clone()
        .ok_or_else(|| AppError::bad_request("torrent has no metadata"))?;
    let lease = state
        .engine
        .acquire(&ctx.info_hash, Bytes::from(metainfo), ctx.file_index as usize)
        .await?;
    let mut reader = state.engine.open_stream(&lease, PROBE_READAHEAD).await?;
    let mut buf = Vec::with_capacity(ctx.size as usize);
    tokio::time::timeout(std::time::Duration::from_secs(90), reader.read_to_end(&mut buf))
        .await
        .map_err(|_| AppError::Upstream("timed out downloading subtitles".into()))?
        .map_err(anyhow::Error::from)?;
    drop(lease);

    let ext = parser::extension(&ctx.path).unwrap_or_default();
    let vtt = match ext.as_str() {
        "vtt" => subtitles::decode(&buf),
        "srt" => subtitles::srt_to_vtt(&subtitles::decode(&buf)),
        "ass" | "ssa" if state.tools.can_transcode() => state
            .tools
            .subtitle_to_vtt(buf, &ext)
            .await
            .map_err(|e| AppError::Upstream(format!("{e:#}")))?,
        _ => return Err(AppError::bad_request("unsupported subtitle format")),
    };
    Ok(([(header::CONTENT_TYPE, "text/vtt; charset=utf-8")], vtt).into_response())
}

#[derive(Deserialize)]
struct SubsQuery {
    start: f64,
    end: f64,
}

/// One window of an embedded subtitle track as WebVTT. The player asks for
/// the part around the playhead, so only that region of the file is read.
async fn embedded_subtitles(
    State(state): State<AppState>,
    access: StreamAccess,
    Path((file_id, track)): Path<(i64, usize)>,
    Query(q): Query<SubsQuery>,
) -> AppResult<Response> {
    let ctx = context(&state, file_id).await?;
    access.check(&ctx)?;
    if !state.tools.can_transcode() {
        return Err(AppError::bad_request("ffmpeg is not installed on the server"));
    }
    let probe = stored_probe(&ctx).ok_or_else(|| AppError::bad_request("file hasn't been scanned yet"))?;
    let info = probe
        .subtitles
        .get(track)
        .ok_or_else(|| AppError::not_found("no such subtitle track"))?;
    if !ffmpeg::is_text_subtitle(info.codec.as_deref()) {
        return Err(AppError::bad_request("image-based subtitles can't be shown in the browser"));
    }
    let start = q.start.max(0.0);
    let end = q.end.max(start + 1.0).min(start + 600.0);
    let vtt = state
        .tools
        .extract_subtitles(&state.internal_stream_url(file_id, StreamPurpose::Probe), track, start, end)
        .await
        .map_err(|e| AppError::Upstream(format!("{e:#}")))?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/vtt; charset=utf-8"),
            (header::CACHE_CONTROL, "private, max-age=3600"),
        ],
        vtt,
    )
        .into_response())
}

async fn status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(file_id): Path<i64>,
) -> AppResult<Json<Value>> {
    user.require(perm::STREAM)?;
    let ctx = context(&state, file_id).await?;
    let progress = state.engine.file_progress(&ctx.info_hash, ctx.file_index as usize);
    Ok(Json(json!({ "active": progress.is_some(), "progress": progress })))
}

fn language_label(code: &str) -> &'static str {
    match code {
        "en" | "eng" => "English",
        "es" | "spa" => "Spanish",
        "fr" | "fre" | "fra" => "French",
        "de" | "ger" | "deu" => "German",
        "it" | "ita" => "Italian",
        "pt" | "por" => "Portuguese",
        "nl" | "dut" | "nld" => "Dutch",
        "sv" | "swe" => "Swedish",
        "no" | "nor" => "Norwegian",
        "da" | "dan" => "Danish",
        "fi" | "fin" => "Finnish",
        "pl" | "pol" => "Polish",
        "ru" | "rus" => "Russian",
        "ja" | "jpn" => "Japanese",
        "ko" | "kor" => "Korean",
        "zh" | "chi" | "zho" => "Chinese",
        "ar" | "ara" => "Arabic",
        "tr" | "tur" => "Turkish",
        "he" | "heb" => "Hebrew",
        "hi" | "hin" => "Hindi",
        _ => "Unknown",
    }
}

#[derive(sqlx::FromRow)]
struct SubFile {
    id: i64,
    path: String,
    language: Option<String>,
    season_number: Option<i64>,
    episode_numbers: sqlx::types::Json<Vec<i64>>,
}

fn stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    match name.rfind('.') {
        Some(i) => name[..i].to_string(),
        None => name,
    }
}

async fn subtitles_for(state: &AppState, ctx: &FileContext) -> AppResult<Vec<Value>> {
    let subs: Vec<SubFile> = sqlx::query_as(
        "SELECT id, path, language, season_number, episode_numbers FROM torrent_files
         WHERE torrent_id = ? AND kind = 'subtitle' AND mapping != 'ignored' ORDER BY path",
    )
    .bind(ctx.torrent_id)
    .fetch_all(&state.media)
    .await?;
    let video_stem = stem(&ctx.path);
    let is_tv = ctx.media_kind == "tv";
    let mut out = Vec::new();
    for s in subs {
        let ext = parser::extension(&s.path).unwrap_or_default();
        if !matches!(ext.as_str(), "srt" | "vtt") && !(state.tools.can_transcode() && matches!(ext.as_str(), "ass" | "ssa")) {
            continue;
        }
        let matches = if is_tv {
            stem(&s.path).starts_with(&video_stem)
                || (s.season_number.is_some()
                    && s.season_number == ctx.season_number
                    && !s.episode_numbers.0.is_empty()
                    && s.episode_numbers.0 == ctx.episode_numbers.0)
                || s.path.to_lowercase().contains(&format!("/{video_stem}/"))
        } else {
            true
        };
        if !matches {
            continue;
        }
        let label = match &s.language {
            Some(l) => language_label(l).to_string(),
            None => stem(&s.path),
        };
        out.push(json!({
            "id": format!("file-{}", s.id),
            "embedded": false,
            "language": s.language,
            "label": label,
            "url": format!("/api/stream/{}/vtt", s.id),
        }));
    }
    Ok(out)
}

#[derive(Deserialize)]
struct PlayQuery {
    #[serde(default)]
    hevc: bool,
    #[serde(default)]
    ac3: bool,
    #[serde(default)]
    mkv: bool,
}

/// Everything the player needs: how to stream the file, tracks, where to
/// resume and what comes next.
async fn play(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: ClientInfo,
    Path(file_id): Path<i64>,
    Query(q): Query<PlayQuery>,
) -> AppResult<Json<Value>> {
    user.require(perm::STREAM)?;
    let mut ctx = context(&state, file_id).await?;
    if ctx.kind != "video" {
        return Err(AppError::bad_request("not a video file"));
    }

    // Partial scan on first play if it hasn't been probed yet.
    if ctx.probe.is_none() && state.tools.can_probe() {
        match tokio::time::timeout(std::time::Duration::from_secs(90), scan::probe_file(&state, file_id)).await {
            Ok(Ok(_)) => ctx = context(&state, file_id).await?,
            Ok(Err(e)) => tracing::warn!(file_id, error = %e, "probe before playback failed"),
            Err(_) => tracing::warn!(file_id, "probe before playback timed out"),
        }
    }
    let probe = stored_probe(&ctx);
    let ext = parser::extension(&ctx.path).unwrap_or_default();
    let caps = ClientCaps { hevc: q.hevc, ac3: q.ac3, mkv: q.mkv };
    let can_transcode = state.tools.can_transcode() && state.settings.transcode_enabled().await;
    let plan = ffmpeg::plan(&ext, probe.as_ref(), caps, can_transcode);

    let is_tv = ctx.media_kind == "tv";
    let season = if is_tv { ctx.season_number } else { None };
    let episode = if is_tv { ctx.episode_numbers.0.first().copied() } else { None };

    let episode_info: Option<(Option<String>, Option<String>)> = match (season, episode) {
        (Some(s), Some(e)) => sqlx::query_as(
            "SELECT name, still_path FROM episodes WHERE media_id = ? AND season_number = ? AND episode_number = ?",
        )
        .bind(ctx.media_id)
        .bind(s)
        .bind(e)
        .fetch_optional(&state.media)
        .await?,
        _ => None,
    };

    let next = match (season, ctx.episode_numbers.0.last().copied()) {
        (Some(s), Some(e)) => {
            let next_ep: Option<(i64, i64, i64, Option<String>)> = sqlx::query_as(
                "SELECT e.id, e.season_number, e.episode_number, e.name FROM episodes e
                 WHERE e.media_id = ?1 AND e.season_number > 0
                   AND (e.season_number > ?2 OR (e.season_number = ?2 AND e.episode_number > ?3))
                   AND EXISTS (SELECT 1 FROM file_episodes fe WHERE fe.episode_id = e.id)
                 ORDER BY e.season_number, e.episode_number LIMIT 1",
            )
            .bind(ctx.media_id)
            .bind(s)
            .bind(e)
            .fetch_optional(&state.media)
            .await?;
            match next_ep {
                Some((id, s, e, name)) => {
                    // Prefer the same torrent so quality stays consistent.
                    let files = files::files_for_episode(&state.media, id).await?;
                    let pick = files
                        .iter()
                        .find(|f| f.torrent_id == ctx.torrent_id)
                        .or(files.first());
                    pick.map(|f| {
                        json!({ "file_id": f.file_id, "season_number": s, "episode_number": e, "name": name })
                    })
                }
                None => None,
            }
        }
        _ => None,
    };

    let resume: Option<(f64, bool)> = sqlx::query_as(
        "SELECT position, completed FROM watch_progress
         WHERE user_id = ? AND kind = ? AND tmdb_id = ? AND season_number = ? AND episode_number = ?",
    )
    .bind(user.id)
    .bind(&ctx.media_kind)
    .bind(ctx.tmdb_id)
    .bind(season.unwrap_or(-1))
    .bind(episode.unwrap_or(-1))
    .fetch_optional(&state.main)
    .await?;
    let resume_at = resume.filter(|(_, done)| !done).map(|(p, _)| p).unwrap_or(0.0);

    let session_id: i64 = sqlx::query_scalar(
        "INSERT INTO stream_history (user_id, kind, tmdb_id, title, season_number, episode_number, info_hash,
            file_index, mode, ip, user_agent, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user.id)
    .bind(&ctx.media_kind)
    .bind(ctx.tmdb_id)
    .bind(&ctx.title)
    .bind(season)
    .bind(episode)
    .bind(&ctx.info_hash)
    .bind(ctx.file_index)
    .bind(plan.mode.as_str())
    .bind(&client.ip)
    .bind(&client.user_agent)
    .bind(Utc::now())
    .fetch_one(&state.main)
    .await?;

    let url = match plan.mode {
        PlaybackMode::Direct => format!("/api/stream/{file_id}?sid={session_id}"),
        _ => format!(
            "/api/stream/{file_id}/transcode?sid={session_id}{}{}",
            if q.hevc { "&hevc=true" } else { "" },
            if q.ac3 { "&ac3=true" } else { "" }
        ),
    };

    let media = crate::library::get_media(&state.media, ctx.media_id).await?;
    let mut subtitles = subtitles_for(&state, &ctx).await?;
    if state.tools.can_transcode()
        && let Some(p) = probe.as_ref()
    {
        for track in p.subtitles.iter().filter(|t| ffmpeg::is_text_subtitle(t.codec.as_deref())) {
            let lang = track.language.as_deref().filter(|l| *l != "und");
            let base = lang.map(language_label).filter(|l| *l != "Unknown").map(String::from);
            let label = match (base, track.title.as_deref()) {
                (Some(b), Some(t)) if !t.eq_ignore_ascii_case(&b) => format!("{b} ({t})"),
                (Some(b), _) => b,
                (None, Some(t)) => t.to_string(),
                (None, None) => format!("Track {}", track.index + 1),
            };
            subtitles.push(json!({
                "id": format!("embedded-{}", track.index),
                "embedded": true,
                "language": lang,
                "label": label,
                "url": format!("/api/stream/{file_id}/subs/{}", track.index),
            }));
        }
    }

    // Other torrents with the same episode/movie, for the version picker.
    let alternatives = match (is_tv, season, episode) {
        (true, Some(s), Some(e)) => {
            let ep: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM episodes WHERE media_id = ? AND season_number = ? AND episode_number = ?",
            )
            .bind(ctx.media_id)
            .bind(s)
            .bind(e)
            .fetch_optional(&state.media)
            .await?;
            match ep {
                Some(id) => files::files_for_episode(&state.media, id).await?,
                None => Vec::new(),
            }
        }
        (false, _, _) => files::files_for_movie(&state.media, ctx.media_id).await?,
        _ => Vec::new(),
    };
    let versions: Vec<Value> = alternatives
        .iter()
        .map(|f| {
            let label = [&f.resolution, &f.source, &f.video_codec, &f.hdr]
                .into_iter()
                .flatten()
                .cloned()
                .collect::<Vec<_>>()
                .join(" · ");
            json!({
                "file_id": f.file_id,
                "info_hash": f.info_hash,
                "label": label,
                "torrent_name": f.torrent_name,
                "size": f.size,
            })
        })
        .collect();
    let (episode_name, still_path) = episode_info.unwrap_or((None, None));

    Ok(Json(json!({
        "file_id": file_id,
        "info_hash": ctx.info_hash,
        "session_id": session_id,
        "mode": plan.mode,
        "reason": plan.reason,
        "url": url,
        "seekable": plan.mode == PlaybackMode::Direct,
        "duration": ctx.duration,
        "resume_at": resume_at,
        "audio_tracks": probe.as_ref().map(|p| p.audio.clone()).unwrap_or_default(),
        "subtitles": subtitles,
        "versions": versions,
        "file": {
            "path": ctx.path,
            "size": ctx.size,
            "resolution": ctx.resolution,
            "video_codec": ctx.video_codec,
            "audio_codec": ctx.audio_codec,
        },
        "media": {
            "id": media.id,
            "kind": media.kind,
            "tmdb_id": media.tmdb_id,
            "title": media.title,
            "year": media.year,
            "backdrop_path": media.backdrop_path,
            "logo_path": media.logo_path,
            "poster_path": media.poster_path,
        },
        "episode": season.map(|s| json!({
            "season_number": s,
            "episode_numbers": ctx.episode_numbers.0,
            "name": episode_name,
            "still_path": still_path,
        })),
        "next": next,
    })))
}
