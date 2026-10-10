import {
  ArrowLeftIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ChatBubbleBottomCenterTextIcon,
  ForwardIcon,
  InformationCircleIcon,
  LanguageIcon,
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/solid";
import { ArrowUturnLeftIcon, ArrowUturnRightIcon } from "@heroicons/react/24/outline";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { episodeCode, formatBytes, formatClock } from "@/lib/format";
import type { PlayInfo } from "@/lib/types";
import { reportProgress } from "../hooks/usePlayback";
import { useSubtitles } from "../hooks/useSubtitles";
import BufferingOverlay from "./BufferingOverlay";
import CueText from "./CueText";
import SeekBar from "./SeekBar";
import TrackMenu from "./TrackMenu";
import UpNext from "./UpNext";

type Props = { info: PlayInfo };

const VOLUME_KEY = "torrented.volume";
const SUBS_KEY = "torrented.subtitles";

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const iconButton =
  "grid size-10 place-items-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white focus:outline-none";

const VideoPlayer = ({ info }: Props) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const [compat, setCompat] = useState(false);
  const mode = compat && info.mode === "direct" ? "remux" : info.mode;
  const seekable = mode === "direct";
  const baseUrl = compat && info.mode === "direct" ? `/api/stream/${info.file_id}/transcode?sid=${info.session_id}` : info.url;

  const validResume = info.resume_at > 10 && (!info.duration || info.resume_at < info.duration * 0.95);
  const [offset, setOffset] = useState(!seekable && validResume ? info.resume_at : 0);
  const [audio, setAudio] = useState<number | null>(null);
  const [current, setCurrent] = useState(validResume ? info.resume_at : 0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => Number(storage.get(VOLUME_KEY) ?? 1));
  const [muted, setMuted] = useState(false);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [resumedNote, setResumedNote] = useState(validResume);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState(10);

  const preferredLang = storage.get(SUBS_KEY);
  const [subtitle, setSubtitle] = useState<string>(() => {
    if (!preferredLang || preferredLang === "off") return "off";
    const match = info.subtitles.find((s) => s.language === preferredLang);
    return match ? String(match.file_id) : "off";
  });
  const subUrl = subtitle === "off" ? null : (info.subtitles.find((s) => String(s.file_id) === subtitle)?.url ?? null);
  const { text: cueText } = useSubtitles(subUrl, current);

  const src = seekable
    ? baseUrl
    : `${baseUrl}&start=${offset.toFixed(2)}${audio !== null ? `&audio=${audio}` : ""}`;
  const duration = seekable ? (mediaDuration ?? info.duration) : info.duration;

  // Keep a ref of the latest position for unmount reporting.
  const latest = useRef({ current, duration });
  latest.current = { current, duration };

  const report = useCallback(
    (beacon = false) => {
      const { current: pos, duration: dur } = latest.current;
      if (pos < 1) return;
      reportProgress({ file_id: info.file_id, position: pos, duration: dur, session_id: info.session_id }, beacon);
    },
    [info.file_id, info.session_id],
  );

  // Periodic progress while playing, plus on leave.
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => report(), 10_000);
    return () => window.clearInterval(t);
  }, [playing, report]);

  useEffect(() => {
    const onLeave = () => report(true);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      report(true);
    };
  }, [report]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    if (!resumedNote) return;
    const t = setTimeout(() => setResumedNote(false), 6000);
    return () => clearTimeout(t);
  }, [resumedNote]);

  const showControls = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      const max = duration ?? Infinity;
      const target = Math.max(0, Math.min(t, max - 1));
      setCurrent(target);
      if (seekable) {
        v.currentTime = target;
      } else {
        setBuffering(true);
        setOffset(target);
      }
    },
    [duration, seekable],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current?.requestFullscreen().catch(() => {});
  }, []);

  const goNext = useCallback(() => {
    if (!info.next) return;
    report();
    navigate(`/watch/${info.next.file_id}`, { replace: true });
  }, [info.next, navigate, report]);

  const goBack = () => {
    report();
    navigate(`/title/${info.media.id}`);
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(current - 10);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(current + 10);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((x) => Math.min(1, x + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((x) => Math.max(0, x - 0.1));
          break;
        case "m":
          setMuted((m) => !m);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "n":
          goNext();
          break;
        default:
          return;
      }
      showControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, goNext, seek, showControls, toggleFullscreen, togglePlay]);

  // Up next.
  const remaining = duration ? duration - current : Infinity;
  const showUpNext = !!info.next && !upNextDismissed && started && remaining < 30;
  useEffect(() => {
    if (!showUpNext) {
      setCountdown(10);
      return;
    }
    if (countdown <= 0) {
      goNext();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [showUpNext, countdown, goNext]);

  const onTimeUpdate = () => {
    const v = videoRef.current!;
    const pos = seekable ? v.currentTime : offset + v.currentTime;
    setCurrent(pos);
    if (v.buffered.length) {
      const end = v.buffered.end(v.buffered.length - 1);
      setBuffered(seekable ? end : offset + end);
    }
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    if (Number.isFinite(v.duration)) setMediaDuration(v.duration);
    if (seekable && validResume && !started) v.currentTime = info.resume_at;
  };

  const onError = () => {
    const v = videoRef.current;
    const code = v?.error?.code;
    setBuffering(false);
    setError(
      code === 4
        ? "This browser can't play this file."
        : code === 3
          ? "The video couldn't be decoded."
          : "Playback failed. The torrent may have no peers right now.",
    );
  };

  const subtitleOptions = useMemo(
    () => [
      { value: "off", label: "Off" },
      ...info.subtitles.map((s) => ({ value: String(s.file_id), label: s.label, hint: s.language ?? undefined })),
    ],
    [info.subtitles],
  );

  const audioOptions = info.audio_tracks.map((a) => ({
    value: String(a.index),
    label: a.title || (a.language ? a.language.toUpperCase() : `Track ${a.index + 1}`),
    hint: [a.codec?.toUpperCase(), a.channels ? `${a.channels}ch` : null].filter(Boolean).join(" · "),
  }));
  const currentAudio = String(audio ?? info.audio_tracks.find((a) => a.default)?.index ?? 0);

  const changeAudio = (value: string) => {
    const idx = Number(value);
    if (seekable) {
      // Switching audio needs the remux path.
      setCompat(true);
    }
    setOffset(current);
    setAudio(idx);
    setBuffering(true);
  };

  const changeSubtitle = (value: string) => {
    setSubtitle(value);
    const lang = info.subtitles.find((s) => String(s.file_id) === value)?.language ?? "off";
    storage.set(SUBS_KEY, value === "off" ? "off" : lang);
  };

  const heading = info.episode
    ? `${episodeCode(info.episode.season_number, info.episode.episode_numbers)}${info.episode.name ? ` · ${info.episode.name}` : ""}`
    : info.media.year
      ? String(info.media.year)
      : null;

  const VolumeIcon = muted || volume === 0 ? SpeakerXMarkIcon : SpeakerWaveIcon;

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onClick={showControls}
      className={clsx("fixed inset-0 bg-black text-white select-none", !controls && playing && "cursor-none")}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay
        playsInline
        preload="auto"
        className="size-full"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          setControls(true);
          report();
        }}
        onPlaying={() => {
          setBuffering(false);
          setStarted(true);
          setError(null);
        }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={() => {
          report();
          if (info.next) goNext();
        }}
        onError={onError}
      />

      {cueText && (
        <div
          className={clsx(
            "pointer-events-none absolute inset-x-0 flex justify-center px-8 transition-[bottom] duration-200",
            controls ? "bottom-32" : "bottom-14",
          )}
        >
          <p className="max-w-4xl rounded bg-black/65 px-3 py-1 text-center text-xl leading-snug font-medium whitespace-pre-line sm:text-2xl">
            <CueText text={cueText} />
          </p>
        </div>
      )}

      <BufferingOverlay fileId={info.file_id} visible={buffering && !error} starting={!started} />

      {error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-6">
          <div className="max-w-md space-y-4 text-center">
            <p className="text-lg font-semibold">{error}</p>
            <p className="text-sm text-white/60">{info.reason}</p>
            <div className="flex justify-center gap-2">
              {info.mode === "direct" && !compat && (
                <button
                  onClick={() => {
                    setError(null);
                    setBuffering(true);
                    setOffset(current);
                    setCompat(true);
                  }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                >
                  Try compatibility mode
                </button>
              )}
              <button onClick={goBack} className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
                Go back
              </button>
            </div>
          </div>
        </div>
      )}

      {resumedNote && started && (
        <div className="absolute top-24 left-1/2 z-20 flex -translate-x-1/2 animate-rise items-center gap-3 rounded-full bg-black/80 py-1.5 pr-1.5 pl-4 text-sm backdrop-blur">
          Resumed from {formatClock(info.resume_at)}
          <button
            onClick={() => {
              setResumedNote(false);
              seek(0);
            }}
            className="rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"
          >
            Start over
          </button>
        </div>
      )}

      {showUpNext && info.next && (
        <UpNext next={info.next} countdown={countdown} onPlay={goNext} onDismiss={() => setUpNextDismissed(true)} />
      )}

      {/* Top bar */}
      <div
        className={clsx(
          "absolute inset-x-0 top-0 z-10 flex items-center gap-4 bg-gradient-to-b from-black/80 to-transparent px-4 pt-4 pb-12 transition-opacity duration-300 sm:px-8",
          controls ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button onClick={goBack} className={iconButton} aria-label="Back">
          <ArrowLeftIcon className="size-6" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{info.media.title}</p>
          {heading && <p className="truncate text-sm text-white/70">{heading}</p>}
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className={clsx(
          "absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-16 pb-4 transition-opacity duration-300 sm:px-8",
          controls ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <SeekBar current={current} duration={duration} buffered={buffered} onSeek={seek} />
          <span className="w-24 shrink-0 text-right text-sm text-white/80 tabular-nums">
            {duration ? `-${formatClock(Math.max(0, duration - current))}` : formatClock(current)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={togglePlay} className={iconButton} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon className="size-7" /> : <PlayIcon className="size-7" />}
          </button>
          <button onClick={() => seek(current - 10)} className={iconButton} aria-label="Back 10 seconds">
            <ArrowUturnLeftIcon className="size-6" />
          </button>
          <button onClick={() => seek(current + 10)} className={iconButton} aria-label="Forward 10 seconds">
            <ArrowUturnRightIcon className="size-6" />
          </button>
          <div className="group/vol flex items-center">
            <button onClick={() => setMuted((m) => !m)} className={iconButton} aria-label={muted ? "Unmute" : "Mute"}>
              <VolumeIcon className="size-6" />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setMuted(v === 0);
                storage.set(VOLUME_KEY, String(v));
              }}
              className="w-0 accent-primary opacity-0 transition-all duration-200 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:w-24 focus:opacity-100"
              aria-label="Volume"
            />
          </div>
          <span className="ml-2 hidden text-sm text-white/80 tabular-nums sm:block">
            {formatClock(current)}
            {duration ? ` / ${formatClock(duration)}` : ""}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {info.next && (
              <button onClick={goNext} className={iconButton} aria-label="Next episode" title="Next episode">
                <ForwardIcon className="size-6" />
              </button>
            )}
            {info.subtitles.length > 0 && (
              <TrackMenu
                icon={<ChatBubbleBottomCenterTextIcon className="size-6" />}
                label="Subtitles"
                title="Subtitles"
                value={subtitle}
                options={subtitleOptions}
                onChange={changeSubtitle}
              />
            )}
            {audioOptions.length > 1 && (
              <TrackMenu
                icon={<LanguageIcon className="size-6" />}
                label="Audio"
                title="Audio"
                value={currentAudio}
                options={audioOptions}
                onChange={changeAudio}
              />
            )}
            <Popover className="relative">
              <PopoverButton className={iconButton} aria-label="Stream info">
                <InformationCircleIcon className="size-6" />
              </PopoverButton>
              <PopoverPanel
                anchor="top end"
                transition
                className="z-50 mb-3 w-72 space-y-2 rounded-lg border border-white/10 bg-black/90 p-4 text-sm shadow-2xl backdrop-blur-md transition data-[closed]:opacity-0"
              >
                <p className="font-semibold capitalize">{mode === "direct" ? "Direct play" : mode}</p>
                <p className="text-xs text-white/60">
                  {compat && info.mode === "direct" ? "Compatibility mode (repackaged by the server)" : info.reason}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-white/50">File</dt>
                  <dd className="truncate" title={info.file.path}>
                    {info.file.path.split("/").pop()}
                  </dd>
                  <dt className="text-white/50">Video</dt>
                  <dd>{[info.file.resolution, info.file.video_codec?.toUpperCase()].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt className="text-white/50">Audio</dt>
                  <dd>{info.file.audio_codec?.toUpperCase() ?? "—"}</dd>
                  <dt className="text-white/50">Size</dt>
                  <dd>{formatBytes(info.file.size)}</dd>
                </dl>
              </PopoverPanel>
            </Popover>
            <button onClick={toggleFullscreen} className={iconButton} aria-label="Fullscreen">
              {fullscreen ? <ArrowsPointingInIcon className="size-6" /> : <ArrowsPointingOutIcon className="size-6" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
