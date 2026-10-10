import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { MediaRequest, RequestStatus } from "@/lib/types";

export const useRequests = (scope: "mine" | "all", status?: RequestStatus) =>
  useQuery({
    queryKey: ["requests", scope, status],
    queryFn: () => api.get<MediaRequest[]>(`/requests${qs({ scope, status })}`),
  });

export const useRequestActions = () => {
  const client = useQueryClient();
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["requests"] });
    client.invalidateQueries({ queryKey: ["discover"] });
    client.invalidateQueries({ queryKey: ["home"] });
  };
  const update = useMutation({
    mutationFn: ({ id, status, response }: { id: number; status: RequestStatus; response?: string }) =>
      api.patch<{ ok: boolean; media_id: number | null }>(`/requests/${id}`, { status, response }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/requests/${id}`),
    onSuccess: invalidate,
  });
  return { update, remove };
};
