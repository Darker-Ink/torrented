import { XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useState, type RefObject } from "react";
import { formatBytes, formatClock } from "@/lib/format";
import type { PlayInfo } from "@/lib/types";
import { useFileStatus } from "../hooks/usePlayback";

type Props = {
  info: PlayInfo;
  mode: string;
  video: RefObject<HTMLVideoElement | null>;
  bufferAhead: number;
  position: number;
  onClose: () => void;
};

/** "Stats for nerds": what is playing, how, and how the swarm is doing. */
const StatsOverlay = ({ info, mode, video, bufferAhead, position, onClose }: Props) => {
  const { data } = useFileStatus(info.file_id, true);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const v = video.current;
  const quality = v?.getVideoPlaybackQuality?.();
  const p = data?.progress;
  const rows: [string, string][] = [
    ["Mode", `${mode}${mode === info.mode ? "" : " (compatibility)"}`],
    ["Why", info.reason],
    ["File", info.file.path.split("/").pop() ?? ""],
    ["Torrent", info.info_hash.slice(0, 12)],
    ["Source", [info.file.resolution, info.file.video_codec, info.file.audio_codec].filter(Boolean).join(" / ")],
    ["Decoded", v ? `${v.videoWidth}×${v.videoHeight}` : ""],
    ["Viewport", v ? `${v.clientWidth}×${v.clientHeight}` : ""],
    ["Dropped frames", quality ? `${quality.droppedVideoFrames} of ${quality.totalVideoFrames}` : "n/a"],
    ["Buffer ahead", `${bufferAhead.toFixed(1)} s`],
    ["Speed", v ? `${v.playbackRate}×` : ""],
    ["Volume", v ? `${Math.round(v.volume * 100)}%${v.muted ? " (muted)" : ""}` : ""],
    ["Position", formatClock(position)],
    ["Swarm", p ? `${p.peers} peers · ${p.download_mbps.toFixed(2)} MiB/s` : "not loaded"],
    ["Fetched", p ? `${formatBytes(p.downloaded)} of ${formatBytes(p.size)}` : ""],
    ["Session", String(info.session_id)],
  ];

  return (
    <div
      className="absolute top-20 left-4 z-30 w-[22rem] rounded-xl border border-white/10 bg-black/75 p-4 font-mono text-[11px] leading-relaxed text-white/85 shadow-2xl backdrop-blur-md sm:left-10"
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onClose} className="absolute top-2 right-2 rounded p-1 text-white/50 hover:text-white" aria-label="Close stats">
        <XMarkIcon className="size-4" />
      </button>
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-white/45">{k}</dt>
            <dd className="truncate" title={val}>
              {val}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export default StatsOverlay;
