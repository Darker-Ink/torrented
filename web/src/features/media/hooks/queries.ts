import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { Episode, Home, MediaCard, MediaKind, TitleDetail } from "@/lib/types";

export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => api.get<Home>("/library/home") });

export const useTitle = (id: number) =>
  useQuery({
    queryKey: ["title", id],
    queryFn: () => api.get<TitleDetail>(`/library/${id}`),
    enabled: Number.isFinite(id),
  });

export const useEpisodes = (id: number, season: number | null) =>
  useQuery({
    queryKey: ["episodes", id, season],
    queryFn: () => api.get<Episode[]>(`/library/${id}/episodes${qs({ season })}`),
    enabled: season !== null,
  });

export type LibraryParams = {
  kind?: MediaKind;
  genre?: string;
  q?: string;
  sort?: "added" | "title" | "year" | "rating";
  available?: "available" | "all" | "missing";
  page?: number;
  limit?: number;
};

export const useLibrary = (params: LibraryParams, enabled = true) =>
  useQuery({
    queryKey: ["library", params],
    queryFn: () =>
      api.get<{ items: MediaCard[]; total: number; page: number; limit: number }>(`/library${qs(params)}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const useGenres = () =>
  useQuery({ queryKey: ["genres"], queryFn: () => api.get<string[]>("/library/genres"), staleTime: 300_000 });

export const useWatchlist = () =>
  useQuery({ queryKey: ["watchlist"], queryFn: () => api.get<MediaCard[]>("/watchlist") });

export const useToggleWatchlist = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, tmdb_id, add }: { kind: MediaKind; tmdb_id: number; add: boolean }) =>
      add ? api.post("/watchlist", { kind, tmdb_id }) : api.delete(`/watchlist/${kind}/${tmdb_id}`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["watchlist"] });
      client.invalidateQueries({ queryKey: ["home"] });
      client.invalidateQueries({ queryKey: ["title"] });
    },
  });
};

export const useMarkWatched = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { media_id: number; season_number?: number; episode_number?: number; watched: boolean }) =>
      api.post("/progress/watched", body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["episodes"] });
      client.invalidateQueries({ queryKey: ["title"] });
      client.invalidateQueries({ queryKey: ["home"] });
    },
  });
};
