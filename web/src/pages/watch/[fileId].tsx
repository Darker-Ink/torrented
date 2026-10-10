import { useNavigate, useParams } from "react-router-dom";
import Spinner from "@/features/ui/components/Spinner";
import VideoPlayer from "@/features/video/components/VideoPlayer";
import { usePlayInfo } from "@/features/video/hooks/usePlayback";
import { errorMessage } from "@/lib/api";

const WatchPage = () => {
  const fileId = Number(useParams().fileId);
  const navigate = useNavigate();
  const { data, isLoading, error } = usePlayInfo(fileId);

  if (isLoading) {
    return (
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
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-black p-6 text-center">
        <div className="space-y-4">
          <p className="text-lg font-semibold">Can't play this</p>
          <p className="text-sm text-white/60">{errorMessage(error)}</p>
          <button onClick={() => navigate(-1)} className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return <VideoPlayer key={fileId} info={data} />;
};

export default WatchPage;
