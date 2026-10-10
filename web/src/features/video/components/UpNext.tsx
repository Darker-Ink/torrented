import { PlayIcon } from "@heroicons/react/24/solid";
import { episodeCode } from "@/lib/format";
import type { PlayInfo } from "@/lib/types";

type Props = { next: NonNullable<PlayInfo["next"]>; countdown: number; onPlay: () => void; onDismiss: () => void };

const UpNext = ({ next, countdown, onPlay, onDismiss }: Props) => (
  <div className="absolute right-6 bottom-28 z-20 w-80 animate-rise overflow-hidden rounded-lg border border-white/10 bg-black/85 shadow-2xl backdrop-blur-md">
    <div className="space-y-1 p-4">
      <p className="text-xs font-semibold tracking-wide text-white/50 uppercase">Up next</p>
      <p className="font-semibold">
        {episodeCode(next.season_number, next.episode_number)}
        {next.name ? ` · ${next.name}` : ""}
      </p>
    </div>
    <div className="flex gap-2 px-4 pb-4">
      <button
        onClick={onPlay}
        className="relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-md bg-white py-2 text-sm font-bold text-black"
      >
        <span
          className="absolute inset-y-0 left-0 bg-primary/60 transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.max(0, 100 - countdown * 10)}%` }}
        />
        <PlayIcon className="relative size-4" />
        <span className="relative">Play{countdown > 0 ? ` in ${countdown}` : ""}</span>
      </button>
      <button onClick={onDismiss} className="rounded-md px-3 text-sm text-white/70 hover:bg-white/10 hover:text-white">
        Hide
      </button>
    </div>
  </div>
);

export default UpNext;
