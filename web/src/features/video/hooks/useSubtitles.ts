import { useEffect, useRef, useState } from "react";
import type { SubtitleOption } from "@/lib/types";

export type Cue = { start: number; end: number; text: string };

const CHUNK = 120;
const PREFETCH = 30;

const toSeconds = (t: string) => {
  const parts = t.trim().replace(",", ".").split(":");
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
};

const stripTags = (s: string) => s.replace(/<\/?(?!i>|b>|u>)[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "");

export const parseVtt = (text: string): Cue[] => {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i === -1) continue;
    const [a, b] = lines[i].split("-->");
    const end = b.trim().split(/\s+/)[0];
    const body = lines.slice(i + 1).join("\n").trim();
    if (!body) continue;
    cues.push({ start: toSeconds(a), end: toSeconds(end), text: stripTags(body) });
  }
  return cues;
};

const merge = (current: Cue[], incoming: Cue[]) => {
  const seen = new Set(current.map((c) => `${c.start}|${c.text}`));
  const added = incoming.filter((c) => !seen.has(`${c.start}|${c.text}`));
  return added.length ? [...current, ...added].sort((x, y) => x.start - y.start) : current;
};

/** Returns the subtitle text active at `time`. Rendering cues ourselves
 * keeps them in sync even when a remuxed stream restarts at an offset.
 * Subtitle files are fetched once; embedded tracks are fetched in
 * two-minute windows around the playhead so the server only reads that part
 * of the video. */
export const useSubtitles = (track: SubtitleOption | null, time: number) => {
  const [cues, setCues] = useState<Cue[]>([]);
  const requested = useRef(new Set<number>());
  const trackId = track?.id ?? null;

  useEffect(() => {
    setCues([]);
    requested.current = new Set();
  }, [trackId]);

  // Whole subtitle files.
  useEffect(() => {
    if (!track || track.embedded) return;
    let cancelled = false;
    fetch(track.url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => !cancelled && setCues(parseVtt(t)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // Embedded tracks, window by window.
  const chunk = Math.max(0, Math.floor(time / CHUNK));
  const wantNext = time - chunk * CHUNK > CHUNK - PREFETCH;
  useEffect(() => {
    if (!track?.embedded) return;
    const wanted = wantNext ? [chunk, chunk + 1] : [chunk];
    for (const c of wanted) {
      if (requested.current.has(c)) continue;
      requested.current.add(c);
      const id = track.id;
      fetch(`${track.url}?start=${c * CHUNK}&end=${(c + 1) * CHUNK}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((t) => setCues((cur) => (track.id === id ? merge(cur, parseVtt(t)) : cur)))
        .catch(() => requested.current.delete(c));
    }
  }, [track, chunk, wantNext]);

  const active = cues.filter((c) => time >= c.start && time <= c.end);
  return active.map((c) => c.text).join("\n");
};
