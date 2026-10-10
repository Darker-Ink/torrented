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
  const interactive = !disabled && !!total;

  const timeAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * (total ?? 0);
  };

  const onDown = (e: PointerEvent) => {
    if (!interactive) return;
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
  const active = drag !== null;

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => drag === null && setHover(null)}
      className={`group/seek relative flex h-6 min-w-0 flex-1 touch-none items-center ${interactive ? "cursor-pointer" : "cursor-default"}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={total ?? 0}
      aria-valuenow={shown}
    >
      <div
        className={`relative w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 ${active ? "h-[7px]" : "h-[5px] group-hover/seek:h-[7px]"}`}
      >
        <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufPct}%` }} />
        {hover !== null && total && (
          <div className="absolute inset-y-0 left-0 bg-white/20" style={{ width: `${hoverPct}%` }} />
        )}
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {total && (
        <div
          className={`pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_4px_rgb(160_196_235/0.25)] transition-transform duration-150 ${active ? "scale-100" : "scale-0 group-hover/seek:scale-100"}`}
          style={{ left: `${pct}%` }}
        />
      )}
      {hover !== null && total && (
        <div
          className="pointer-events-none absolute bottom-7 -translate-x-1/2 rounded-lg bg-neutral-950/90 px-2.5 py-1 text-[13px] font-semibold tabular-nums shadow-lg ring-1 ring-white/10"
          style={{ left: `clamp(28px, ${hoverPct}%, calc(100% - 28px))` }}
        >
          {formatClock(hover)}
        </div>
      )}
    </div>
  );
};

export default SeekBar;
