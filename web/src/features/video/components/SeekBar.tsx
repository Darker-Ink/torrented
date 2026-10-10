import { useRef, useState, type PointerEvent } from "react";
import { formatClock } from "@/lib/format";

type Props = {
  current: number;
  duration: number | null;
  buffered: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
};

const SeekBar = ({ current, duration, buffered, onSeek, disabled }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const total = duration && duration > 0 ? duration : null;

  const timeAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * (total ?? 0);
  };

  const onDown = (e: PointerEvent) => {
    if (disabled || !total) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(timeAt(e.clientX));
  };
  const onMove = (e: PointerEvent) => {
    if (!total) return;
    const t = timeAt(e.clientX);
    setHover(t);
    if (drag !== null) setDrag(t);
  };
  const onUp = () => {
    if (drag !== null) onSeek(drag);
    setDrag(null);
  };

  const shown = drag ?? current;
  const pct = total ? (shown / total) * 100 : 0;
  const bufPct = total ? Math.min(100, (buffered / total) * 100) : 0;
  const hoverPct = total && hover !== null ? (hover / total) * 100 : 0;

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => drag === null && setHover(null)}
      className={`group/seek relative flex h-5 items-center ${disabled || !total ? "cursor-default" : "cursor-pointer"}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={total ?? 0}
      aria-valuenow={shown}
    >
      <div className="relative h-1 w-full rounded-full bg-white/20 transition-[height] group-hover/seek:h-1.5">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufPct}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        {total && (
          <div
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-primary shadow transition group-hover/seek:scale-100"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
      {hover !== null && total && (
        <div
          className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded bg-black/85 px-2 py-1 text-xs font-semibold tabular-nums"
          style={{ left: `${hoverPct}%` }}
        >
          {formatClock(hover)}
        </div>
      )}
    </div>
  );
};

export default SeekBar;
