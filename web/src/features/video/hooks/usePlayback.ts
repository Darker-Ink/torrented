import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { FileStatus, PlayInfo } from "@/lib/types";

/** What this browser can decode beyond the H.264/AAC baseline. */
export const clientCaps = () => {
  const video = document.createElement("video");
  const ms = window.MediaSource;
  const supports = (type: string) => video.canPlayType(type) !== "" || (ms?.isTypeSupported?.(type) ?? false);
  return {
    hevc: supports('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    ac3: supports('audio/mp4; codecs="ac-3"'),
  };
};

export const usePlayInfo = (fileId: number) =>
  useQuery({
    queryKey: ["play", fileId],
    queryFn: () => api.get<PlayInfo>(`/play/${fileId}${qs(clientCaps())}`),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

export const useFileStatus = (fileId: number, enabled: boolean) =>
  useQuery({
    queryKey: ["file-status", fileId],
    queryFn: () => api.get<FileStatus>(`/stream/${fileId}/status`),
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });

export const reportProgress = (
  body: { file_id: number; position: number; duration: number | null; session_id: number },
  beacon = false,
) => {
  if (beacon && navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
    if (navigator.sendBeacon("/api/progress", blob)) return Promise.resolve();
  }
  return api.post("/progress", body).catch(() => {});
};
