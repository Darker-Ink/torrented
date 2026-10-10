//! Automatic review of torrents suggested with a request.
//!
//! The torrent's metadata is fetched (no content is downloaded), its file
//! names are parsed the same way as when a torrent is added to a title, and
//! trackers are scraped for seeders. The result is a list of checks staff can
//! glance at before approving.

use std::collections::BTreeSet;

use bytes::Bytes;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use super::{
    engine::{ResolvedTorrent, TorrentSource},
    parser::{self, FileKind},
    scan::{self, AddInput},
    scrape::{self, SwarmStats},
};
use crate::{
    error::{AppError, AppResult},
    library,
    metadata::{MediaDetails, MediaKind},
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Pass,
    Warn,
    Fail,
}

impl Verdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Warn => "warn",
            Self::Fail => "fail",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check {
    pub key: String,
    pub label: String,
    pub status: Verdict,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub verdict: Verdict,
    pub checks: Vec<Check>,
    pub size: u64,
    pub file_count: usize,
    pub video_count: usize,
    pub resolution: Option<String>,
    pub source: Option<String>,
    pub video_codec: Option<String>,
    pub seeders: Option<u64>,
    pub leechers: Option<u64>,
    pub checked_at: chrono::DateTime<Utc>,
}

fn check(key: &str, label: &str, status: Verdict, detail: impl Into<String>) -> Check {
    Check {
        key: key.into(),
        label: label.into(),
        status,
        detail: detail.into(),
    }
}

/// Lowercase alphanumerics only, accents dropped, "&" as "and", no leading
/// "the", so "The.Office.US" and "The Office (US)" compare equal, as do
/// "Shogun" and "Shōgun".
fn normalize(s: &str) -> String {
    let s: String = s.nfd().filter(|c| !is_combining_mark(*c)).collect();
    let s = s.to_lowercase().replace('&', " and ");
    let words: Vec<String> = s
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect();
    let words = match words.first().map(String::as_str) {
        Some("the" | "a" | "an") if words.len() > 1 => &words[1..],
        _ => &words[..],
    };
    words.concat()
}

fn gb(bytes: u64) -> String {
    let gb = bytes as f64 / 1_073_741_824.0;
    if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        format!("{:.0} MB", bytes as f64 / 1_048_576.0)
    }
}

fn plural(n: usize, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}

