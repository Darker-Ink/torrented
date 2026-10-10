//! Release name parsing, in the spirit of Sonarr/Radarr.
//!
//! Given a torrent name or a file path inside a torrent, work out which
//! season/episodes it contains plus quality details. The parser is
//! deliberately forgiving; anything it gets wrong can be fixed by hand from
//! the file mapping editor.

use std::{path::Path, sync::LazyLock};

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Video,
    Subtitle,
    Other,
}

impl FileKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Subtitle => "subtitle",
            Self::Other => "other",
        }
    }
}

const VIDEO_EXTS: &[&str] = &[
    "mkv", "mp4", "m4v", "avi", "webm", "mov", "ts", "m2ts", "wmv", "mpg", "mpeg", "flv", "ogv",
];
const SUBTITLE_EXTS: &[&str] = &["srt", "vtt", "ass", "ssa", "sub"];

pub fn extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

pub fn file_kind(path: &str) -> FileKind {
    match extension(path).as_deref() {
        Some(e) if VIDEO_EXTS.contains(&e) => FileKind::Video,
        Some(e) if SUBTITLE_EXTS.contains(&e) => FileKind::Subtitle,
        _ => FileKind::Other,
    }
}

static SAMPLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|[\\/ ._\-\[(])(sample|trailer|featurette)([\\/ ._\-\])]|$)").unwrap());

/// Samples and trailers bundled with releases; ignored when mapping.
pub fn is_sample(path: &str, size: u64) -> bool {
    SAMPLE_RE.is_match(path) && size < 600 * 1024 * 1024
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Release {
    pub title: Option<String>,
    pub year: Option<i64>,
    pub season: Option<i64>,
    pub episodes: Vec<i64>,
    pub absolute_episodes: Vec<i64>,
    /// Name refers to a whole season (or several) rather than episodes.
    pub full_season: bool,
    pub resolution: Option<String>,
    pub source: Option<String>,
    pub video_codec: Option<String>,
    pub audio: Option<String>,
    pub hdr: Option<String>,
    pub release_group: Option<String>,
}

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pat).unwrap());
    };
}

re!(SXXEXX, r"(?i)\bS(\d{1,3})[ ._-]?E(\d{1,4})((?:[ ._]?-?[ ._]?E?\d{1,4}(?:\b|E))*)");
re!(MULTI_EP, r"(?i)(-?)[ ._]?E?(\d{1,4})");
re!(NXNN, r"(?i)\b(\d{1,2})x(\d{2,3})(?:[-x](\d{2,3}))?\b");
re!(SEASON_EPISODE_WORDS, r"(?i)\bseason[ ._-]?(\d{1,3})[ ._-]*(?:episode|ep)[ ._-]?(\d{1,4})\b");
re!(SEASON_ONLY, r"(?i)\b(?:S(\d{1,3})(?:[ ._-]?-[ ._-]?S?(\d{1,3}))?|season[ ._-]?(\d{1,3})(?:[ ._-]?-[ ._-]?(\d{1,3}))?)\b");
re!(EPISODE_ONLY, r"(?i)(?:^|[ ._\-\[])(?:E|EP|Episode)[ ._-]?(\d{1,4})(?:[ ._\-\]v]|$)");
re!(ANIME_ABSOLUTE, r"(?i)^(?:\[[^\]]+\][ ._]*)?(.+?)[ ._]+-[ ._]+(\d{1,4})(?:v\d)?(?:[ ._]|\[|\(|$)");
re!(LEADING_NUMBER, r"^(\d{1,3})(?:[ ._-]|$)");
re!(YEAR, r"\b((?:19|20)\d{2})\b");
re!(RESOLUTION, r"(?i)\b(2160p|4k|uhd|1080[pi]|720p|576p|480p)\b");
re!(SOURCE, r"(?i)\b(remux|blu-?ray|bdrip|brrip|bdremux|web-?dl|webrip|web|hdtv|dvdrip|dvd|hdrip|hdcam|cam|telesync)\b");
re!(CODEC, r"(?i)\b(x264|h\.?264|avc|x265|h\.?265|hevc|av1|xvid|divx|vp9)\b");
re!(AUDIO, r"(?i)\b(truehd|atmos|dts-?hd(?:[ .-]?ma)?|dts-?x|dts|ddp?[ .]?[257]\.?[01]|e-?ac-?3|ac-?3|aac(?:[ .]?[257]\.?[01])?|flac|opus|mp3)\b");
re!(HDR, r"(?i)\b(hdr10\+|hdr10plus|hdr10|hdr|dv|dovi|dolby[ .]?vision|hlg)\b");
re!(GROUP_SUFFIX, r"-([A-Za-z0-9][A-Za-z0-9_]{1,24})(?:\[[^\]]*\])?$");
re!(GROUP_PREFIX, r"^\[([^\]]{1,40})\]");
re!(BRACKETS, r"[\[(][^\])]*[\])]");

