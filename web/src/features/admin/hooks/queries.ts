import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { Invite, LibraryInfo, LogEntry, NetworkStatus, Overview, Paged, PermissionInfo, SeedboxState, SettingsResponse, StreamEntry, TorrentJob, User } from "@/lib/types";

export const useOverview = () =>
  useQuery({ queryKey: ["admin", "overview"], queryFn: () => api.get<Overview>("/admin/overview"), refetchInterval: 5000 });

export const useUsers = () => useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<User[]>("/users") });

export const usePermissionList = () =>
  useQuery({ queryKey: ["permissions"], queryFn: () => api.get<PermissionInfo[]>("/permissions"), staleTime: Infinity });

export const useInvites = () =>
  useQuery({ queryKey: ["admin", "invites"], queryFn: () => api.get<Invite[]>("/invites") });

export const useLogs = (params: { action?: string; q?: string; page: number }) =>
  useQuery({
    queryKey: ["admin", "logs", params],
    queryFn: () => api.get<Paged<LogEntry>>(`/admin/logs${qs(params)}`),
    placeholderData: (p) => p,
  });

export const useStreamLog = (page: number) =>
  useQuery({
    queryKey: ["admin", "streams", page],
    queryFn: () => api.get<Paged<StreamEntry>>(`/admin/streams${qs({ page })}`),
    placeholderData: (p) => p,
  });

export const useNetwork = () =>
  useQuery({ queryKey: ["admin", "network"], queryFn: () => api.get<NetworkStatus>("/admin/network") });

export const useSettings = () =>
  useQuery({ queryKey: ["admin", "settings"], queryFn: () => api.get<SettingsResponse>("/settings") });

export const useLibraryInfo = () =>
  useQuery({ queryKey: ["admin", "library"], queryFn: () => api.get<LibraryInfo>("/admin/library") });

export type AdminTorrent = {
  id: number;
  info_hash: string;
  name: string;
  total_size: number;
  file_count: number;
  resolution: string | null;
  added_at: string;
  media_id: number;
  media_title: string;
  media_kind: "movie" | "tv";
  media_tmdb_id: number;
  poster_path: string | null;
  job: TorrentJob | null;
  seedbox?: SeedboxState | null;
};

export const useAllTorrents = () =>
  useQuery({ queryKey: ["admin", "torrents"], queryFn: () => api.get<AdminTorrent[]>("/torrents") });

export const useJobs = () =>
  useQuery({ queryKey: ["admin", "jobs"], queryFn: () => api.get<TorrentJob[]>("/torrents/jobs"), refetchInterval: 4000 });

export const useUserActions = () => {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ["admin", "users"] });
  const create = useMutation({
    mutationFn: (body: { username: string; password: string; display_name?: string; role: string; permissions: number }) =>
      api.post<User>("/users", body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<{ display_name: string; role: string; permissions: number; disabled: boolean; password: string }>) =>
      api.patch<User>(`/users/${id}`, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/users/${id}`), onSuccess: invalidate });
  return { create, update, remove };
};

export const useInviteActions = () => {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ["admin", "invites"] });
  const create = useMutation({
    mutationFn: (body: { permissions: number; max_uses: number; note?: string; expires_in_days?: number }) =>
      api.post<{ code: string }>("/invites", body),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (code: string) => api.delete(`/invites/${code}`), onSuccess: invalidate });
  return { create, remove };
};
