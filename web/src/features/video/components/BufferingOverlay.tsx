import Spinner from "@/features/ui/components/Spinner";
import { useFileStatus } from "../hooks/usePlayback";

type Props = { fileId: number; visible: boolean; starting: boolean };

const BufferingOverlay = ({ fileId, visible, starting }: Props) => {
  const { data } = useFileStatus(fileId, visible);
  if (!visible) return null;
  const p = data?.progress;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner size="lg" className="border-white/20 border-t-white" />
        <div className="space-y-1 text-shadow">
          <p className="text-sm font-semibold">{starting ? "Connecting to the swarm…" : "Buffering…"}</p>
          {p && (
            <p className="text-xs text-white/70 tabular-nums">
              {p.peers} peer{p.peers === 1 ? "" : "s"} · {p.download_mbps.toFixed(1)} MiB/s
            </p>
          )}
          {p && p.peers === 0 && <p className="text-xs text-white/50">Waiting for peers — this can take a minute.</p>}
        </div>
      </div>
    </div>
  );
};

export default BufferingOverlay;