fn strip_extension(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) if name.len() - i <= 5 && extension(name).is_some_and(|e| {
            VIDEO_EXTS.contains(&e.as_str()) || SUBTITLE_EXTS.contains(&e.as_str()) || e == "torrent"
        }) => &name[..i],
        _ => name,
    }
}

fn clean_title(raw: &str) -> Option<String> {
    let without_brackets = BRACKETS.replace_all(raw, " ");
    let t: String = without_brackets
        .replace(['.', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let t = t.trim_matches(|c: char| c == '-' || c == ' ' || c == '(').trim().to_string();
    (!t.is_empty()).then_some(t)
}

fn expand_episodes(first: i64, rest: &str) -> Vec<i64> {
    let mut eps = vec![first];
    let mut last = first;
    for cap in MULTI_EP.captures_iter(rest) {
        let Ok(n) = cap[2].parse::<i64>() else { continue };
        let is_range = !cap[1].is_empty();
        if is_range && n > last && n - last < 100 {
            eps.extend(last + 1..=n);
        } else if n != last && !eps.contains(&n) {
            eps.push(n);
        }
        last = n;
    }
    eps.sort_unstable();
    eps.dedup();
    eps
}

fn normalize_resolution(r: &str) -> String {
    match r.to_ascii_lowercase().as_str() {
        "4k" | "uhd" => "2160p".into(),
        "1080i" => "1080p".into(),
        other => other.into(),
    }
}

fn normalize_source(s: &str) -> String {
    let l = s.to_ascii_lowercase().replace('-', "");
    match l.as_str() {
        "remux" | "bdremux" => "Remux",
        "bluray" | "bdrip" | "brrip" => "BluRay",
        "webdl" | "web" => "WEB-DL",
        "webrip" => "WEBRip",
        "hdtv" => "HDTV",
        "dvdrip" | "dvd" => "DVD",
        "hdrip" => "HDRip",
        _ => "CAM",
    }
    .to_string()
}

fn normalize_codec(c: &str) -> String {
    let l = c.to_ascii_lowercase().replace('.', "");
    match l.as_str() {
        "x264" | "h264" | "avc" => "H.264",
        "x265" | "h265" | "hevc" => "H.265",
        "av1" => "AV1",
        "vp9" => "VP9",
        _ => "XviD",
    }
    .to_string()
}

fn normalize_audio(a: &str) -> String {
    let l = a.to_ascii_lowercase();
    if l.starts_with("truehd") {
        "TrueHD".into()
    } else if l == "atmos" {
        "Atmos".into()
    } else if l.starts_with("dts") {
        if l.contains("hd") { "DTS-HD".into() } else if l.contains('x') { "DTS:X".into() } else { "DTS".into() }
    } else if l.starts_with("ddp") || l.replace('-', "").starts_with("eac3") {
        "DD+".into()
    } else if l.starts_with("dd") || l.replace('-', "").starts_with("ac3") {
        "DD".into()
    } else if l.starts_with("aac") {
        "AAC".into()
    } else {
        l.to_ascii_uppercase()
    }
}

fn normalize_hdr(h: &str) -> String {
    let l = h.to_ascii_lowercase().replace([' ', '.'], "");
    match l.as_str() {
        "hdr10+" | "hdr10plus" => "HDR10+",
        "hdr10" => "HDR10",
        "dv" | "dovi" | "dolbyvision" => "DV",
        "hlg" => "HLG",
        _ => "HDR",
    }
    .to_string()
}

/// Parse a release or file name (without directories).
pub fn parse(name: &str) -> Release {
    let name = strip_extension(name.trim());
    let mut r = Release::default();
    // Earliest position of anything that is clearly not part of the title.
    let mut title_end = name.len();

    if let Some(c) = SXXEXX.captures(name) {
        let season: i64 = c[1].parse().unwrap_or(0);
        let first: i64 = c[2].parse().unwrap_or(0);
        r.season = Some(season);
        r.episodes = expand_episodes(first, c.get(3).map_or("", |m| m.as_str()));
        title_end = title_end.min(c.get(0).unwrap().start());
    } else if let Some(c) = SEASON_EPISODE_WORDS.captures(name) {
        r.season = c[1].parse().ok();
        r.episodes = c[2].parse().ok().into_iter().collect();
        title_end = title_end.min(c.get(0).unwrap().start());
    } else if let Some(c) = NXNN.captures(name).filter(|c| {
        // Avoid matching resolutions like 1920x1080.
        c[1].parse::<i64>().unwrap_or(0) < 50
    }) {
        r.season = c[1].parse().ok();
        let first: i64 = c[2].parse().unwrap_or(0);
        r.episodes = match c.get(3).and_then(|m| m.as_str().parse::<i64>().ok()) {
            Some(last) if last > first => (first..=last).collect(),
            _ => vec![first],
        };
        title_end = title_end.min(c.get(0).unwrap().start());
    } else if let Some(c) = SEASON_ONLY.captures(name) {
        let start = c.get(1).or(c.get(3)).and_then(|m| m.as_str().parse::<i64>().ok());
        r.season = start;
        r.full_season = true;
        title_end = title_end.min(c.get(0).unwrap().start());
        if let Some(c) = EPISODE_ONLY.captures(name) {
            r.episodes = c[1].parse().ok().into_iter().collect();
            r.full_season = r.episodes.is_empty();
        }
    } else if let Some(c) = ANIME_ABSOLUTE.captures(name) {
        if let Ok(n) = c[2].parse::<i64>()
            && YEAR.captures(&c[2]).is_none()
        {
            r.absolute_episodes = vec![n];
            title_end = title_end.min(c.get(2).unwrap().start());
        }
    } else if let Some(c) = EPISODE_ONLY.captures(name) {
        r.episodes = c[1].parse().ok().into_iter().collect();
        title_end = title_end.min(c.get(0).unwrap().start());
    } else if let Some(c) = LEADING_NUMBER.captures(name) {
        r.episodes = c[1].parse().ok().into_iter().collect();
    }

    // Year: the last plausible one before any quality markers, so titles
    // containing a year ("Blade Runner 2049 2017") keep it. A year at the very
    // start of the name is part of the title ("1917").
    let quality_start = [RESOLUTION.find(name), SOURCE.find(name), CODEC.find(name)]
        .into_iter()
        .flatten()
        .map(|m| m.start())
        .min()
        .unwrap_or(name.len());
    let year = YEAR
        .find_iter(name)
        .filter(|m| m.start() > 0 && m.start() < quality_start)
        .last();
    if let Some(m) = year {
        r.year = m.as_str().parse().ok();
        title_end = title_end.min(m.start());
    }

    if let Some(m) = RESOLUTION.find(name) {
        r.resolution = Some(normalize_resolution(m.as_str()));
        title_end = title_end.min(m.start());
    }
    if let Some(m) = SOURCE.find(name) {
        r.source = Some(normalize_source(m.as_str()));
        title_end = title_end.min(m.start());
    }
    if let Some(m) = CODEC.find(name) {
        r.video_codec = Some(normalize_codec(m.as_str()));
        title_end = title_end.min(m.start());
    }
    if let Some(m) = AUDIO.find(name) {
        r.audio = Some(normalize_audio(m.as_str()));
    }
    if let Some(m) = HDR.find(name) {
        r.hdr = Some(normalize_hdr(m.as_str()));
    }

    if let Some(c) = GROUP_PREFIX.captures(name) {
        r.release_group = Some(c[1].trim().to_string());
    } else if let Some(c) = GROUP_SUFFIX.captures(name) {
        let g = c[1].to_string();
        let lower = g.to_ascii_lowercase();
        // Don't mistake trailing quality tokens for a group.
        if !RESOLUTION.is_match(&g) && !CODEC.is_match(&g) && lower != "dl" && lower != "rip" {
            r.release_group = Some(g);
        }
    }

    let title_part = &name[..title_end];
    let title_part = GROUP_PREFIX.replace(title_part, "");
    r.title = clean_title(&title_part);
    r
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ParsedFile {
    pub season: Option<i64>,
    pub episodes: Vec<i64>,
    pub absolute_episodes: Vec<i64>,
    pub release: Release,
}

/// Parse a path inside a torrent. Season information can come from parent
/// folders ("Show.S02/", "Season 3/") when the file name only has episodes.
pub fn parse_path(path: &str, torrent_name: &str) -> ParsedFile {
    let normalized = path.replace('\\', "/");
    let mut components: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let file_name = components.pop().unwrap_or("");
    let release = parse(file_name);

    let mut season = release.season;
    if season.is_none() {
        for dir in components.iter().rev().copied().chain(std::iter::once(torrent_name)) {
            let parent = parse(dir);
            if parent.season.is_some() {
                season = parent.season;
                break;
            }
        }
    }

    ParsedFile {
        season,
        episodes: release.episodes.clone(),
        absolute_episodes: release.absolute_episodes.clone(),
        release,
    }
}

static LANG_TOKENS: &[(&str, &[&str])] = &[
    ("en", &["en", "eng", "english"]),
    ("es", &["es", "spa", "spanish", "español", "esp"]),
    ("fr", &["fr", "fre", "fra", "french"]),
    ("de", &["de", "ger", "deu", "german"]),
    ("it", &["it", "ita", "italian"]),
    ("pt", &["pt", "por", "portuguese", "pt-br", "ptbr", "brazilian"]),
    ("nl", &["nl", "dut", "nld", "dutch"]),
    ("sv", &["sv", "swe", "swedish"]),
    ("no", &["no", "nor", "norwegian"]),
    ("da", &["da", "dan", "danish"]),
    ("fi", &["fi", "fin", "finnish"]),
    ("pl", &["pl", "pol", "polish"]),
    ("ru", &["ru", "rus", "russian"]),
    ("ja", &["ja", "jpn", "japanese"]),
    ("ko", &["ko", "kor", "korean"]),
    ("zh", &["zh", "chi", "zho", "chinese", "chs", "cht"]),
    ("ar", &["ar", "ara", "arabic"]),
    ("tr", &["tr", "tur", "turkish"]),
    ("he", &["he", "heb", "hebrew"]),
    ("hi", &["hi", "hin", "hindi"]),
];

/// Best-effort language detection for subtitle files, e.g.
/// `Show.S01E01.en.srt`, `Subs/2_English.srt`.
pub fn subtitle_language(path: &str) -> Option<String> {
    let lower = strip_extension(&path.to_lowercase()).to_string();
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|t| !t.is_empty())
        .collect();
    // Prefer tokens near the end of the name.
    for token in tokens.iter().rev().take(4) {
        for (code, names) in LANG_TOKENS {
            if names.contains(token) {
                return Some((*code).to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_episode() {
        let r = parse("The.Office.US.S02E05.720p.WEB-DL.DD5.1.H.264-GROUP.mkv");
        assert_eq!(r.title.as_deref(), Some("The Office US"));
        assert_eq!(r.season, Some(2));
        assert_eq!(r.episodes, vec![5]);
        assert_eq!(r.resolution.as_deref(), Some("720p"));
        assert_eq!(r.source.as_deref(), Some("WEB-DL"));
        assert_eq!(r.video_codec.as_deref(), Some("H.264"));
        assert_eq!(r.audio.as_deref(), Some("DD"));
        assert_eq!(r.release_group.as_deref(), Some("GROUP"));
    }

    #[test]
    fn multi_episode_formats() {
        assert_eq!(parse("Show.S01E01E02.1080p.mkv").episodes, vec![1, 2]);
        assert_eq!(parse("Show.S01E01-E03.1080p.mkv").episodes, vec![1, 2, 3]);
        assert_eq!(parse("Show - S03E10-11 - Title.mkv").episodes, vec![10, 11]);
        assert_eq!(parse("Show.1x05.HDTV.avi").episodes, vec![5]);
        assert_eq!(parse("Show.1x05.HDTV.avi").season, Some(1));
        assert_eq!(parse("Show 2x01-02.mkv").episodes, vec![1, 2]);
    }

    #[test]
    fn season_pack() {
        let r = parse("Breaking.Bad.S03.1080p.BluRay.x265-PACK");
        assert_eq!(r.title.as_deref(), Some("Breaking Bad"));
        assert_eq!(r.season, Some(3));
        assert!(r.full_season);
        assert!(r.episodes.is_empty());
        assert_eq!(r.video_codec.as_deref(), Some("H.265"));

        let r = parse("Some Show Season 2 Complete 720p");
        assert_eq!(r.season, Some(2));
        assert!(r.full_season);
    }

    #[test]
    fn movie() {
        let r = parse("Blade.Runner.2049.2017.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-EPSiLON.mkv");
        assert_eq!(r.title.as_deref(), Some("Blade Runner 2049"));
        assert_eq!(r.year, Some(2017));
        assert_eq!(r.resolution.as_deref(), Some("2160p"));
        assert_eq!(r.hdr.as_deref(), Some("HDR"));
        assert_eq!(r.release_group.as_deref(), Some("EPSiLON"));
        assert!(r.season.is_none());

        let r = parse("1917 (2019) [1080p]");
        assert_eq!(r.title.as_deref(), Some("1917"));
        assert_eq!(r.year, Some(2019));
    }

    #[test]
    fn anime_absolute() {
        let r = parse("[SubsPlease] Sousou no Frieren - 12 (1080p) [ABCD1234].mkv");
        assert_eq!(r.absolute_episodes, vec![12]);
        assert_eq!(r.title.as_deref(), Some("Sousou no Frieren"));
        assert_eq!(r.release_group.as_deref(), Some("SubsPlease"));
        assert_eq!(r.resolution.as_deref(), Some("1080p"));
    }

    #[test]
    fn season_from_folder() {
        let f = parse_path("Show.S02.1080p/Episode 03.mkv", "Show Complete");
        assert_eq!(f.season, Some(2));
        assert_eq!(f.episodes, vec![3]);

        let f = parse_path("Show/Season 4/05 - The One.mkv", "Show");
        assert_eq!(f.season, Some(4));
        assert_eq!(f.episodes, vec![5]);

        let f = parse_path("E07.mkv", "Show.S01.WEB");
        assert_eq!(f.season, Some(1));
        assert_eq!(f.episodes, vec![7]);
    }

    #[test]
    fn kinds_and_samples() {
        assert_eq!(file_kind("a/b.MKV"), FileKind::Video);
        assert_eq!(file_kind("a/b.srt"), FileKind::Subtitle);
        assert_eq!(file_kind("a/b.nfo"), FileKind::Other);
        assert!(is_sample("Movie/Sample/movie-sample.mkv", 50_000_000));
        assert!(!is_sample("Sample.Movie.2020.mkv".replace("Sample.", "").as_str(), 50_000_000));
        assert!(!is_sample("Movie/movie.mkv", 5_000_000_000));
    }

    #[test]
    fn subtitle_languages() {
        assert_eq!(subtitle_language("Show.S01E01.en.srt").as_deref(), Some("en"));
        assert_eq!(subtitle_language("Subs/2_English.srt").as_deref(), Some("en"));
        assert_eq!(subtitle_language("Subs/French.srt").as_deref(), Some("fr"));
        assert_eq!(subtitle_language("movie.srt"), None);
    }

    #[test]
    fn resolution_is_not_episode() {
        let r = parse("Movie.2010.1920x1080.mkv");
        assert!(r.episodes.is_empty());
        assert_eq!(r.year, Some(2010));
    }
}
