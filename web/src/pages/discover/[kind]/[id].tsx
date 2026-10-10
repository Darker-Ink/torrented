import { PlayIcon, PlusIcon } from "@heroicons/react/24/solid";
import { FilmIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import RequestDialog from "@/features/discover/components/RequestDialog";
import { useAddToLibrary, useDiscoverTitle } from "@/features/discover/hooks/queries";
import SectionTabs from "@/features/media/components/SectionTabs";
import TitleDetails from "@/features/media/components/TitleDetails";
import TitleHeader from "@/features/media/components/TitleHeader";
import TrailerDialog from "@/features/media/components/TrailerDialog";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import EmptyState from "@/features/ui/components/EmptyState";
import Spinner from "@/features/ui/components/Spinner";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { formatRuntime } from "@/lib/format";
import { img } from "@/lib/images";
import { can, PERM } from "@/lib/permissions";
import type { MediaKind } from "@/lib/types";

const DiscoverTitlePage = () => {
  const params = useParams();
  const kind = params.kind as MediaKind;
  const id = Number(params.id);
  const { data, isLoading, error } = useDiscoverTitle(kind, id);
  const user = useUser();
  const navigate = useNavigate();
  const add = useAddToLibrary();
  const [requesting, setRequesting] = useState(false);
  const [trailer, setTrailer] = useState(false);

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
        <EmptyState icon={FilmIcon} title="Couldn't load this title">
          {errorMessage(error)}
        </EmptyState>
      </div>
    );
  }

  const addToLibrary = async () => {
    try {
      const res = await add.mutateAsync({ kind, tmdb_id: id });
      toast.success(`${data.title} added to the library`);
      navigate(`/title/${res.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const seasons = data.seasons.filter((s) => s.season_number > 0).length;

  return (
    <div className="space-y-6 pb-12">
      <TitleHeader
        title={data.title}
        backdrop={data.backdrop_path}
        logo={data.logo_path}
        tagline={data.tagline}
        overview={data.overview}
        genres={data.genres}
        meta={[
          data.rating ? <span className="font-semibold text-success">★ {data.rating.toFixed(1)}</span> : null,
          data.year,
          data.certification ? (
            <span className="rounded border border-white/40 px-1.5 text-xs leading-5">{data.certification}</span>
          ) : null,
          kind === "movie" ? formatRuntime(data.runtime) : seasons ? `${seasons} season${seasons > 1 ? "s" : ""}` : null,
          data.status,
        ]}
      >
        {data.media_id ? (
          <Button variant="light" size="lg" onClick={() => navigate(`/title/${data.media_id}`)}>
            <PlayIcon className="size-6" /> Open in library
          </Button>
        ) : can(user, PERM.ADD_MEDIA) ? (
          <Button variant="primary" size="lg" onClick={addToLibrary} loading={add.isPending}>
            <PlusIcon className="size-5" /> Add to library
          </Button>
        ) : data.request ? (
          <Badge tone="warning" className="h-10 px-3 text-sm">
            {data.request.status === "approved" ? "Approved — waiting for a torrent" : "Requested"}
          </Badge>
        ) : can(user, PERM.REQUEST) ? (
          <Button variant="primary" size="lg" onClick={() => setRequesting(true)}>
            <PlusIcon className="size-5" /> Request
          </Button>
        ) : null}
        {data.trailer_key && (
          <Button variant="secondary" size="lg" onClick={() => setTrailer(true)}>
            Watch trailer
          </Button>
        )}
      </TitleHeader>

      <SectionTabs
        sections={[
          {
            key: "details",
            label: "Details",
            content: (
              <TitleDetails
                kind={kind}
                tmdbId={data.tmdb_id}
                releaseDate={data.release_date}
                runtime={data.runtime}
                status={data.status}
                rating={data.rating}
                certification={data.certification}
                networks={data.networks}
                genres={data.genres}
                cast={data.cast}
                seasons={seasons}
              />
            ),
          },
          ...(kind === "tv" && data.seasons.length > 0
            ? [
                {
                  key: "seasons",
                  label: "Seasons",
                  count: seasons,
                  content: (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {data.seasons.map((s) => (
                        <div key={s.season_number} className="flex gap-4 rounded-2xl bg-white/[0.025] p-3 ring-1 ring-white/[0.07]">
                          <div className="aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-lg bg-surface">
                            {s.poster_path && <img src={img(s.poster_path, "w185")} alt="" className="size-full object-cover" />}
                          </div>
                          <div className="min-w-0 py-1">
                            <p className="truncate font-semibold">{s.name ?? `Season ${s.season_number}`}</p>
                            <p className="text-sm text-muted">
                              {s.episode_count} episodes{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <RequestDialog open={requesting} onClose={() => setRequesting(false)} title={data} />
      {data.trailer_key && (
        <TrailerDialog open={trailer} onClose={() => setTrailer(false)} youtubeKey={data.trailer_key} title={data.title} />
      )}
    </div>
  );
};

export default DiscoverTitlePage;
