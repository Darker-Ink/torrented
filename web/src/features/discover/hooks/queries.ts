import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { DiscoverDetail, DiscoverPage, MediaKind } from "@/lib/types";

export const useDiscoverList = (kind: MediaKind, list: string) =>
  useQuery({
    queryKey: ["discover", "list", kind, list],
    queryFn: () => api.get<DiscoverPage>(`/discover/list/${kind}/${list}`),
    staleTime: 600_000,
  });

export const useDiscoverGenres = (kind: MediaKind) =>
  useQuery({
    queryKey: ["discover", "genres", kind],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/discover/genres/${kind}`),
    staleTime: Infinity,
  });

export const useDiscoverGenre = (kind: MediaKind, genre: number | null) =>
  useQuery({
    queryKey: ["discover", "genre", kind, genre],
    queryFn: () => api.get<DiscoverPage>(`/discover/genre/${kind}/${genre}`),
    enabled: genre !== null,
    staleTime: 600_000,
  });

export const useDiscoverSearch = (q: string, kind?: MediaKind, page = 1) =>
  useQuery({
    queryKey: ["discover", "search", q, kind, page],
    queryFn: () => api.get<DiscoverPage>(`/discover/search${qs({ q, kind, page })}`),
    enabled: q.trim().length > 1,
    placeholderData: (prev) => prev,
  });

export const useDiscoverTitle = (kind: MediaKind, id: number) =>
  useQuery({
    queryKey: ["discover", "title", kind, id],
    queryFn: () => api.get<DiscoverDetail>(`/discover/title/${kind}/${id}`),
  });

const useInvalidateDiscovery = () => {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["discover"] });
    client.invalidateQueries({ queryKey: ["requests"] });
    client.invalidateQueries({ queryKey: ["home"] });
    client.invalidateQueries({ queryKey: ["library"] });
  };
};

export const useAddToLibrary = () => {
  const invalidate = useInvalidateDiscovery();
  return useMutation({
    mutationFn: (body: { kind: MediaKind; tmdb_id: number }) =>
      api.post<{ id: number; created: boolean }>("/library", body),
    onSuccess: invalidate,
  });
};

export const useCreateRequest = () => {
  const invalidate = useInvalidateDiscovery();
  return useMutation({
    mutationFn: (body: { kind: MediaKind; tmdb_id: number; seasons?: number[]; note?: string }) =>
      api.post<{ id: number; status: string; media_id: number | null }>("/requests", body),
    onSuccess: invalidate,
  });
};
