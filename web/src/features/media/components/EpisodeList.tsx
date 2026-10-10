import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { CheckCircleIcon, EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { useNavigate } from "react-router-dom";
import Badge from "@/features/ui/components/Badge";
import Skeleton from "@/features/ui/components/Skeleton";
import { formatBytes, formatDate } from "@/lib/format";
import { img } from "@/lib/images";
import type { Episode } from "@/lib/types";
import { useMarkWatched } from "../hooks/queries";

type Props = { mediaId: number; episodes?: Episode[]; loading?: boolean; fallbackImage?: string | null };

const menuItem = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm data-[focus]:bg-white/[0.07]";

const EpisodeRow = ({ ep, mediaId, fallbackImage }: { ep: Episode; mediaId: number; fallbackImage?: string | null }) => {
  const navigate = useNavigate();
  const mark = useMarkWatched();
  const playable = ep.files.length > 0;
  const progress = ep.progress;
  const pct = progress?.completed ? 100 : progress?.duration ? (progress.position / progress.duration) * 100 : 0;
  const play = (fileId: number) => navigate(`/watch/${fileId}`);
  const best = ep.files[0];

  return (
    <div
      className={clsx(
        "group/ep flex gap-4 rounded-lg p-3 transition sm:items-center",
        playable ? "hover:bg-white/[0.04]" : "opacity-60",
      )}
    >
      <span className="hidden w-8 shrink-0 text-center text-2xl font-light text-muted sm:block">{ep.episode_number}</span>
      <button
        disabled={!playable}
        onClick={() => best && play(best.file_id)}
        className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-surface sm:w-44"
      >
        {(ep.still_path || fallbackImage) && (
          <img
            src={img(ep.still_path ?? fallbackImage, "w300")}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        )}
        {playable && (
          <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover/ep:opacity-100">
            <span className="grid size-10 place-items-center rounded-full border-2 border-white bg-black/40">
              <PlayIcon className="ml-0.5 size-5" />
            </span>
          </span>
        )}
        {pct > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">
              <span className="text-muted sm:hidden">{ep.episode_number}. </span>
              {ep.name ?? `Episode ${ep.episode_number}`}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {ep.runtime ? <span>{ep.runtime}m</span> : null}
              {ep.air_date && <span>{formatDate(ep.air_date)}</span>}
              {progress?.completed && (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircleIcon className="size-3.5" /> Watched
                </span>
              )}
              {!playable && <span className="text-warning">Not available</span>}
              {best?.resolution && <Badge className="py-0">{best.resolution}</Badge>}
            </div>
          </div>
          <Menu>
            <MenuButton className="rounded-md p-1 text-muted opacity-0 transition group-hover/ep:opacity-100 hover:bg-white/10 hover:text-fg data-[open]:opacity-100">
              <EllipsisVerticalIcon className="size-5" />
            </MenuButton>
            <MenuItems
              anchor="bottom end"
              transition
              className="z-50 mt-1 w-72 rounded-lg border border-line bg-surface p-1 shadow-xl transition data-[closed]:opacity-0"
            >
              {ep.files.length > 1 &&
                ep.files.map((f) => (
                  <MenuItem key={f.file_id}>
                    <button className={menuItem} onClick={() => play(f.file_id)}>
                      <PlayIcon className="size-4 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {[f.resolution, f.source, f.video_codec].filter(Boolean).join(" · ") || "Play"}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {formatBytes(f.size)} · {f.torrent_name}
                        </span>
                      </span>
                    </button>
                  </MenuItem>
                ))}
              <MenuItem>
                <button
                  className={menuItem}
                  onClick={() =>
                    mark.mutate({
                      media_id: mediaId,
                      season_number: ep.season_number,
                      episode_number: ep.episode_number,
                      watched: !progress?.completed,
                    })
                  }
                >
                  <CheckCircleIcon className="size-4 text-muted" />
                  {progress?.completed ? "Mark as unwatched" : "Mark as watched"}
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        </div>
        {ep.overview && <p className="line-clamp-2 text-sm text-muted">{ep.overview}</p>}
      </div>
    </div>
  );
};

const EpisodeList = ({ mediaId, episodes, loading, fallbackImage }: Props) => {
  if (loading || !episodes) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (episodes.length === 0) return <p className="text-sm text-muted">No episodes listed for this season.</p>;
  return (
    <div className="divide-y divide-line/60">
      {episodes.map((ep) => (
        <EpisodeRow key={ep.id} ep={ep} mediaId={mediaId} fallbackImage={fallbackImage} />
      ))}
    </div>
  );
};

export default EpisodeList;
