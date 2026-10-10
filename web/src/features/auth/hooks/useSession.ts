import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Instance, User } from "@/lib/types";

export const instanceKey = ["instance"] as const;

export const useInstance = () =>
  useQuery({
    queryKey: instanceKey,
    queryFn: () => api.get<Instance>("/instance"),
    staleTime: 60_000,
  });

/** The signed-in user, or null. */
export const useUser = (): User | null => {
  const { data } = useInstance();
  return data?.user ?? null;
};

export const useRefreshSession = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: instanceKey });
};

export const useSetUser = () => {
  const client = useQueryClient();
  return (user: User | null) =>
    client.setQueryData<Instance>(instanceKey, (prev) => (prev ? { ...prev, user, setup_required: false } : prev));
};
