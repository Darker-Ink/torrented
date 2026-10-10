import { ArrowPathIcon, CheckIcon, InformationCircleIcon, PlusIcon, TrashIcon } from "@heroicons/react/20/solid";
import { PlayIcon } from "@heroicons/react/24/solid";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import RequestDialog from "@/features/discover/components/RequestDialog";
import AddTorrentDialog from "@/features/torrents/components/AddTorrentDialog";
import SourcesPanel from "@/features/torrents/components/SourcesPanel";
import Button from "@/features/ui/components/Button";
import ConfirmDialog from "@/features/ui/components/ConfirmDialog";
import Select from "@/features/ui/components/Select";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import { episodeCode, formatBytes, formatRuntime } from "@/lib/format";
import { can, PERM } from "@/lib/permissions";
import type { TitleDetail } from "@/lib/types";
import { watchUrl } from "@/lib/urls";
import { useEpisodes, useToggleWatchlist } from "../hooks/queries";
import EpisodeList from "./EpisodeList";
import SectionTabs, { type Section } from "./SectionTabs";
import TitleDetails from "./TitleDetails";
import TitleHeader from "./TitleHeader";
import TrailerDialog from "./TrailerDialog";

type Props = { data: TitleDetail };

const TitleView = ({ data }: Props) => {
  const { media } = data;
  const id = media.id;
  const navigate = useNavigate();
  const user = useUser();
  const client = useQueryClient();
  const watchlist = useToggleWatchlist();
  const [season, setSeason] = useState<number | null>(null);
  const [trailer, setTrailer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isTv = media.kind === "tv";
  const seasons = data.seasons;

  // Default to the season of the next episode, else the first season with content.
  useEffect(() => {
    if (season !== null || !isTv) return;
    const fromPlay = data.play?.season_number;
    const firstAvailable = seasons.find((s) => s.season_number > 0 && s.available_episodes > 0)?.season_number;
    const first = seasons.find((s) => s.season_number > 0)?.season_number ?? seasons[0]?.season_number ?? null;
    setSeason(fromPlay ?? firstAvailable ?? first);
  }, [data.play, isTv, season, seasons]);

  const episodes = useEpisodes(id, isTv ? season : null);

  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["title"] });
    client.invalidateQueries({ queryKey: ["episodes", id] });
  };

  const refresh = useMutation({
    mutationFn: () => api.post(`/library/${id}/refresh`),
    onSuccess: () => {
      invalidate();
      toast.success("Metadata refreshed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/library/${id}`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["home"] });
      client.invalidateQueries({ queryKey: ["library"] });
      client.invalidateQueries({ queryKey: ["title"] });
      toast.success("Removed from the library");
      navigate("/", { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const play = data.play;
  const playLabel = useMemo(() => {
    if (!play) return null;
    const resuming = play.position > 30;
    if (isTv && play.season_number !== undefined && play.episode_number !== undefined) {
      return `${resuming ? "Resume" : "Play"} ${episodeCode(play.season_number, play.episode_number)}`;
    }
    return resuming ? "Resume" : "Play";
  }, [play, isTv]);

  const seasonCount = seasons.filter((s) => s.season_number > 0).length;
  const canAddTorrent = can(user, PERM.ADD_TORRENTS);
  const canRequest = can(user, PERM.REQUEST);
  const openRequest = data.request && (data.request.status === "pending" || data.request.status === "approved");
  const showSources = canAddTorrent || can(user, PERM.MANAGE_TORRENTS);

  const note = play ? null : openRequest ? (
    <>
      <InformationCircleIcon className="size-4 text-warning" />
      Requested. Waiting for someone to add a torrent.
    </>
  ) : canAddTorrent ? (
    <>
      <InformationCircleIcon className="size-4 text-fg/50" />
      No torrent yet. Add one to start streaming.
    </>
  ) : (
    <>
      <InformationCircleIcon className="size-4 text-fg/50" />
      Not available to watch yet.
    </>
  );

  const sections: Section[] = [];
  if (isTv && seasons.length > 0) {
    const current = seasons.find((s) => s.season_number === season);
    sections.push({
      key: "episodes",
      label: "Episodes",
      content: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {current?.available_episodes ?? 0} of {current?.episode_count ?? 0} episodes available
            </p>
            <Select
              className="w-56"
              value={season}
              onChange={setSeason}
              options={seasons.map((s) => ({
                value: s.season_number as number | null,
                label: s.name ?? `Season ${s.season_number}`,
                description: `${s.available_episodes}/${s.episode_count} available`,
              }))}
              anchor="bottom end"
            />
          </div>
          <EpisodeList
            media={media}
            episodes={episodes.data}
            loading={episodes.isLoading}
            fallbackImage={media.backdrop_path}
          />
        </div>
      ),
    });
  }
  if (!isTv && data.files.length > 1) {
    sections.push({
      key: "versions",
      label: "Versions",
      count: data.files.length,
      content: (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.files.map((f) => (
            <button
              key={f.file_id}
              onClick={() => navigate(watchUrl(media, { version: f.info_hash }))}
              className="group flex items-center gap-4 rounded-2xl bg-white/[0.025] p-4 text-left ring-1 ring-white/[0.07] transition hover:bg-white/[0.05] hover:ring-primary/40"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 transition group-hover:bg-white group-hover:text-black">
                <PlayIcon className="ml-0.5 size-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {[f.resolution, f.source, f.video_codec, f.hdr].filter(Boolean).join(" · ") || "Video"}
                </span>
                <span className="block truncate text-xs text-muted">
                  {formatBytes(f.size)} · {f.torrent_name}
                </span>
              </span>
            </button>
          ))}
        </div>
      ),
    });
  }
  sections.push({
    key: "details",
    label: "Details",
    content: (
      <TitleDetails
        kind={media.kind}
        tmdbId={media.tmdb_id}
        imdbId={media.imdb_id}
        releaseDate={media.release_date}
        runtime={media.runtime}
        status={media.status}
        rating={media.rating}
        voteCount={media.vote_count}
        certification={media.certification}
        language={media.original_language}
        networks={media.networks}
        genres={media.genres}
        cast={media.cast_members}
        seasons={seasonCount}
        footer={
          can(user, PERM.MANAGE_LIBRARY) ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-6">
              <span className="mr-2 text-sm font-semibold text-fg/90">Manage</span>
              <Button size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending}>
                <ArrowPathIcon className="size-4" /> Refresh metadata
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
                <TrashIcon className="size-4" /> Remove from library
              </Button>
            </div>
          ) : undefined
        }
      />
    ),
  });
  if (showSources) {
    sections.push({
      key: "sources",
      label: "Sources",
      count: data.torrent_count,
      content: <SourcesPanel mediaId={id} title={media.title} kind={media.kind} />,
    });
  }

  return (
    <div className="space-y-6 pb-12">
      <TitleHeader
        title={media.title}
        backdrop={media.backdrop_path}
        logo={media.logo_path}
        tagline={media.tagline}
        overview={media.overview}
        genres={media.genres}
        note={note}
        meta={[
          media.rating ? <span className="font-semibold text-success">★ {media.rating.toFixed(1)}</span> : null,
          media.year,
          media.certification ? (
            <span className="rounded border border-white/40 px-1.5 text-xs leading-5">{media.certification}</span>
          ) : null,
          isTv ? (seasonCount ? `${seasonCount} season${seasonCount > 1 ? "s" : ""}` : null) : formatRuntime(media.runtime),
          media.networks[0],
        ]}
      >
        {play ? (
          <Button
            variant="light"
            size="lg"
            onClick={() =>
              navigate(watchUrl(media, { season: play.season_number, episode: play.episode_number }))
            }
          >
            <PlayIcon className="size-6" /> {playLabel}
          </Button>
        ) : canAddTorrent ? (
          <Button variant="primary" size="lg" onClick={() => setAdding(true)}>
            <PlusIcon className="size-5" /> Add torrent
          </Button>
        ) : canRequest && !openRequest ? (
          <Button variant="primary" size="lg" onClick={() => setRequesting(true)}>
            <PlusIcon className="size-5" /> Request
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          className="!px-3"
          aria-label={data.in_watchlist ? "Remove from My List" : "Add to My List"}
          title={data.in_watchlist ? "Remove from My List" : "Add to My List"}
          onClick={() => watchlist.mutate({ kind: media.kind, tmdb_id: media.tmdb_id, add: !data.in_watchlist })}
        >
          {data.in_watchlist ? <CheckIcon className="size-6" /> : <PlusIcon className="size-6" />}
        </Button>
        {media.trailer_key && (
          <Button variant="secondary" size="lg" onClick={() => setTrailer(true)}>
            Trailer
          </Button>
        )}
      </TitleHeader>

      <SectionTabs sections={sections} />

      {media.trailer_key && (
        <TrailerDialog open={trailer} onClose={() => setTrailer(false)} youtubeKey={media.trailer_key} title={media.title} />
      )}
      <AddTorrentDialog open={adding} onClose={() => setAdding(false)} mediaId={id} title={media.title} kind={media.kind} />
      <RequestDialog
        open={requesting}
        onClose={() => setRequesting(false)}
        title={{ kind: media.kind, tmdb_id: media.tmdb_id, title: media.title, seasons }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={`Remove ${media.title}?`}
        confirmLabel="Remove"
        danger
      >
        This removes the title, its torrents and file matches from the library. Watch history is kept.
      </ConfirmDialog>
    </div>
  );
};

export default TitleView;
