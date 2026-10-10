import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { MediaRequest, RequestStatus } from "@/lib/types";

export const useRequests = (scope: "mine" | "all", status?: RequestStatus) =>
  useQuery({
    queryKey: ["requests", scope, status],
    queryFn: () => api.get<MediaRequest[]>(`/requests${qs({ scope, status })}`),
    // Keep polling while a suggested torrent is being checked.
    refetchInterval: (q) => (q.state.data?.some((r) => r.review_status === "checking") ? 3000 : false),
  });

export const useRequestActions = () => {
  const client = useQueryClient();
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["requests"] });
    client.invalidateQueries({ queryKey: ["discover"] });
    client.invalidateQueries({ queryKey: ["home"] });
  };
  const update = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      status: RequestStatus;
      response?: string;
      attach_torrent?: boolean;
    }) =>
      api.patch<{ ok: boolean; media_id: number | null; torrent_error: string | null }>(`/requests/${id}`, body),
    onSuccess: () => {
      invalidate();
      client.invalidateQueries({ queryKey: ["title"] });
    },
  });
  const recheck = useMutation({
    mutationFn: (id: number) => api.post(`/requests/${id}/review`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/requests/${id}`),
    onSuccess: invalidate,
  });
  return { update, remove, recheck };
};
