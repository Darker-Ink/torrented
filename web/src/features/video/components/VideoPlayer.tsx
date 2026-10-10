import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import { episodeCode, formatBytes, formatClock } from "@/lib/format";
import { img } from "@/lib/images";
import { normalizeLang, storage } from "@/lib/storage";
import type { PlayInfo, SubtitleOption } from "@/lib/types";
import { titleUrl, watchUrl } from "@/lib/urls";
import { castSupported, useCast } from "../hooks/useCast";
import { reportProgress } from "../hooks/usePlayback";
import { useSubtitles } from "../hooks/useSubtitles";
import BufferingOverlay from "./BufferingOverlay";
import ContextMenu, { type ContextItem } from "./ContextMenu";
import CueText from "./CueText";
import {
  BackGlyph,
  CaptionsGlyph,
  CastGlyph,
  CollapseGlyph,
  ExpandGlyph,
  NextGlyph,
  PauseGlyph,
  PipGlyph,
  PlayGlyph,
  SkipBackGlyph,
  SkipForwardGlyph,
  VolumeGlyph,
} from "./PlayerIcons";
import SeekBar from "./SeekBar";
import SettingsMenu, { type SettingsPage, type SettingsToggle } from "./SettingsMenu";
import ShortcutsDialog from "./ShortcutsDialog";
import StatsOverlay from "./StatsOverlay";
import { controlButton } from "./styles";
import UpNext from "./UpNext";

type Props = { info: PlayInfo; startAt?: number | null };

const KEYS = {
  volume: "torrented.volume",
  subtitles: "torrented.subtitles",
  subtitleSize: "torrented.subtitleSize",
  subtitleStyle: "torrented.subtitleStyle",
  autoplay: "torrented.autoplay",
  speed: "torrented.speed",
  remaining: "torrented.showRemaining",
};

type SubtitlePref = { language: string | null; label: string; embedded: boolean };

/** Pick the remembered subtitle track for a file: same language first, then
 * the same label, then any track of the same kind. */
const pickSubtitle = (tracks: SubtitleOption[]): string => {
  const raw = storage.get(KEYS.subtitles);
  if (!raw || raw === "off") return "off";
  let pref: SubtitlePref;
  try {
    pref = JSON.parse(raw);
  } catch {
    pref = { language: raw, label: "", embedded: false }; // older plain-language value
  }
  const lang = normalizeLang(pref.language);
  const match =
    (lang && tracks.find((t) => normalizeLang(t.language) === lang)) ||
    tracks.find((t) => t.label === pref.label) ||
    (!lang ? tracks.find((t) => t.embedded === pref.embedded) : undefined);
  return match?.id ?? "off";
};

const rememberSubtitle = (track: SubtitleOption | null) =>
  storage.set(
    KEYS.subtitles,
    track ? JSON.stringify({ language: track.language, label: track.label, embedded: track.embedded }) : "off",
  );

