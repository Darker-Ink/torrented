import { PlayIcon } from "@heroicons/react/24/solid";
import { Link } from "react-router-dom";
import { episodeCode } from "@/lib/format";
import { img } from "@/lib/images";
import type { ContinueItem } from "@/lib/types";

type Props = { item: ContinueItem };

const ContinueCard = ({ item }: Props) => {
  const { media, target } = item;
  const pct = item.duration ? Math.min(100, (item.position / item.duration) * 100) : 0;
  const isEpisode = media.kind === "tv" && target.season_number >= 0;
  const to = `/title/${media.id}?play=1${isEpisode ? `&s=${target.season_number}&e=${target.episode_number}` : ""}`;

  return (
    <Link
      to={to}
      className="group/card relative block w-64 shrink-0 snap-start overflow-hidden rounded-md bg-surface ring-1 ring-line transition duration-300 hover:z-10 hover:scale-[1.04] hover:ring-primary/40 sm:w-72"
    >
      <div className="relative aspect-video">
        {media.backdrop_path && (
          <img src={img(media.backdrop_path, "w780")} alt="" loading="lazy" className="size-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        <span className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white/80 bg-black/40 text-white backdrop-blur-sm transition group-hover/card:scale-110 group-hover/card:bg-white group-hover/card:text-black">
          <PlayIcon className="ml-0.5 size-6" />
        </span>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="space-y-0.5 px-3 py-2.5">
        <p className="truncate text-sm font-semibold">{media.title}</p>
        <p className="truncate text-xs text-muted">
          {isEpisode
            ? `${episodeCode(target.season_number, target.episode_number)}${target.episode_name ? ` · ${target.episode_name}` : ""}`
            : pct > 0
              ? `${Math.round(pct)}% watched`
              : "Movie"}
        </p>
      </div>
    </Link>
  );
};

export default ContinueCard;
