//! Subtitle helpers. Browsers only understand WebVTT.

use std::sync::LazyLock;

use regex::Regex;

static SRT_TIME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d{1,2}:\d{2}:\d{2}),(\d{3})").unwrap());

/// Decode subtitle bytes, falling back to Windows-1252 for old SRT files.
pub fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

pub fn srt_to_vtt(srt: &str) -> String {
    let normalized = srt.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(normalized.len() + 16);
    out.push_str("WEBVTT\n\n");
    for line in normalized.lines() {
        if line.contains("-->") {
            out.push_str(&SRT_TIME.replace_all(line, "$1.$2"));
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_srt() {
        let vtt = srt_to_vtt("1\r\n00:00:01,000 --> 00:00:02,500\r\nHello, world\r\n");
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("00:00:01.000 --> 00:00:02.500"));
        assert!(vtt.contains("Hello, world"));
    }
}
