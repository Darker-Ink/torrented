export const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
};

export const formatRuntime = (minutes: number | null | undefined) => {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

export const formatClock = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

export const episodeCode = (season: number, episodes: number | number[]) => {
  const list = Array.isArray(episodes) ? episodes : [episodes];
  const s = `S${String(season).padStart(2, "0")}`;
  if (!list.length) return s;
  const first = `E${String(list[0]).padStart(2, "0")}`;
  return list.length > 1 ? `${s}${first}-E${String(list[list.length - 1]).padStart(2, "0")}` : `${s}${first}`;
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ];
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  for (let i = 1; i < steps.length; i++) {
    if (abs < steps[i][0]) return rtf.format(Math.round(diff / steps[i - 1][0]), steps[i][1]);
  }
  return rtf.format(Math.round(diff / 31557600), "year");
};

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

export const formatDuration = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};
