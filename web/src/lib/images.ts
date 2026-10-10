type Size = "w92" | "w185" | "w300" | "w342" | "w500" | "w780" | "w1280" | "original";

/** TMDB paths start with "/", TVDB images are already full URLs. */
export const img = (path: string | null | undefined, size: Size = "w500") => {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
};
