import { useEffect, useState } from "react";

export type Cue = { start: number; end: number; text: string };

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
  return cues.sort((x, y) => x.start - y.start);
};

/** Loads a WebVTT file and returns the cue active at `time`. Rendering cues
 * ourselves keeps them in sync even when a remuxed stream restarts at an
 * offset. */
export const useSubtitles = (url: string | null, time: number) => {
  const [cues, setCues] = useState<Cue[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCues([]);
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => !cancelled && setCues(parseVtt(t)))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const active = cues.filter((c) => time >= c.start && time <= c.end);
  return { text: active.map((c) => c.text).join("\n"), loading };
};
