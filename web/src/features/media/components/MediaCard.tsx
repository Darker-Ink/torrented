import { PlayIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { img } from "@/lib/images";
import type { MediaCard as Card } from "@/lib/types";

type Props = { item: Card; className?: string };

/** Landscape card used in rows. */
const MediaCard = ({ item, className }: Props) => (
  <Link
    to={`/title/${item.id}`}
    className={clsx(
      "group/card relative block aspect-video w-64 shrink-0 snap-start overflow-hidden rounded-md bg-surface ring-1 ring-line transition duration-300 hover:z-10 hover:scale-[1.04] hover:ring-primary/40 sm:w-72",
      !item.available && "opacity-70 hover:opacity-100",
      className,
    )}
  >
    {item.backdrop_path ? (
      <img
        src={img(item.backdrop_path, "w780")}
        alt=""
        loading="lazy"
        className="size-full object-cover transition duration-500 group-hover/card:scale-105"
      />
    ) : (
      <div className="grid size-full place-items-center bg-gradient-to-br from-surface to-bg text-sm text-muted">No image</div>
    )}
    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 space-y-1 p-3">
      {item.logo_path ? (
        <img src={img(item.logo_path, "w300")} alt={item.title} className="max-h-10 max-w-[70%] object-contain object-left" />
      ) : (
        <p className="line-clamp-1 font-bold text-shadow">{item.title}</p>
      )}
      <div className="flex items-center gap-2 text-xs text-fg/70 opacity-0 transition group-hover/card:opacity-100">
        {item.year && <span>{item.year}</span>}
        {item.certification && <span className="rounded border border-white/30 px-1">{item.certification}</span>}
        {item.genres[0] && <span>{item.genres.slice(0, 2).join(" · ")}</span>}
        {!item.available && <span className="text-warning">No source yet</span>}
      </div>
    </div>
    {item.available && (
      <span className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition group-hover/card:scale-100 group-hover/card:opacity-100">
        <PlayIcon className="ml-0.5 size-6" />
      </span>
    )}
  </Link>
);

export default MediaCard;
