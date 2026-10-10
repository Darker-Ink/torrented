import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  ArrowPathIcon,
  CheckIcon,
  EllipsisHorizontalIcon,
  FilmIcon,
  PlusIcon,
  TrashIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import EpisodeList from "@/features/media/components/EpisodeList";
import SectionTabs, { type Section } from "@/features/media/components/SectionTabs";
import TitleDetails from "@/features/media/components/TitleDetails";
import TitleHeader from "@/features/media/components/TitleHeader";
import TrailerDialog from "@/features/media/components/TrailerDialog";
import { useEpisodes, useTitle, useToggleWatchlist } from "@/features/media/hooks/queries";
import AddTorrentDialog from "@/features/torrents/components/AddTorrentDialog";
import SourcesPanel from "@/features/torrents/components/SourcesPanel";
import Button from "@/features/ui/components/Button";
import ConfirmDialog from "@/features/ui/components/ConfirmDialog";
import EmptyState from "@/features/ui/components/EmptyState";
import Select from "@/features/ui/components/Select";
import Spinner from "@/features/ui/components/Spinner";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import { episodeCode, formatBytes, formatRuntime } from "@/lib/format";
import { can, PERM } from "@/lib/permissions";

const menuItem = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm data-[focus]:bg-white/[0.07]";

const TitlePage = () => {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useUser();
  const client = useQueryClient();
  const { data, isLoading, error } = useTitle(id);
  const watchlist = useToggleWatchlist();
  const [season, setSeason] = useState<number | null>(null);
  const [trailer, setTrailer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isTv = data?.media.kind === "tv";
  const seasons = data?.seasons ?? [];

  // Default to the season of the next episode, else the first season with content.
  useEffect(() => {
    if (!data || season !== null || !isTv) return;
    const fromPlay = data.play?.season_number;
    const firstAvailable = seasons.find((s) => s.season_number > 0 && s.available_episodes > 0)?.season_number;
    const first = seasons.find((s) => s.season_number > 0)?.season_number ?? seasons[0]?.season_number ?? null;
    setSeason(fromPlay ?? firstAvailable ?? first);
  }, [data, isTv, season, seasons]);

  const episodes = useEpisodes(id, isTv ? season : null);

  // Deep link: /title/1?play=1[&s=1&e=2] starts playback straight away.
  const wantsPlay = params.get("play") === "1";
  const wantS = params.get("s");
  const wantE = params.get("e");
  const deepLinkEpisodes = useEpisodes(id, wantsPlay && wantS ? Number(wantS) : null);
  useEffect(() => {
    if (!wantsPlay || !data) return;
    if (wantS && wantE) {
      if (!deepLinkEpisodes.data) return;
      const ep = deepLinkEpisodes.data.find((e) => e.episode_number === Number(wantE));
      const file = ep?.files[0];
      if (file) {
        navigate(`/watch/${file.file_id}`, { replace: true });
        return;
      }
    } else if (data.play) {
      navigate(`/watch/${data.play.file_id}`, { replace: true });
      return;
    }
    setParams({}, { replace: true });
  }, [wantsPlay, wantS, wantE, data, deepLinkEpisodes.data, navigate, setParams]);

  const refresh = useMutation({
    mutationFn: () => api.post(`/library/${id}/refresh`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["title", id] });
      client.invalidateQueries({ queryKey: ["episodes", id] });
      toast.success("Metadata refreshed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/library/${id}`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["home"] });
      client.invalidateQueries({ queryKey: ["library"] });
      toast.success("Removed from the library");
      navigate("/", { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const playLabel = useMemo(() => {
    if (!data?.play) return null;
    const p = data.play;
    const resuming = p.position > 30;
    if (isTv && p.season_number !== undefined && p.episode_number !== undefined) {
      return `${resuming ? "Resume" : "Play"} ${episodeCode(p.season_number, p.episode_number)}`;
    }
    return resuming ? "Resume" : "Play";
  }, [data?.play, isTv]);

  if (isLoading) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="pt-32">
        <EmptyState icon={FilmIcon} title="Title not found">
          {errorMessage(error)}
        </EmptyState>
      </div>
    );
  }

  const { media } = data;
  const seasonCount = seasons.filter((s) => s.season_number > 0).length;
  const canAddTorrent = can(user, PERM.ADD_TORRENTS);
  const showSources = canAddTorrent || can(user, PERM.MANAGE_TORRENTS);

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
          <EpisodeList mediaId={id} episodes={episodes.data} loading={episodes.isLoading} fallbackImage={media.backdrop_path} />
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
              onClick={() => navigate(`/watch/${f.file_id}`)}
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
        {data.play ? (
          <Button variant="light" size="lg" onClick={() => navigate(`/watch/${data.play!.file_id}`)}>
            <PlayIcon className="size-6" /> {playLabel}
          </Button>
        ) : (
          <div className="flex items-center gap-3 rounded-md bg-black/40 px-4 py-2.5 text-sm backdrop-blur">
            <VideoCameraIcon className="size-5 text-warning" />
            <span>
              {data.request?.status === "approved" || data.request?.status === "pending"
                ? "Requested — waiting for someone to add a torrent"
                : "No torrent yet"}
            </span>
            {canAddTorrent && (
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                Add one
              </Button>
            )}
          </div>
        )}
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
        {can(user, PERM.MANAGE_LIBRARY) && (
          <Menu>
            <MenuButton className="grid size-12 place-items-center rounded-md bg-white/10 backdrop-blur-sm hover:bg-white/15">
              <EllipsisHorizontalIcon className="size-6" />
            </MenuButton>
            <MenuItems
              anchor="bottom start"
              transition
              className="z-50 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-xl transition data-[closed]:opacity-0"
            >
              <MenuItem>
                <button className={menuItem} onClick={() => refresh.mutate()}>
                  <ArrowPathIcon className="size-4 text-muted" /> Refresh metadata
                </button>
              </MenuItem>
              <MenuItem>
                <button className={`${menuItem} text-danger`} onClick={() => setDeleting(true)}>
                  <TrashIcon className="size-4" /> Remove from library
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        )}
      </TitleHeader>

      <SectionTabs sections={sections} />

      {media.trailer_key && (
        <TrailerDialog open={trailer} onClose={() => setTrailer(false)} youtubeKey={media.trailer_key} title={media.title} />
      )}
      <AddTorrentDialog open={adding} onClose={() => setAdding(false)} mediaId={id} title={media.title} kind={media.kind} />
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

export default TitlePage;
