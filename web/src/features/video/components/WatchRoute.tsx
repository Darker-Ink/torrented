import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Spinner from "@/features/ui/components/Spinner";
import { api, errorMessage, qs } from "@/lib/api";
import { kindFromSegment, parseEpisodeSlug, tmdbIdFromSlug } from "@/lib/urls";
import { usePlayInfo } from "../hooks/usePlayback";
import VideoPlayer from "./VideoPlayer";

const Message = ({ title, body, onBack }: { title: string; body?: string; onBack: () => void }) => (
  <div className="fixed inset-0 grid place-items-center bg-black p-6 text-center">
    <div className="space-y-4">
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="text-sm text-white/60">{body}</p>}
      <button onClick={onBack} className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
        Go back
      </button>
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

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  if (!kind || tmdbId === null || (params.episode && !episode)) {
    return <Message title="That link doesn't look right" onBack={back} />;
  }
  if (resolved.error) return <Message title="Can't play this" body={errorMessage(resolved.error)} onBack={back} />;
  if (play.error) return <Message title="Can't play this" body={errorMessage(play.error)} onBack={back} />;
  if (!play.data) return <Loading />;
  return <VideoPlayer key={play.data.session_id} info={play.data} startAt={t} />;
};

export default WatchRoute;
