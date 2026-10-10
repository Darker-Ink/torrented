import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Spinner from "@/features/ui/components/Spinner";
import { api, ApiError, errorMessage, qs } from "@/lib/api";
import { kindFromSegment, parseEpisodeSlug, tmdbIdFromSlug } from "@/lib/urls";
import type { PlayInfo } from "@/lib/types";
import { usePlayInfo } from "../hooks/usePlayback";
import VideoPlayer from "./VideoPlayer";

type MessageProps = { title: string; body?: string; onBack: () => void; onRetry?: () => void; retrying?: boolean };

const Message = ({ title, body, onBack, onRetry, retrying }: MessageProps) => (
  <div className="fixed inset-0 grid place-items-center bg-black p-6 text-center">
    <div className="space-y-4">
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="text-sm text-white/60">{body}</p>}
      <div className="flex justify-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-60"
          >
            {retrying ? "Checking…" : "Try again"}
          </button>
        )}
        <button onClick={onBack} className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
          Go back
        </button>
      </div>
    </div>
  </div>
);

const Loading = () => (
  <div className="fixed inset-0 grid place-items-center bg-black">
    <div className="flex flex-col items-center gap-4 text-center">
      <Spinner size="lg" className="border-white/20 border-t-white" />
      <p className="text-sm text-white/70">Getting things ready…</p>
      <p className="max-w-xs text-xs text-white/40">
        The first play of a file reads its headers from the swarm, which can take a moment.
      </p>
    </div>
  </div>
);

/** /watch/movie/:slug and /watch/show/:slug[/s1e2]. ?v= picks a torrent,
 * ?t= sets the start time. */
const WatchRoute = () => {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const kind = kindFromSegment(params.kind);
  const tmdbId = tmdbIdFromSlug(params.slug);
  const episode = parseEpisodeSlug(params.episode);
  const version = search.get("v");
  const t = Number(search.get("t")) || null;

  const resolved = useQuery({
    queryKey: ["resolve", kind, tmdbId, episode?.season, episode?.episode, version],
    queryFn: () =>
      api.get<{ file_id: number }>(
        `/play/resolve${qs({ kind, tmdb_id: tmdbId, season: episode?.season, episode: episode?.episode, v: version })}`,
      ),
    enabled: !!kind && tmdbId !== null,
    retry: false,
    gcTime: 0,
  });
  const fileId = resolved.data?.file_id ?? null;
  const play = usePlayInfo(fileId);

  // While the next episode loads, keep the current player on screen so the
  // same video element (and fullscreen or picture-in-picture) carries over.
  const last = useRef<PlayInfo | null>(null);
  if (play.data) last.current = play.data;
  const shown = play.data ?? last.current;

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  // A seedbox that's still downloading answers 503: check again now and then.
  const waiting = play.error instanceof ApiError && play.error.status === 503;
  const { refetch } = play;
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => refetch(), 15_000);
    return () => window.clearInterval(t);
  }, [waiting, refetch]);

  if (!kind || tmdbId === null || (params.episode && !episode)) {
    return <Message title="That link doesn't look right" onBack={back} />;
  }
  if (resolved.error) return <Message title="Can't play this" body={errorMessage(resolved.error)} onBack={back} />;
  if (waiting) {
    return (
      <Message
        title="Not ready yet"
        body={`${errorMessage(play.error)}. This page checks again every few seconds.`}
        onBack={back}
        onRetry={() => refetch()}
        retrying={play.isFetching}
      />
    );
  }
  if (play.error) return <Message title="Can't play this" body={errorMessage(play.error)} onBack={back} />;
  if (!shown) return <Loading />;
  return <VideoPlayer info={shown} startAt={t} />;
};

export default WatchRoute;