/// Score a resolved torrent against what was requested.
pub fn evaluate(
    torrent: &ResolvedTorrent,
    target: &MediaDetails,
    requested_seasons: Option<&[i64]>,
    swarm: Option<&SwarmStats>,
) -> Review {
    let release = parser::parse(&torrent.name);
    let mut checks = Vec::new();

    // Title and year.
    let wanted: Vec<String> = std::iter::once(&target.title)
        .chain(target.original_title.as_ref())
        .map(|t| normalize(t))
        .filter(|t| !t.is_empty())
        .collect();
    let found = release.title.as_deref().map(normalize).unwrap_or_default();
    let whole_name = normalize(&torrent.name);
    let title_ok = wanted.iter().any(|w| {
        (!found.is_empty() && (found == *w || found.starts_with(w.as_str()) || w.starts_with(found.as_str())))
            || whole_name.contains(w.as_str())
    });
    let year_off = match (target.kind, release.year, target.year) {
        (MediaKind::Movie, Some(a), Some(b)) => (a - b).abs() > 1,
        _ => false,
    };
    let shown = release.title.clone().unwrap_or_else(|| torrent.name.clone());
    checks.push(if !title_ok {
        check(
            "title",
            "Matches the title",
            Verdict::Warn,
            format!("The name reads \"{shown}\", which doesn't look like {}", target.title),
        )
    } else if year_off {
        check(
            "title",
            "Matches the title",
            Verdict::Warn,
            format!(
                "Name matches but says {}, the title is from {}",
                release.year.unwrap_or_default(),
                target.year.unwrap_or_default()
            ),
        )
    } else {
        let year = release.year.map(|y| format!(" ({y})")).unwrap_or_default();
        check("title", "Matches the title", Verdict::Pass, format!("Reads as \"{shown}\"{year}"))
    });

    // Video files.
    let videos: Vec<_> = torrent
        .files
        .iter()
        .filter(|f| parser::file_kind(&f.path) == FileKind::Video && !parser::is_sample(&f.path, f.size))
        .collect();
    let video_bytes: u64 = videos.iter().map(|f| f.size).sum();
    checks.push(if videos.is_empty() {
        check(
            "video",
            "Has video files",
            Verdict::Fail,
            format!("None of the {} files are videos", torrent.files.len()),
        )
    } else {
        check(
            "video",
            "Has video files",
            Verdict::Pass,
            format!("{}, {}", plural(videos.len(), "video"), gb(video_bytes)),
        )
    });

    // Content: episode coverage for shows, a single feature for movies.
    match target.kind {
        MediaKind::Tv if !videos.is_empty() => {
            let seasons: Vec<(i64, i64)> = target
                .seasons
                .iter()
                .filter(|s| s.season_number > 0 && s.episode_count > 0)
                .filter(|s| requested_seasons.is_none_or(|r| r.contains(&s.season_number)))
                .map(|s| (s.season_number, s.episode_count))
                .collect();
            let mut have: BTreeSet<(i64, i64)> = BTreeSet::new();
            for f in &videos {
                let parsed = parser::parse_path(&f.path, &torrent.name);
                let season = parsed.season.or_else(|| (seasons.len() == 1).then(|| seasons[0].0));
                if let Some(season) = season {
                    for e in &parsed.episodes {
                        have.insert((season, *e));
                    }
                }
            }
            let mut parts = Vec::new();
            let (mut total, mut covered) = (0, 0);
            for (season, count) in &seasons {
                let n = (1..=*count).filter(|e| have.contains(&(*season, *e))).count() as i64;
                total += count;
                covered += n;
                if n > 0 || seasons.len() <= 4 {
                    parts.push(format!("S{season:02} {n}/{count}"));
                }
            }
            let other: BTreeSet<i64> = have
                .iter()
                .map(|(s, _)| *s)
                .filter(|s| !seasons.iter().any(|(r, _)| r == s))
                .collect();
            let label = if requested_seasons.is_some() { "Covers the requested seasons" } else { "Covers the show" };
            checks.push(if have.is_empty() {
                check(
                    "coverage",
                    label,
                    Verdict::Warn,
                    "Couldn't find season or episode numbers in the file names",
                )
            } else if covered == 0 {
                let others = other.iter().map(|s| format!("S{s:02}")).collect::<Vec<_>>().join(", ");
                check("coverage", label, Verdict::Fail, format!("Has {others}, none of what was asked for"))
            } else if covered < total {
                check(
                    "coverage",
                    label,
                    Verdict::Warn,
                    format!("{covered} of {total} episodes: {}", parts.join(", ")),
                )
            } else {
                check("coverage", label, Verdict::Pass, format!("All {total} episodes: {}", parts.join(", ")))
            });
        }
        MediaKind::Movie if !videos.is_empty() => {
            let largest = videos.iter().map(|f| f.size).max().unwrap_or(0);
            let features = videos.iter().filter(|f| f.size * 2 >= largest).count();
            let looks_tv = release.season.is_some() || !release.episodes.is_empty();
            checks.push(if looks_tv {
                check("content", "Single movie", Verdict::Warn, "The name looks like a TV release")
            } else if features > 1 {
                check(
                    "content",
                    "Single movie",
                    Verdict::Warn,
                    format!("{} similar sized videos, could be a collection", features),
                )
            } else if largest < 300 * 1_048_576 {
                check(
                    "content",
                    "Single movie",
                    Verdict::Warn,
                    format!("The main video is only {}, small for a feature", gb(largest)),
                )
            } else {
                check("content", "Single movie", Verdict::Pass, format!("Main video is {}", gb(largest)))
            });
        }
        _ => {}
    }

    // Quality, from the release name.
    let quality: Vec<&str> = [&release.resolution, &release.source, &release.video_codec, &release.hdr]
        .into_iter()
        .filter_map(|v| v.as_deref())
        .collect();
    checks.push(if release.source.as_deref() == Some("CAM") {
        check("quality", "Quality", Verdict::Warn, format!("{}: a cam or telesync recording", quality.join(" · ")))
    } else if quality.is_empty() {
        check("quality", "Quality", Verdict::Pass, "Not stated in the name")
    } else {
        check("quality", "Quality", Verdict::Pass, quality.join(" · "))
    });

    // Seeders.
    checks.push(match swarm {
        None => check(
            "seeders",
            "Has seeders",
            Verdict::Warn,
            "No trackers listed, so seeders can't be counted. It will rely on DHT.",
        ),
        Some(SwarmStats { skipped: Some(reason), .. }) => check(
            "seeders",
            "Has seeders",
            Verdict::Warn,
            format!("Not checked: {reason}"),
        ),
        Some(s) if s.trackers_answered == 0 => check(
            "seeders",
            "Has seeders",
            Verdict::Warn,
            format!("None of the {} trackers answered", s.trackers_tried),
        ),
        Some(s) if s.seeders == 0 => check(
            "seeders",
            "Has seeders",
            Verdict::Fail,
            format!("No seeders reported, {}", plural(s.leechers as usize, "leecher")),
        ),
        Some(s) => check(
            "seeders",
            "Has seeders",
            if s.seeders < 3 { Verdict::Warn } else { Verdict::Pass },
            format!(
                "{}, {}{}",
                plural(s.seeders as usize, "seeder"),
                plural(s.leechers as usize, "leecher"),
                if s.seeders < 3 { ". Playback may stall." } else { "" }
            ),
        ),
    });

    Review {
        verdict: checks.iter().map(|c| c.status).max().unwrap_or(Verdict::Pass),
        checks,
        size: torrent.total_size,
        file_count: torrent.files.len(),
        video_count: videos.len(),
        resolution: release.resolution,
        source: release.source,
        video_codec: release.video_codec,
        seeders: swarm.filter(|s| s.trackers_answered > 0).map(|s| s.seeders),
        leechers: swarm.filter(|s| s.trackers_answered > 0).map(|s| s.leechers),
        checked_at: Utc::now(),
    }
}

