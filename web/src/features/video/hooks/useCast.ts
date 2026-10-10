import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typing for the Google Cast sender SDK, loaded on demand. */
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
let loading: Promise<boolean> | null = null;

/** Cast needs Chrome (or Edge) and a secure origin (HTTPS or localhost). */
export const castSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && /Chrome|CriOS|Edg\//.test(navigator.userAgent);

const loadSdk = () => {
  if (!castSupported()) return Promise.resolve(false);
  loading ??= new Promise<boolean>((resolve) => {
    window.__onGCastApiAvailable = (ok) => {
      // The SDK can report availability without the framework (e.g. in
      // Chromium builds without Cast support).
      if (!ok || !window.cast?.framework || !window.chrome?.cast?.media) return resolve(false);
      try {
        window.cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    const script = document.createElement("script");
    script.src = SDK;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loading;
};

export type CastMedia = {
  url: string;
  contentType: string;
  title: string;
  subtitle?: string;
  image?: string;
  startTime: number;
  tracks: { id: number; url: string; label: string; language: string | null }[];
  activeTrack?: number | null;
};

type CastStatus = "unavailable" | "idle" | "connecting" | "connected";

export const useCast = () => {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<CastStatus>("unavailable");
  const [device, setDevice] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const player = useRef<any>(null);
  const controller = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    loadSdk().then((ok) => {
      if (!ok || cancelled) return;
      const cf = window.cast.framework;
      const ctx = cf.CastContext.getInstance();
      const update = () => {
        const state = ctx.getCastState();
        setStatus(
          state === cf.CastState.CONNECTED
            ? "connected"
            : state === cf.CastState.CONNECTING
              ? "connecting"
              : state === cf.CastState.NO_DEVICES_AVAILABLE
                ? "unavailable"
                : "idle",
        );
        setDevice(ctx.getCurrentSession()?.getCastDevice()?.friendlyName ?? null);
      };
      ctx.addEventListener(cf.CastContextEventType.CAST_STATE_CHANGED, update);
      player.current = new cf.RemotePlayer();
      controller.current = new cf.RemotePlayerController(player.current);
      controller.current.addEventListener(cf.RemotePlayerEventType.CURRENT_TIME_CHANGED, () =>
        setTime(player.current.currentTime),
      );
      controller.current.addEventListener(cf.RemotePlayerEventType.IS_PAUSED_CHANGED, () =>
        setPaused(player.current.isPaused),
      );
      update();
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Pick a device (if needed) and start playing `media` on it. */
  const start = useCallback(async (media: CastMedia) => {
    const cf = window.cast.framework;
    const cm = window.chrome.cast.media;
    const ctx = cf.CastContext.getInstance();
    if (!ctx.getCurrentSession()) await ctx.requestSession();
    const session = ctx.getCurrentSession();
    if (!session) return;

    const info = new cm.MediaInfo(media.url, media.contentType);
    info.streamType = cm.StreamType.BUFFERED;
    const meta = new cm.GenericMediaMetadata();
    meta.title = media.title;
    if (media.subtitle) meta.subtitle = media.subtitle;
    if (media.image) meta.images = [new window.chrome.cast.Image(media.image)];
    info.metadata = meta;
    info.tracks = media.tracks.map((t) => {
      const track = new cm.Track(t.id, cm.TrackType.TEXT);
      track.trackContentId = t.url;
      track.trackContentType = "text/vtt";
      track.subtype = cm.TextTrackType.SUBTITLES;
      track.name = t.label;
      track.language = t.language ?? undefined;
      return track;
    });

    const request = new cm.LoadRequest(info);
    request.currentTime = media.startTime;
    request.autoplay = true;
    if (media.activeTrack != null) request.activeTrackIds = [media.activeTrack];
    await session.loadMedia(request);
  }, []);

  const stop = useCallback(() => {
    window.cast?.framework.CastContext.getInstance().endCurrentSession(true);
  }, []);

  const playOrPause = useCallback(() => controller.current?.playOrPause(), []);

  const seek = useCallback((t: number) => {
    if (!player.current || !controller.current) return;
    player.current.currentTime = t;
    controller.current.seek();
  }, []);

  return { ready, status, device, time, paused, start, stop, playOrPause, seek };
};
