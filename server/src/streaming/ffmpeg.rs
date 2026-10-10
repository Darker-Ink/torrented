//! ffmpeg/ffprobe integration: partial scans of torrent files (only the
//! pieces holding container headers/indexes get fetched) and on-the-fly
//! remuxing or transcoding for files a browser can't play natively.

use std::{process::Stdio, time::Duration};

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::{Child, Command};

#[derive(Debug, Clone, Serialize)]
pub struct MediaTools {
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub ffmpeg_version: Option<String>,
}

async fn detect(bin: &str) -> Option<String> {
    let out = Command::new(bin)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(|l| l.to_string())
}

impl MediaTools {
    pub async fn detect(ffmpeg: &str, ffprobe: &str) -> Self {
        let ffmpeg_version = detect(ffmpeg).await;
        let ffprobe_ok = detect(ffprobe).await.is_some();
        let tools = Self {
            ffmpeg: ffmpeg_version.as_ref().map(|_| ffmpeg.to_string()),
            ffprobe: ffprobe_ok.then(|| ffprobe.to_string()),
            ffmpeg_version,
        };
        match (&tools.ffmpeg, &tools.ffprobe) {
            (Some(_), Some(_)) => tracing::info!(
                version = tools.ffmpeg_version.as_deref().unwrap_or(""),
                "ffmpeg found, remuxing and probing enabled"
            ),
            _ => tracing::warn!(
                "ffmpeg/ffprobe not found; only browser-compatible files will play and files won't be probed"
            ),
        }
        tools
    }

    pub fn can_probe(&self) -> bool {
        self.ffprobe.is_some()
    }

    pub fn can_transcode(&self) -> bool {
        self.ffmpeg.is_some()
    }