#[derive(sqlx::FromRow)]
struct RequestTorrent {
    kind: String,
    tmdb_id: i64,
    status: String,
    seasons: Option<Json<Vec<i64>>>,
    torrent_source: Option<String>,
    torrent_metainfo: Option<Vec<u8>>,
    torrent_attached: bool,
    review_status: Option<String>,
    user_id: i64,
}

async fn load(state: &AppState, request_id: i64) -> AppResult<RequestTorrent> {
    sqlx::query_as(
        "SELECT kind, tmdb_id, status, seasons, torrent_source, torrent_metainfo, torrent_attached,
                review_status, user_id
         FROM requests WHERE id = ?",
    )
    .bind(request_id)
    .fetch_optional(&state.main)
    .await?
    .ok_or_else(|| AppError::not_found("request not found"))
}

async fn set_error(state: &AppState, request_id: i64, message: String) {
    let review = serde_json::json!({ "error": message, "checked_at": Utc::now() });
    let _ = sqlx::query("UPDATE requests SET review_status = 'error', review = ? WHERE id = ?")
        .bind(Json(review))
        .bind(request_id)
        .execute(&state.main)
        .await;
}

/// Check a suggested torrent before the request is saved: magnets must be
/// valid and links are downloaded now, so a review never fetches a link
/// twice. Returns the .torrent bytes when there are any.
pub async fn prepare(source: &str, upload: Option<Bytes>) -> AppResult<Option<Bytes>> {
    if let Some(b) = upload {
        return Ok(Some(b));
    }
    Ok(match scan::parse_source(source)? {
        AddInput::Url(url) => Some(scan::fetch_torrent_url(&url).await?),
        AddInput::Magnet(m) => {
            scan::magnet_info_hash(&m)?;
            None
        }
        _ => None,
    })
}

/// Review the torrent attached to a request in the background.
pub fn spawn(state: &AppState, request_id: i64) {
    let state = state.clone();
    tokio::spawn(async move { run(&state, request_id).await });
}

