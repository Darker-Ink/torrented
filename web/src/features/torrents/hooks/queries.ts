import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Sources, TorrentFile } from "@/lib/types";

export const useSources = (mediaId: number, enabled = true) =>
  useQuery({
    queryKey: ["sources", mediaId],
    queryFn: () => api.get<Sources>(`/library/${mediaId}/sources`),
    enabled,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy =
        d.pending.some((j) => j.status === "resolving") ||
        d.torrents.some((t) => t.job && (t.job.status === "resolving" || t.job.status === "probing"));
      return busy ? 2500 : false;
    },
  });

const useInvalidate = (mediaId: number) => {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["sources", mediaId] });
    client.invalidateQueries({ queryKey: ["title"] });
    client.invalidateQueries({ queryKey: ["episodes", mediaId] });
    client.invalidateQueries({ queryKey: ["home"] });
  };
};

export const useAddTorrent = (mediaId: number) => {
  const invalidate = useInvalidate(mediaId);
  return useMutation({
    mutationFn: (input: { source: string } | { file: File }) => {
      if ("file" in input) {
        const form = new FormData();
        form.append("torrent", input.file);
        return api.post<{ info_hash: string; name: string | null }>(`/library/${mediaId}/torrents/upload`, form);
      }
      return api.post<{ info_hash: string; name: string | null }>(`/library/${mediaId}/torrents`, input);
    },
    onSuccess: invalidate,
  });
};

export const useTorrentActions = (mediaId: number) => {
  const invalidate = useInvalidate(mediaId);
  const remove = useMutation({
    mutationFn: (torrentId: number) => api.delete(`/torrents/${torrentId}`),
    onSuccess: invalidate,
  });
  const remap = useMutation({
    mutationFn: ({ torrentId, reset }: { torrentId: number; reset: boolean }) =>
      api.post(`/torrents/${torrentId}/remap`, { reset }),
    onSuccess: invalidate,
  });
  const probe = useMutation({
    mutationFn: (torrentId: number) => api.post(`/torrents/${torrentId}/probe`),
    onSuccess: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: (infoHash: string) => api.delete(`/torrents/jobs/${infoHash}`),
    onSuccess: invalidate,
  });
  const updateFile = useMutation({
    mutationFn: ({
      torrentId,
      fileId,
      ...body
    }: {
      torrentId: number;
      fileId: number;
      mapping: TorrentFile["mapping"];
      season_number?: number | null;
      episode_numbers?: number[];
    }) => api.patch(`/torrents/${torrentId}/files/${fileId}`, body),
    onSuccess: invalidate,
  });
  return { remove, remap, probe, dismiss, updateFile };
};
