import { CheckIcon, ClockIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { img } from "@/lib/images";

type Props = {
  to: string;
  title: string;
  year?: number | null;
  poster?: string | null;
  rating?: number | null;
  dimmed?: boolean;
  badge?: ReactNode;
  className?: string;
};

/** Portrait poster used in grids and discovery rows. */
const PosterCard = ({ to, title, year, poster, rating, dimmed, badge, className }: Props) => (
  <Link to={to} className={clsx("group/poster block space-y-2", className)}>
    <div
      className={clsx(
        "relative aspect-[2/3] overflow-hidden rounded-md bg-surface ring-1 ring-line transition duration-300 group-hover/poster:-translate-y-1 group-hover/poster:ring-primary/50 group-hover/poster:shadow-xl group-hover/poster:shadow-black/40",
        dimmed && "opacity-60 group-hover/poster:opacity-100",
      )}
    >
      {poster ? (
        <img src={img(poster, "w342")} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center p-3 text-center text-sm font-semibold text-muted">{title}</div>
      )}
      {badge && <div className="absolute top-2 left-2">{badge}</div>}
      {rating ? (
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-fg backdrop-blur">
          ★ {rating.toFixed(1)}
        </span>
      ) : null}
    </div>
    <div className="px-0.5">
      <p className="truncate text-sm font-semibold">{title}</p>
      {year && <p className="text-xs text-muted">{year}</p>}
    </div>
  </Link>
);

export const AvailableBadge = () => (
  <span className="grid size-6 place-items-center rounded-full bg-success text-black shadow" title="Ready to watch">
    <CheckIcon className="size-4" />
  </span>
);

export const PendingBadge = ({ label }: { label: string }) => (
  <span className="flex items-center gap-1 rounded-full bg-warning/90 px-2 py-0.5 text-[11px] font-bold text-black shadow">
    <ClockIcon className="size-3.5" />
    {label}
  </span>
);

export default PosterCard;