async fn run(state: &AppState, request_id: i64) {
    let req = match load(state, request_id).await {
        Ok(r) => r,
        Err(_) => return,
    };
    let Some(source) = req.torrent_source.clone() else { return };
    let Some(kind) = MediaKind::parse(&req.kind) else { return };

    let resolved = match &req.torrent_metainfo {
        Some(bytes) => state.engine.resolve(TorrentSource::File(Bytes::from(bytes.clone()))).await,
        None => match scan::parse_source(&source) {
            Ok(AddInput::Magnet(m)) => scan::resolve_magnet(state, &m).await,
            Ok(_) => Err(anyhow::anyhow!("the .torrent file is missing")),
            Err(e) => Err(anyhow::anyhow!("{e}")),
        },
    };
    let mut resolved = match resolved {
        Ok(r) => r,
        Err(e) => {
            tracing::info!(request_id, error = %e, "could not resolve requested torrent");
            set_error(state, request_id, format!("Couldn't fetch the torrent's details: {e:#}")).await;
            return;
        }
    };
    if source.starts_with("magnet:") {
        for t in scan::magnet_trackers(&source) {
            if !resolved.trackers.contains(&t) {
                resolved.trackers.push(t);
            }
        }
    }

    let key = state.settings.tmdb_api_key().await;
    let lang = state.settings.language().await;
    let details = match state.metadata.tmdb.details(&key, &lang, kind, req.tmdb_id).await {
        Ok(d) => d,
        Err(e) => {
            set_error(state, request_id, format!("Couldn't load the title from TMDB: {e:#}")).await;
            return;
        }
    };

    let swarm = scrape::scrape(&resolved.trackers, &resolved.info_hash, &state.engine.net()).await;
    let mut review = evaluate(&resolved, &details, req.seasons.as_ref().map(|s| s.0.as_slice()), swarm.as_ref());

    if let Some(cfg) = crate::seedbox::Config::load(&state.settings).await {
        let c = match state.seedbox.is_cached(&cfg.api_key, &resolved.info_hash).await {
            Ok(true) => check("seedbox", "Ready on TorBox", Verdict::Pass, "Already cached, streams right away"),
            Ok(false) => check(
                "seedbox",
                "Ready on TorBox",
                Verdict::Warn,
                "Not cached yet, TorBox downloads it before it can stream",
            ),
            Err(e) => check("seedbox", "Ready on TorBox", Verdict::Warn, format!("Couldn't ask TorBox: {e:#}")),
        };
        review.checks.push(c);
        review.verdict = review.checks.iter().map(|c| c.status).max().unwrap_or(Verdict::Pass);
    }

    // Someone else may have attached the same torrent in the meantime.
    let attached_to: Option<String> = sqlx::query_scalar(
        "SELECT m.title FROM torrents t JOIN media m ON m.id = t.media_id WHERE t.info_hash = ?",
    )
    .bind(&resolved.info_hash)
    .fetch_optional(&state.media)
    .await
    .ok()
    .flatten();
    if let Some(title) = attached_to {
        review.checks.insert(
            0,
            check("duplicate", "Not in the library yet", Verdict::Fail, format!("Already attached to {title}")),
        );
        review.verdict = Verdict::Fail;
    }

    let saved = sqlx::query(
        "UPDATE requests SET torrent_info_hash = ?, torrent_name = ?, torrent_metainfo = ?,
            review_status = ?, review = ?
         WHERE id = ?",
    )
    .bind(&resolved.info_hash)
    .bind(&resolved.name)
    .bind(resolved.torrent_bytes.as_ref())
    .bind(review.verdict.as_str())
    .bind(Json(&review))
    .bind(request_id)
    .execute(&state.main)
    .await;
    if let Err(e) = saved {
        tracing::warn!(request_id, error = %e, "failed to save torrent review");
        return;
    }

    // Approved while we were checking (or auto-approved): attach it now,
    // unless the review found a real problem.
    if req.status == "approved"
        && review.verdict != Verdict::Fail
        && !req.torrent_attached
        && let Err(e) = attach(state, request_id, req.user_id).await
    {
        tracing::info!(request_id, error = %e, "could not attach requested torrent");
    }
}

/// Attach the request's torrent to its title. The title is added to the
/// library first if needed.
pub async fn attach(state: &AppState, request_id: i64, user_id: i64) -> AppResult<()> {
    let req = load(state, request_id).await?;
    if req.torrent_attached {
        return Ok(());
    }
    let Some(source) = req.torrent_source else {
        return Ok(());
    };
    if req.review_status.as_deref() == Some("checking") {
        // The review attaches it when it finishes.
        return Ok(());
    }
    let kind = MediaKind::parse(&req.kind).ok_or_else(|| AppError::bad_request("invalid kind"))?;
    let media_id = library::add_or_refresh(state, kind, req.tmdb_id).await?;
    let input = match req.torrent_metainfo {
        Some(bytes) => AddInput::Metainfo {
            bytes: Bytes::from(bytes),
            magnet: source.starts_with("magnet:").then_some(source),
        },
        None => scan::parse_source(&source)?,
    };
    scan::add_torrent(state, media_id, input, user_id).await?;
    sqlx::query("UPDATE requests SET torrent_attached = 1 WHERE id = ?")
        .bind(request_id)
        .execute(&state.main)
        .await?;
    Ok(())
}