    /// Run ffprobe against a (local) URL. ffprobe only reads what it needs,
    /// so for a torrent this downloads the first/last pieces of the file.
    pub async fn probe(&self, url: &str) -> anyhow::Result<ProbeResult> {
        let bin = self.ffprobe.as_deref().context("ffprobe is not available")?;
        let child = Command::new(bin)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                "-probesize",
                "20M",
                "-analyzeduration",
                "20M",
                "-rw_timeout",
                "120000000",
                url,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("starting ffprobe")?;
        let out = tokio::time::timeout(Duration::from_secs(300), child.wait_with_output())
            .await
            .map_err(|_| anyhow::anyhow!("ffprobe timed out waiting for torrent data"))??;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            bail!("ffprobe failed: {}", err.trim());
        }
        let v: Value = serde_json::from_slice(&out.stdout).context("parsing ffprobe output")?;
        Ok(ProbeResult::from_json(&v))
    }

    /// Spawn ffmpeg writing fragmented MP4 to stdout.
    pub fn spawn_stream(&self, url: &str, opts: &TranscodeOptions) -> anyhow::Result<Child> {
        let bin = self.ffmpeg.as_deref().context("ffmpeg is not available")?;
        let mut cmd = Command::new(bin);
        cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
        cmd.args(["-reconnect", "1", "-reconnect_streamed", "1", "-rw_timeout", "120000000"]);
        if opts.start > 0.0 {
            cmd.args(["-ss", &format!("{:.3}", opts.start)]);
        }
        cmd.args(["-i", url]);
        cmd.args(["-map", "0:v:0"]);
        match opts.audio_stream {
            Some(i) => cmd.args(["-map", &format!("0:a:{i}?")]),
            None => cmd.args(["-map", "0:a:0?"]),
        };
        if opts.transcode_video {
            cmd.args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "21",
                "-pix_fmt",
                "yuv420p",
                "-profile:v",
                "high",
                "-vf",
                "scale='min(1920,iw)':-2",
                "-g",
                "96",
            ]);
        } else {
            cmd.args(["-c:v", "copy"]);
        }
        if opts.copy_audio {
            cmd.args(["-c:a", "copy"]);
        } else {
            cmd.args(["-c:a", "aac", "-b:a", "192k", "-ac", "2"]);
        }
        cmd.args([
            "-sn",
            "-dn",
            "-max_muxing_queue_size",
            "2048",
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
        ]);
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .kill_on_drop(true);
        cmd.spawn().context("starting ffmpeg")
    }

    /// Convert a subtitle file (ass/ssa/sub…) to WebVTT.
    pub async fn subtitle_to_vtt(&self, input: Vec<u8>, ext: &str) -> anyhow::Result<String> {
        use tokio::io::AsyncWriteExt;
        let bin = self.ffmpeg.as_deref().context("ffmpeg is not available")?;
        let mut child = Command::new(bin)
            .args(["-hide_banner", "-loglevel", "error", "-f", ext, "-i", "pipe:0", "-f", "webvtt", "pipe:1"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let mut stdin = child.stdin.take().context("no stdin")?;
        tokio::spawn(async move {
            let _ = stdin.write_all(&input).await;
        });
        let out = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output()).await??;
        if !out.status.success() {
            bail!("ffmpeg could not convert subtitles");
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

#[derive(Debug, Clone, Default)]
pub struct TranscodeOptions {
    pub start: f64,
    pub audio_stream: Option<usize>,
    pub transcode_video: bool,
    pub copy_audio: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AudioTrack {
    /// Index among audio streams (ffmpeg `0:a:N`).
    pub index: usize,
    pub codec: Option<String>,
    pub channels: Option<i64>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub default: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub index: usize,
    pub codec: Option<String>,
    pub language: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProbeResult {
    pub format: Option<String>,
    pub duration: Option<f64>,
    pub bitrate: Option<i64>,
    pub video_codec: Option<String>,
    pub video_profile: Option<String>,
    pub pix_fmt: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub hdr: bool,
    pub audio: Vec<AudioTrack>,
    pub subtitles: Vec<SubtitleTrack>,
}

impl ProbeResult {
    fn from_json(v: &Value) -> Self {
        let mut r = ProbeResult {
            format: v["format"]["format_name"].as_str().map(String::from),
            duration: v["format"]["duration"].as_str().and_then(|d| d.parse().ok()),
            bitrate: v["format"]["bit_rate"].as_str().and_then(|d| d.parse().ok()),
            ..Default::default()
        };
        let tag = |s: &Value, k: &str| s["tags"][k].as_str().map(String::from);
        for s in v["streams"].as_array().into_iter().flatten() {
            match s["codec_type"].as_str() {
                Some("video") if r.video_codec.is_none() => {
                    // Skip cover art.
                    if s["disposition"]["attached_pic"].as_i64() == Some(1) {
                        continue;
                    }
                    r.video_codec = s["codec_name"].as_str().map(String::from);
                    r.video_profile = s["profile"].as_str().map(String::from);
                    r.pix_fmt = s["pix_fmt"].as_str().map(String::from);
                    r.width = s["width"].as_i64();
                    r.height = s["height"].as_i64();
                    let transfer = s["color_transfer"].as_str().unwrap_or("");
                    r.hdr = matches!(transfer, "smpte2084" | "arib-std-b67");
                }
                Some("audio") => r.audio.push(AudioTrack {
                    index: r.audio.len(),
                    codec: s["codec_name"].as_str().map(String::from),
                    channels: s["channels"].as_i64(),
                    language: tag(s, "language"),
                    title: tag(s, "title"),
                    default: s["disposition"]["default"].as_i64() == Some(1),
                }),
                Some("subtitle") => r.subtitles.push(SubtitleTrack {
                    index: r.subtitles.len(),
                    codec: s["codec_name"].as_str().map(String::from),
                    language: tag(s, "language"),
                    title: tag(s, "title"),
                }),
                _ => {}
            }
        }
        if r.duration.is_none() {
            r.duration = v["streams"]
                .as_array()
                .and_then(|a| a.iter().find_map(|s| s["duration"].as_str()?.parse().ok()));
        }
        r
    }

    pub fn resolution_label(&self) -> Option<String> {
        let (w, h) = (self.width?, self.height?);
        Some(
            match w.max(h * 16 / 9) {
                x if x >= 3200 => "2160p",
                x if x >= 1800 => "1080p",
                x if x >= 1200 => "720p",
                x if x >= 900 => "576p",
                _ => "480p",
            }
            .to_string(),
        )
    }

    pub fn primary_audio_codec(&self) -> Option<String> {
        self.audio
            .iter()
            .find(|a| a.default)
            .or(self.audio.first())
            .and_then(|a| a.codec.clone())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackMode {
    Direct,
    Remux,
    Transcode,
}

impl PlaybackMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Remux => "remux",
            Self::Transcode => "transcode",
        }
    }
}

/// What the client says it can decode, beyond the safe baseline.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct ClientCaps {
    #[serde(default)]
    pub hevc: bool,
    #[serde(default)]
    pub ac3: bool,
    #[serde(default)]
    pub mkv: bool,
}

const DIRECT_VIDEO: &[&str] = &["h264", "vp8", "vp9", "av1"];
const DIRECT_AUDIO: &[&str] = &["aac", "mp3", "opus", "vorbis", "flac"];

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackPlan {
    pub mode: PlaybackMode,
    pub reason: String,
    pub transcode_video: bool,
    pub copy_audio: bool,
}

/// Decide how a file should reach the browser.
pub fn plan(ext: &str, probe: Option<&ProbeResult>, caps: ClientCaps, can_transcode: bool) -> PlaybackPlan {
    let direct = |reason: &str| PlaybackPlan {
        mode: PlaybackMode::Direct,
        reason: reason.into(),
        transcode_video: false,
        copy_audio: true,
    };
    let browser_container = matches!(ext, "mp4" | "m4v" | "webm" | "mov") || (caps.mkv && ext == "mkv");

    let Some(probe) = probe else {
        return if browser_container || !can_transcode {
            direct("file not probed; trying direct play")
        } else {
            PlaybackPlan {
                mode: PlaybackMode::Remux,
                reason: "file not probed; remuxing to MP4".into(),
                transcode_video: false,
                copy_audio: false,
            }
        };
    };

    let vcodec = probe.video_codec.as_deref().unwrap_or("");
    let video_ok = DIRECT_VIDEO.contains(&vcodec) || (caps.hevc && vcodec == "hevc");
    let acodec = probe.primary_audio_codec();
    let audio_ok = match acodec.as_deref() {
        None => true,
        Some(a) => DIRECT_AUDIO.contains(&a) || (caps.ac3 && matches!(a, "ac3" | "eac3")),
    };
    // 10-bit H.264 isn't decodable by browsers.
    let ten_bit = probe.pix_fmt.as_deref().is_some_and(|p| p.contains("10"));
    let video_ok = video_ok && !(vcodec == "h264" && ten_bit);

    if !can_transcode {
        return direct("ffmpeg unavailable; playing original file");
    }
    if video_ok && audio_ok && browser_container {
        return direct("browser compatible");
    }
    if video_ok {
        return PlaybackPlan {
            mode: PlaybackMode::Remux,
            reason: format!(
                "repackaging {} to MP4{}",
                ext,
                if audio_ok { "" } else { " and converting audio to AAC" }
            ),
            transcode_video: false,
            copy_audio: audio_ok,
        };
    }
    PlaybackPlan {
        mode: PlaybackMode::Transcode,
        reason: format!("transcoding {} video to H.264", if vcodec.is_empty() { "unknown" } else { vcodec }),
        transcode_video: true,
        copy_audio: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(v: &str, a: &str) -> ProbeResult {
        ProbeResult {
            video_codec: Some(v.into()),
            pix_fmt: Some("yuv420p".into()),
            audio: vec![AudioTrack {
                codec: Some(a.into()),
                default: true,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn plans() {
        let caps = ClientCaps::default();
        assert_eq!(plan("mp4", Some(&probe("h264", "aac")), caps, true).mode, PlaybackMode::Direct);
        assert_eq!(plan("mkv", Some(&probe("h264", "aac")), caps, true).mode, PlaybackMode::Remux);
        let p = plan("mp4", Some(&probe("h264", "ac3")), caps, true);
        assert_eq!(p.mode, PlaybackMode::Remux);
        assert!(!p.copy_audio);
        assert_eq!(plan("mkv", Some(&probe("hevc", "aac")), caps, true).mode, PlaybackMode::Transcode);
        let hevc = ClientCaps { hevc: true, ..caps };
        assert_eq!(plan("mkv", Some(&probe("hevc", "aac")), hevc, true).mode, PlaybackMode::Remux);
        assert_eq!(plan("mkv", Some(&probe("hevc", "aac")), caps, false).mode, PlaybackMode::Direct);
    }
}
