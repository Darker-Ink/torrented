import type { MediaKind } from "./types";

/** URLs use TMDB ids (the same on every instance) plus a readable slug, so a
 * link copied from one server works on another. */

type TitleRef = { kind: MediaKind; tmdb_id: number; title: string };

export const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const segment = (kind: MediaKind) => (kind === "tv" ? "show" : "movie");

export const kindFromSegment = (segment: string | undefined): MediaKind | null =>
  segment === "show" ? "tv" : segment === "movie" ? "movie" : null;

const slugFor = (m: TitleRef) => {
  const slug = slugify(m.title);
  return slug ? `${m.tmdb_id}-${slug}` : String(m.tmdb_id);
};

export const titleUrl = (m: TitleRef) => `/${segment(m.kind)}/${slugFor(m)}`;

type WatchOptions = {
  season?: number | null;
  episode?: number | null;
  /** Info hash of the torrent to prefer. */
  version?: string | null;
  /** Start time in seconds. */
  t?: number | null;
};

export const watchUrl = (m: TitleRef, opts: WatchOptions = {}) => {
  let url = `/watch/${segment(m.kind)}/${slugFor(m)}`;
  if (m.kind === "tv" && opts.season != null && opts.episode != null) {
    url += `/s${opts.season}e${opts.episode}`;
  }
  const params = new URLSearchParams();
  if (opts.version) params.set("v", opts.version.slice(0, 8));
  if (opts.t && opts.t > 0) params.set("t", String(Math.floor(opts.t)));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
};

/** "95396-severance" → 95396 */
export const tmdbIdFromSlug = (slug: string | undefined) => {
  const m = slug?.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
};

/** "s1e2" → { season: 1, episode: 2 } */
export const parseEpisodeSlug = (s: string | undefined) => {
  const m = s?.match(/^s(\d+)e(\d+)$/i);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
};

export const canonicalSlug = slugFor;