/** Start of the first fragment of a remuxed stream asked to begin at `t`. */
const resolveStart = async (fileId: number, streamUrl: string, t: number) => {
  if (t <= 0) return 0;
  const params = new URLSearchParams(streamUrl.split("?")[1] ?? "");
  const query = new URLSearchParams({ t: t.toFixed(3) });
  for (const k of ["hevc", "ac3", "token"]) {
    const v = params.get(k);
    if (v) query.set(k, v);
  }
  try {
    const res = await api.get<{ start: number }>(`/stream/${fileId}/seek-point?${query}`);
    return Number.isFinite(res.start) ? res.start : t;
  } catch {
    return t;
  }
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const SUBTITLE_SIZES: Record<string, string> = {
  small: "text-base sm:text-xl",
  medium: "text-xl sm:text-[28px]",
  large: "text-2xl sm:text-[36px]",
  huge: "text-3xl sm:text-[46px]",
};

type Flash = { kind: "play" | "pause" | "back" | "forward"; key: number };

const VideoPlayer = ({ info: original, startAt }: Props) => {
  // A ?t= in the link overrides the saved position.
  const fromLink = !!startAt && startAt > 0;
  const info = useMemo(() => (fromLink ? { ...original, resume_at: startAt! } : original), [original, startAt, fromLink]);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const [compat, setCompat] = useState(false);
  const mode = compat && info.mode === "direct" ? "remux" : info.mode;
  const seekable = mode === "direct";
  const baseUrl = compat && info.mode === "direct" ? `/api/stream/${info.file_id}/transcode?sid=${info.session_id}` : info.url;

  const validResume = info.resume_at > 10 && (!info.duration || info.resume_at < info.duration * 0.95);
  // Remuxed streams can't seek; they restart at `startAt`. The stream really
  // begins on the keyframe before it, which becomes `offset` once known.
  const [startReq, setStartReq] = useState(() => ({ at: info.mode !== "direct" && validResume ? info.resume_at : 0, n: 0 }));
  const [offset, setOffset] = useState<number | null>(null);
  const restartAt = useCallback((at: number) => setStartReq((r) => ({ at, n: r.n + 1 })), []);
  const [audio, setAudio] = useState<number | null>(null);
  const [current, setCurrent] = useState(validResume ? info.resume_at : 0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => Number(storage.get(KEYS.volume) ?? 1));
  const [muted, setMuted] = useState(false);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [resumedNote, setResumedNote] = useState(validResume);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [showRemaining, setShowRemaining] = useState(() => storage.get(KEYS.remaining) !== "false");
  const [speed, setSpeed] = useState(() => Number(storage.get(KEYS.speed)) || 1);
  const [loop, setLoop] = useState(false);
  const [stats, setStats] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [pip, setPip] = useState(false);
  const [autoplay, setAutoplay] = useState(() => storage.get(KEYS.autoplay) !== "false");
  const [subSize, setSubSize] = useState(() => storage.get(KEYS.subtitleSize) ?? "medium");
  const [subStyle, setSubStyle] = useState(() => storage.get(KEYS.subtitleStyle) ?? "box");
  const pulse = (kind: Flash["kind"]) => setFlash({ kind, key: Date.now() });

  // Subtitles: pick the remembered language, external files first.
  const [subtitle, setSubtitle] = useState<string>(() => pickSubtitle(info.subtitles));

  // The player stays mounted from one episode to the next so fullscreen,
  // picture-in-picture and settings carry over. Only per-file state resets.
  const [sessionId, setSessionId] = useState(info.session_id);
  if (sessionId !== info.session_id) {
    setSessionId(info.session_id);
    setCompat(false);
    setStartReq((r) => ({ at: info.mode !== "direct" && validResume ? info.resume_at : 0, n: r.n + 1 }));
    setOffset(null);
    setAudio(null);
    setCurrent(validResume ? info.resume_at : 0);
    setMediaDuration(null);
    setBuffered(0);
    setBuffering(true);
    setStarted(false);
    setError(null);
    setResumedNote(validResume);
    setUpNextDismissed(false);
    setCountdown(10);
    setMenuAt(null);
    setSubtitle(pickSubtitle(info.subtitles));
  }
  const lastSubtitle = useRef<string | null>(subtitle !== "off" ? subtitle : null);
  const activeTrack = info.subtitles.find((s) => s.id === subtitle) ?? null;
  const cueText = useSubtitles(activeTrack, current);

  useEffect(() => {
    if (seekable) return;
    let stale = false;
    setOffset(null);
    resolveStart(info.file_id, baseUrl, startReq.at).then((k) => {
      if (stale) return;
      setOffset(k);
      setCurrent(k);
    });
    return () => {
      stale = true;
    };
  }, [seekable, startReq, info.file_id, baseUrl]);

  const src = seekable
    ? baseUrl
    : offset === null
      ? undefined
      : `${baseUrl}&start=${offset.toFixed(3)}${audio !== null ? `&audio=${audio}` : ""}`;
  const duration = seekable ? (mediaDuration ?? info.duration) : info.duration;

  // ---- Casting -------------------------------------------------------------
  const cast = useCast();
  const casting = cast.status === "connected";
  const castOffset = useRef(0);
  const castTime = castOffset.current + cast.time;
  const shownTime = casting ? castTime : current;

  // Keep a ref of the latest position for unmount reporting.
  const latest = useRef({ current: shownTime, duration, fileId: info.file_id, sessionId: info.session_id });
  latest.current = { current: shownTime, duration, fileId: info.file_id, sessionId: info.session_id };

  const report = useCallback((beacon = false) => {
    const { current: pos, duration: dur, fileId, sessionId: sid } = latest.current;
    if (pos < 1) return;
    reportProgress({ file_id: fileId, position: pos, duration: dur, session_id: sid }, beacon);
  }, []);

  useEffect(() => {
    if (!playing && !(casting && !cast.paused)) return;
    const t = window.setInterval(() => report(), 10_000);
    return () => window.clearInterval(t);
  }, [playing, casting, cast.paused, report]);

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
    if (videoRef.current) videoRef.current.playbackRate = speed;
    storage.set(KEYS.speed, String(speed));
  }, [speed]);

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

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const enter = () => setPip(true);
    const leave = () => setPip(false);
    v.addEventListener("enterpictureinpicture", enter);
    v.addEventListener("leavepictureinpicture", leave);
    return () => {
      v.removeEventListener("enterpictureinpicture", enter);
      v.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  // Local playback pauses while a cast device is playing.
  useEffect(() => {
    if (casting) videoRef.current?.pause();
  }, [casting]);

  const togglePlay = useCallback(() => {
    if (casting) {
      cast.playOrPause();
      pulse(cast.paused ? "play" : "pause");
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      pulse("play");
    } else {
      v.pause();
      pulse("pause");
    }
  }, [casting, cast]);

  const castUrl = useCallback(
    async (start: number) => {
      const { token } = await api.post<{ token: string }>(`/play/${info.file_id}/cast`);
      const origin = window.location.origin;
      const direct = mode === "direct";
      const at = direct ? start : await resolveStart(info.file_id, `?token=${token}`, start);
      const url = direct
        ? `${origin}/api/stream/${info.file_id}?token=${token}`
        : `${origin}/api/stream/${info.file_id}/transcode?token=${token}&start=${at.toFixed(3)}`;
      const ext = info.file.path.split(".").pop()?.toLowerCase();
      return {
        token,
        url,
        contentType: !direct ? "video/mp4" : ext === "webm" ? "video/webm" : "video/mp4",
        startTime: direct ? start : 0,
        offset: direct ? 0 : at,
      };
    },
    [info.file_id, info.file.path, mode],
  );

  const seek = useCallback(
    (t: number) => {
      const max = duration ?? Infinity;
      const target = Math.max(0, Math.min(t, max - 1));
      if (casting) {
        if (mode === "direct") {
          cast.seek(target);
        } else {
          // Remuxed streams restart on the device at the new position.
          castUrl(target).then((m) => {
            castOffset.current = m.offset;
            return cast.start({ ...m, title: info.media.title, tracks: [], startTime: 0 });
          });
        }
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      setCurrent(target);
      if (seekable) {
        v.currentTime = target;
      } else {
        setBuffering(true);
        restartAt(target);
      }
    },
    [duration, seekable, casting, mode, cast, castUrl, info.media.title, restartAt],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current?.requestFullscreen().catch(() => {});
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, []);

  const toggleCaptions = useCallback(() => {
    if (subtitle !== "off") {
      lastSubtitle.current = subtitle;
      setSubtitle("off");
      rememberSubtitle(null);
    } else {
      const last = info.subtitles.find((s) => s.id === lastSubtitle.current);
      const next = last ?? info.subtitles[0];
      if (next) {
        setSubtitle(next.id);
        rememberSubtitle(next);
      }
    }
  }, [subtitle, info.subtitles]);

  const goNext = useCallback(() => {
    if (!info.next) return;
    report();
    navigate(
      watchUrl(info.media, {
        season: info.next.season_number,
        episode: info.next.episode_number,
        version: info.info_hash,
      }),
      { replace: true },
    );
  }, [info.next, info.media, info.info_hash, navigate, report]);

  // Media Session: OS media keys, lock screen controls, and the clock shown in
  // picture-in-picture. A remuxed stream's own timeline starts at the seek
  // point, so the real position and duration are reported here.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const ep = info.episode;
    const poster = img(info.media.poster_path, "w342");
    ms.metadata = new MediaMetadata({
      title: ep ? (ep.name ?? episodeCode(ep.season_number, ep.episode_numbers)) : info.media.title,
      artist: ep ? `${info.media.title} · ${episodeCode(ep.season_number, ep.episode_numbers)}` : undefined,
      artwork: poster ? [{ src: poster, sizes: "342x513", type: "image/jpeg" }] : [],
    });
  }, [info.episode, info.media.title, info.media.poster_path]);

  const sessionActions = useRef({ togglePlay, seek, goNext, time: shownTime });
  sessionActions.current = { togglePlay, seek, goNext, time: shownTime };
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    const a = () => sessionActions.current;
    set("play", () => videoRef.current?.paused && a().togglePlay());
    set("pause", () => !videoRef.current?.paused && a().togglePlay());
    set("seekbackward", (d) => a().seek(a().time - (d.seekOffset ?? 10)));
    set("seekforward", (d) => a().seek(a().time + (d.seekOffset ?? 10)));
    set("seekto", (d) => d.seekTime !== undefined && a().seek(d.seekTime));
    set("nexttrack", info.next ? () => a().goNext() : null);
    return () => {
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto", "nexttrack"] as const) set(action, null);
    };
  }, [info.next]);

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState || !duration || !Number.isFinite(duration)) return;
    try {
      ms.setPositionState({ duration, position: Math.min(Math.max(0, shownTime), duration), playbackRate: speed });
    } catch {
      /* ignore invalid states */
    }
  }, [shownTime, duration, speed]);

  const goBack = () => {
    report();
    navigate(titleUrl(info.media));
  };

  const shareUrl = (withTime: boolean) =>
    window.location.origin +
    watchUrl(info.media, {
      season: info.episode?.season_number,
      episode: info.episode?.episode_numbers[0],
      version: info.versions.length > 1 ? info.info_hash : null,
      t: withTime ? shownTime : null,
    });

  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${what} copied`))
      .catch(() => toast.info(text));

  const startCasting = async () => {
    const host = window.location.hostname;
    if (host === "localhost" || host.startsWith("127.")) {
      toast.error("Open torrented by its network address (not localhost) so the cast device can reach it.");
      return;
    }
    try {
      const m = await castUrl(shownTime);
      castOffset.current = m.offset;
      const files = info.subtitles.filter((s) => !s.embedded);
      await cast.start({
        ...m,
        title: info.episode ? (info.episode.name ?? info.media.title) : info.media.title,
        subtitle: info.episode
          ? `${info.media.title} · ${episodeCode(info.episode.season_number, info.episode.episode_numbers)}`
          : undefined,
        image: img(info.media.backdrop_path, "w1280"),
        tracks: files.map((s, i) => ({
          id: i + 1,
          url: `${window.location.origin}${s.url}?token=${m.token}`,
          label: s.label,
          language: s.language,
        })),
        activeTrack: (() => {
          const i = files.findIndex((s) => s.id === subtitle);
          return i === -1 ? null : i + 1;
        })(),
      });
    } catch (err) {
      if (err) toast.error(typeof err === "string" ? "Casting was cancelled" : errorMessage(err));
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (/^[0-9]$/.test(key) && duration) {
        seek((Number(key) / 10) * duration);
      } else if (key === " " || key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (key === "ArrowLeft" || key === "j") {
        e.preventDefault();
        seek(shownTime - 10);
        pulse("back");
      } else if (key === "ArrowRight" || key === "l") {
        e.preventDefault();
        seek(shownTime + 10);
        pulse("forward");
      } else if (key === "ArrowUp") {
        e.preventDefault();
        setVolume((x) => Math.min(1, x + 0.1));
      } else if (key === "ArrowDown") {
        e.preventDefault();
        setVolume((x) => Math.max(0, x - 0.1));
      } else if (key === "m") setMuted((m) => !m);
      else if (key === "f") toggleFullscreen();
      else if (key === "n") goNext();
      else if (key === "c") toggleCaptions();
      else if (key === "p") togglePip();
      else if (key === "i") setStats((s) => !s);
      else if (key === "?") setShortcuts(true);
      else if (key === ">") setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)] ?? s);
      else if (key === "<") setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)] ?? s);
      else return;
      showControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shownTime, duration, goNext, seek, showControls, toggleFullscreen, togglePlay, toggleCaptions, togglePip]);

  // Up next.
  const remaining = duration ? duration - shownTime : Infinity;
  const showUpNext = autoplay && !!info.next && !upNextDismissed && started && remaining < 30 && !loop;
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
    if (!seekable && offset === null) return;
    const base = seekable ? 0 : (offset ?? 0);
    setCurrent(base + v.currentTime);
    if (v.buffered.length) setBuffered(base + v.buffered.end(v.buffered.length - 1));
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    v.playbackRate = speed;
    if (Number.isFinite(v.duration)) setMediaDuration(v.duration);
    if (seekable && validResume && !started) v.currentTime = info.resume_at;
  };

  const onEnded = () => {
    report();
    if (loop) seek(0);
    else if (info.next && autoplay) goNext();
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

  const changeAudio = (value: string) => {
    if (seekable) setCompat(true); // switching audio needs the remux path
    restartAt(current);
    setAudio(Number(value));
    setBuffering(true);
  };

  const changeSubtitle = (value: string) => {
    setSubtitle(value);
    if (value !== "off") lastSubtitle.current = value;
    rememberSubtitle(info.subtitles.find((s) => s.id === value) ?? null);
  };

  const changeVersion = (infoHash: string) => {
    if (infoHash === info.info_hash) return;
    report();
    navigate(
      watchUrl(info.media, {
        season: info.episode?.season_number,
        episode: info.episode?.episode_numbers[0],
        version: infoHash,
        t: shownTime,
      }),
      { replace: true },
    );
  };

  // ---- Menus ---------------------------------------------------------------
  const pages: SettingsPage[] = [
    {
      key: "speed",
      label: "Playback speed",
      value: String(speed),
      choices: SPEEDS.map((s) => ({ value: String(s), label: s === 1 ? "Normal" : `${s}×` })),
      onChange: (v) => setSpeed(Number(v)),
    },
  ];
  if (info.subtitles.length > 0) {
    pages.push(
      {
        key: "subtitles",
        label: "Subtitles",
        value: subtitle,
        choices: [
          { value: "off", label: "Off" },
          ...info.subtitles.map((s) => ({
            value: s.id,
            label: s.label,
            hint: s.embedded ? "In the video file" : "Subtitle file",
          })),
        ],
        onChange: changeSubtitle,
      },
      {
        key: "subtitle-size",
        label: "Subtitle size",
        value: subSize,
        choices: [
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
          { value: "huge", label: "Extra large" },
        ],
        onChange: (v) => {
          setSubSize(v);
          storage.set(KEYS.subtitleSize, v);
        },
      },
      {
        key: "subtitle-style",
        label: "Subtitle style",
        value: subStyle,
        choices: [
          { value: "box", label: "Dark box" },
          { value: "outline", label: "Outline only" },
        ],
        onChange: (v) => {
          setSubStyle(v);
          storage.set(KEYS.subtitleStyle, v);
        },
      },
    );
  }
  if (info.audio_tracks.length > 1) {
    pages.push({
      key: "audio",
      label: "Audio",
      value: String(audio ?? info.audio_tracks.find((a) => a.default)?.index ?? 0),
      choices: info.audio_tracks.map((a) => ({
        value: String(a.index),
        label: a.title || (a.language ? a.language.toUpperCase() : `Track ${a.index + 1}`),
        hint: [a.codec?.toUpperCase(), a.channels ? `${a.channels} channels` : null].filter(Boolean).join(" · "),
      })),
      onChange: changeAudio,
    });
  }
  if (info.versions.length > 1) {
    pages.push({
      key: "version",
      label: "Version",
      value: info.info_hash,
      choices: info.versions.map((v) => ({
        value: v.info_hash,
        label: v.label || "Video",
        hint: `${formatBytes(v.size)} · ${v.torrent_name}`,
      })),
      onChange: changeVersion,
    });
  }
  const toggles: SettingsToggle[] = [];
  if (info.episode) {
    toggles.push({
      key: "autoplay",
      label: "Autoplay next episode",
      checked: autoplay,
      onChange: (v) => {
        setAutoplay(v);
        storage.set(KEYS.autoplay, String(v));
      },
    });
  }
  toggles.push({ key: "stats", label: "Stats for nerds", checked: stats, onChange: setStats });

  const contextItems: ContextItem[] = [
    { key: "loop", label: "Loop", checked: loop, onSelect: () => setLoop((l) => !l) },
    { key: "copy", label: "Copy video link", onSelect: () => copy(shareUrl(false), "Link") },
    { key: "copy-time", label: "Copy video link at current time", onSelect: () => copy(shareUrl(true), "Link") },
    ...(document.pictureInPictureEnabled
      ? [{ key: "pip", label: "Picture-in-picture", hint: "P", checked: pip, onSelect: togglePip }]
      : []),
    { key: "stats", label: "Stats for nerds", hint: "I", checked: stats, onSelect: () => setStats((s) => !s) },
    { key: "keys", label: "Keyboard shortcuts", hint: "?", onSelect: () => setShortcuts(true) },
  ];

  const level = muted ? 0 : volume;
  const titleLine = info.episode ? (info.episode.name ?? `Episode ${info.episode.episode_numbers[0]}`) : info.media.title;
  const eyebrow = info.episode
    ? `${info.media.title} · ${episodeCode(info.episode.season_number, info.episode.episode_numbers)}`
    : [info.media.year, info.file.resolution].filter(Boolean).join(" · ");
  const modeLabel = mode === "direct" ? "Direct play" : mode === "remux" ? "Remux" : "Transcode";
  const isPlaying = casting ? !cast.paused : playing;
  const bufferAhead = Math.max(0, buffered - current);

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onClick={showControls}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
      className={clsx("fixed inset-0 bg-black text-white select-none", !controls && isPlaying && "cursor-none")}
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
        onPlay={() => {
          setPlaying(true);
          showControls(); // restarts the hide timer, e.g. after autoplaying the next episode
        }}
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
        onEnded={onEnded}
        onError={onError}
      />

      {casting && (
        <div className="absolute inset-0 z-[5] grid place-items-center bg-black/80">
          {info.media.backdrop_path && (
            <img src={img(info.media.backdrop_path, "w1280")} alt="" className="absolute inset-0 size-full object-cover opacity-25 blur-sm" />
          )}
          <div className="relative space-y-4 text-center">
            <CastGlyph connected className="mx-auto size-14 text-primary" />
            <p className="text-lg font-semibold">Playing on {cast.device ?? "your TV"}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                cast.stop();
              }}
              className="rounded-full bg-white/10 px-5 py-2 text-sm font-semibold ring-1 ring-white/20 hover:bg-white/20"
            >
              Stop casting
            </button>
          </div>
        </div>
      )}

      {cueText && !casting && (
        <div
          className={clsx(
            "pointer-events-none absolute inset-x-0 flex justify-center px-8 transition-[bottom] duration-200",
            controls ? "bottom-48" : "bottom-14",
          )}
        >
          <p
            className={clsx(
              "max-w-4xl text-center leading-snug font-semibold whitespace-pre-line",
              SUBTITLE_SIZES[subSize] ?? SUBTITLE_SIZES.medium,
              subStyle === "box"
                ? "rounded-lg bg-black/60 px-4 py-1.5 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]"
                : "[text-shadow:0_0_3px_#000,0_0_3px_#000,0_2px_4px_#000,0_0_8px_#000]",
            )}
          >
            <CueText text={cueText} />
          </p>
        </div>
      )}

      <BufferingOverlay fileId={info.file_id} visible={buffering && !error && !casting} starting={!started} />

      {!playing && !buffering && !error && !casting && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute top-1/2 left-1/2 z-10 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-md transition hover:scale-105 hover:bg-white/25"
        >
          <PlayGlyph className="ml-1.5 size-12" />
        </button>
      )}

      {error && !casting && (
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
                    restartAt(current);
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

      {flash && (
        <div
          key={flash.key}
          className="pointer-events-none absolute top-1/2 left-1/2 z-10 grid size-24 animate-flash place-items-center rounded-full bg-black/45 backdrop-blur-sm"
        >
          {flash.kind === "play" && <PlayGlyph className="ml-1 size-11" />}
          {flash.kind === "pause" && <PauseGlyph className="size-11" />}
          {flash.kind === "back" && <SkipBackGlyph className="size-11" />}
          {flash.kind === "forward" && <SkipForwardGlyph className="size-11" />}
        </div>
      )}

      {resumedNote && started && (
        <div className="absolute top-24 left-1/2 z-20 flex -translate-x-1/2 animate-rise items-center gap-3 rounded-full border border-white/10 bg-neutral-950/80 py-1.5 pr-1.5 pl-4 text-sm shadow-xl backdrop-blur-xl">
          {fromLink ? "Starting at" : "Resumed from"} {formatClock(info.resume_at)}
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

      {stats && <StatsOverlay info={info} mode={mode} video={videoRef} bufferAhead={bufferAhead} position={shownTime} onClose={() => setStats(false)} />}

      {showUpNext && info.next && (
        <UpNext next={info.next} countdown={countdown} onPlay={goNext} onDismiss={() => setUpNextDismissed(true)} />
      )}

      {/* Top bar */}
      <div
        className={clsx(
          "absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pt-5 pb-16 transition-opacity duration-300 sm:px-10",
          controls ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 rounded-full py-2 pr-4 pl-2 text-sm font-semibold text-white/85 transition hover:bg-white/10 hover:text-white"
        >
          <BackGlyph className="size-6" />
          Back
        </button>
        <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur">
          {modeLabel}
          {info.file.resolution ? ` · ${info.file.resolution}` : ""}
          {speed !== 1 ? ` · ${speed}×` : ""}
        </span>
      </div>

      {/* Bottom controls */}
      <div
        className={clsx(
          "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pt-24 pb-5 transition-opacity duration-300 sm:px-10 sm:pb-7",
          controls ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 min-w-0">
          {eyebrow && <p className="truncate text-sm font-medium text-white/60">{eyebrow}</p>}
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{titleLine}</h1>
        </div>

        <div className="flex items-center gap-4">
          <span className="w-14 text-sm font-medium text-white/80 tabular-nums">{formatClock(shownTime)}</span>
          <SeekBar current={shownTime} duration={duration} buffered={casting ? 0 : buffered} onSeek={seek} />
          <button
            onClick={() =>
              setShowRemaining((r) => {
                storage.set(KEYS.remaining, String(!r));
                return !r;
              })
            }
            className="w-16 text-right text-sm font-medium text-white/80 tabular-nums hover:text-white"
            title="Toggle remaining time"
          >
            {duration ? (showRemaining ? `-${formatClock(Math.max(0, duration - shownTime))}` : formatClock(duration)) : "--:--"}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={togglePlay} className={clsx(controlButton, "size-12")} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <PauseGlyph className="size-8" /> : <PlayGlyph className="size-8" />}
            </button>
            <button
              onClick={() => {
                seek(shownTime - 10);
                pulse("back");
              }}
              className={controlButton}
              aria-label="Back 10 seconds"
            >
              <SkipBackGlyph className="size-7" />
            </button>
            <button
              onClick={() => {
                seek(shownTime + 10);
                pulse("forward");
              }}
              className={controlButton}
              aria-label="Forward 10 seconds"
            >
              <SkipForwardGlyph className="size-7" />
            </button>
            <div className="group/vol flex items-center">
              <button onClick={() => setMuted((m) => !m)} className={controlButton} aria-label={muted ? "Unmute" : "Mute"}>
                <VolumeGlyph level={level} className="size-7" />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={level}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  setMuted(v === 0);
                  storage.set(KEYS.volume, String(v));
                }}
                style={{ background: `linear-gradient(to right, white ${level * 100}%, rgb(255 255 255 / 0.25) ${level * 100}%)` }}
                className="range-slim w-0 opacity-0 transition-all duration-200 group-hover/vol:ml-1 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:ml-1 focus:w-24 focus:opacity-100"
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {info.next && (
              <button
                onClick={goNext}
                className="mr-1 hidden h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white/85 ring-1 ring-white/20 transition hover:bg-white hover:text-black sm:flex"
              >
                <NextGlyph className="size-5" />
                Next episode
              </button>
            )}
            {info.next && (
              <button onClick={goNext} className={clsx(controlButton, "sm:hidden")} aria-label="Next episode">
                <NextGlyph className="size-7" />
              </button>
            )}
            {info.subtitles.length > 0 && (
              <button
                onClick={toggleCaptions}
                className={clsx(controlButton, subtitle !== "off" && "text-white")}
                aria-label={subtitle !== "off" ? "Turn captions off" : "Turn captions on"}
                aria-pressed={subtitle !== "off"}
                title="Captions (C)"
              >
                <CaptionsGlyph on={subtitle !== "off"} className="size-7" />
              </button>
            )}
            <SettingsMenu pages={pages} toggles={toggles} />
            {document.pictureInPictureEnabled && (
              <button
                onClick={togglePip}
                className={clsx(controlButton, pip && "text-primary")}
                aria-label="Picture-in-picture"
                title="Picture-in-picture (P)"
              >
                <PipGlyph className="size-7" />
              </button>
            )}
            {castSupported() && cast.status !== "unavailable" && (
              <button
                onClick={() => (casting ? cast.stop() : startCasting())}
                className={clsx(controlButton, casting && "text-primary")}
                aria-label={casting ? "Stop casting" : "Cast"}
                title={casting ? `Casting to ${cast.device}` : "Cast to a device"}
              >
                <CastGlyph connected={casting} className="size-7" />
              </button>
            )}
            <button onClick={toggleFullscreen} className={controlButton} aria-label="Fullscreen" title="Fullscreen (F)">
              {fullscreen ? <CollapseGlyph className="size-7" /> : <ExpandGlyph className="size-7" />}
            </button>
          </div>
        </div>
      </div>

      <ContextMenu at={menuAt} items={contextItems} onClose={() => setMenuAt(null)} />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
};

export default VideoPlayer;
