import { episodeCode } from "@/lib/format";
import type { PlayInfo } from "@/lib/types";
import { PlayGlyph } from "./PlayerIcons";

type Props = { next: NonNullable<PlayInfo["next"]>; countdown: number; onPlay: () => void; onDismiss: () => void };

const UpNext = ({ next, countdown, onPlay, onDismiss }: Props) => (
  <div className="absolute right-6 bottom-40 z-20 w-80 animate-rise overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 shadow-2xl shadow-black/70 backdrop-blur-xl sm:right-12">
    <div className="space-y-1 px-5 pt-4 pb-3">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">Up next</p>
      <p className="text-lg leading-tight font-bold">{next.name ?? `Episode ${next.episode_number}`}</p>
      <p className="text-sm text-white/55">{episodeCode(next.season_number, next.episode_number)}</p>
    </div>
    <div className="flex gap-2 px-5 pb-5">
      <button
        onClick={onPlay}
        className="relative flex h-10 flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl bg-white text-sm font-bold text-black"
      >
        <span
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, (10 - countdown) * 10)}%` }}
        />
        <PlayGlyph className="relative size-4" />
        <span className="relative">{countdown > 0 ? `Playing in ${countdown}` : "Play now"}</span>
      </button>
      <button onClick={onDismiss} className="rounded-xl px-4 text-sm font-medium text-white/65 hover:bg-white/10 hover:text-white">
        Hide
      </button>
    </div>
  </div>
);

export default UpNext;