/// Reviews interrupted by a restart start over.
pub async fn resume(state: &AppState) {
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM requests WHERE review_status = 'checking'")
        .fetch_all(&state.main)
        .await
        .unwrap_or_default();
    for id in ids {
        spawn(state, id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{metadata::SeasonSummary, torrents::engine::ResolvedFile};

    fn details(kind: MediaKind, title: &str, year: i64, seasons: &[(i64, i64)]) -> MediaDetails {
        let mut d: MediaDetails = serde_json::from_value(serde_json::json!({
            "kind": kind, "tmdb_id": 1, "tvdb_id": null, "imdb_id": null, "title": title,
            "original_title": null, "overview": null, "tagline": null, "status": null,
            "release_date": null, "year": year, "runtime": null, "rating": null, "vote_count": null,
            "certification": null, "original_language": null, "genres": [], "networks": [],
            "cast": [], "poster_path": null, "backdrop_path": null, "logo_path": null,
            "trailer_key": null, "seasons": [],
        }))
        .unwrap();
        d.seasons = seasons
            .iter()
            .map(|(n, c)| SeasonSummary {
                season_number: *n,
                name: None,
                overview: None,
                poster_path: None,
                air_date: None,
                episode_count: *c,
            })
            .collect();
        d
    }

    fn torrent(name: &str, files: &[(&str, u64)]) -> ResolvedTorrent {
        ResolvedTorrent {
            info_hash: "00".repeat(20),
            name: name.into(),
            total_size: files.iter().map(|f| f.1).sum(),
            piece_length: 1 << 20,
            files: files
                .iter()
                .enumerate()
                .map(|(index, (path, size))| ResolvedFile { index, path: path.to_string(), size: *size })
                .collect(),
            torrent_bytes: Bytes::new(),
            trackers: vec![],
        }
    }

    fn status(r: &Review, key: &str) -> Verdict {
        r.checks.iter().find(|c| c.key == key).unwrap().status
    }

    const GB: u64 = 1 << 30;
    const MB: u64 = 1 << 20;

    #[test]
    fn full_season_pack() {
        let files: Vec<(String, u64)> =
            (1..=10).map(|e| (format!("Severance.S01/Severance.S01E{e:02}.1080p.mkv"), 900 * MB)).collect();
        let files: Vec<(&str, u64)> = files.iter().map(|(p, s)| (p.as_str(), *s)).collect();
        let t = torrent("Severance.S01.1080p.WEB.H264-GROUP", &files);
        let d = details(MediaKind::Tv, "Severance", 2022, &[(1, 10), (2, 10)]);
        let swarm = SwarmStats { seeders: 40, leechers: 3, completed: None, trackers_answered: 2, trackers_tried: 3, skipped: None };

        let r = evaluate(&t, &d, Some(&[1]), Some(&swarm));
        assert_eq!(status(&r, "title"), Verdict::Pass);
        assert_eq!(status(&r, "coverage"), Verdict::Pass);
        assert_eq!(r.verdict, Verdict::Pass);

        // The whole show was asked for, season 2 is missing.
        let r = evaluate(&t, &d, None, Some(&swarm));
        assert_eq!(status(&r, "coverage"), Verdict::Warn);

        // Only season 2 was asked for.
        let r = evaluate(&t, &d, Some(&[2]), Some(&swarm));
        assert_eq!(status(&r, "coverage"), Verdict::Fail);
    }

    #[test]
    fn wrong_movie() {
        let t = torrent("Some.Other.Film.2019.1080p.BluRay.x264", &[("Some.Other.Film.2019.mkv", 8 * GB)]);
        let d = details(MediaKind::Movie, "Arrival", 2016, &[]);
        let r = evaluate(&t, &d, None, None);
        assert_eq!(status(&r, "title"), Verdict::Warn);
        assert_eq!(status(&r, "seeders"), Verdict::Warn);
    }

    #[test]
    fn movie_checks() {
        let d = details(MediaKind::Movie, "Arrival", 2016, &[]);
        let t = torrent("Arrival.2016.2160p.UHD.BluRay.x265-GRP", &[("Arrival.2016.mkv", 20 * GB), ("Sample/sample.mkv", 50 * MB)]);
        let r = evaluate(&t, &d, None, None);
        assert_eq!(status(&r, "title"), Verdict::Pass);
        assert_eq!(status(&r, "content"), Verdict::Pass);
        assert_eq!(r.video_count, 1);

        let t = torrent("Arrival.2016.CAM", &[("Arrival.txt", 1000)]);
        let swarm = SwarmStats { seeders: 0, leechers: 9, completed: None, trackers_answered: 1, trackers_tried: 1, skipped: None };
        let r = evaluate(&t, &d, None, Some(&swarm));
        assert_eq!(status(&r, "video"), Verdict::Fail);
        assert_eq!(status(&r, "quality"), Verdict::Warn);
        assert_eq!(status(&r, "seeders"), Verdict::Fail);
        assert_eq!(r.verdict, Verdict::Fail);
    }

    #[test]
    fn normalizes_titles() {
        assert_eq!(normalize("The Office (US)"), normalize("Office.US"));
        assert_eq!(normalize("Law & Order"), normalize("Law and Order"));
        assert_eq!(normalize("Shōgun"), normalize("Shogun"));
    }
}
