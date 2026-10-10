import { PlusIcon } from "@heroicons/react/24/solid";
import { InformationCircleIcon } from "@heroicons/react/20/solid";
import { FilmIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/hooks/useSession";
import SectionTabs from "@/features/media/components/SectionTabs";
import TitleDetails from "@/features/media/components/TitleDetails";
import TitleHeader from "@/features/media/components/TitleHeader";
import TitleSkeleton from "@/features/media/components/TitleSkeleton";
import TrailerDialog from "@/features/media/components/TrailerDialog";
import Button from "@/features/ui/components/Button";
import EmptyState from "@/features/ui/components/EmptyState";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { formatRuntime } from "@/lib/format";
import { img } from "@/lib/images";
import { can, PERM } from "@/lib/permissions";
import type { MediaKind } from "@/lib/types";
import { useAddToLibrary, useDiscoverTitle } from "../hooks/queries";
import RequestDialog from "./RequestDialog";

type Props = { kind: MediaKind; tmdbId: number };

/** Title page for something that isn't in the library yet. */
const TitlePreview = ({ kind, tmdbId: id }: Props) => {
  const { data, isLoading, error } = useDiscoverTitle(kind, id);
  const user = useUser();
  const client = useQueryClient();
  const add = useAddToLibrary();
  const [requesting, setRequesting] = useState(false);
  const [trailer, setTrailer] = useState(false);

  if (isLoading) return <TitleSkeleton />;
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
      await add.mutateAsync({ kind, tmdb_id: id });
      toast.success(`${data.title} added to the library`);
      // The route swaps this preview for the full title page.
      await client.invalidateQueries({ queryKey: ["title", kind, id] });
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
        note={
          <>
            <InformationCircleIcon className={`size-4 ${data.request ? "text-warning" : "text-fg/50"}`} />
            {data.request
              ? data.request.status === "approved"
                ? "Approved. Waiting for someone to add a torrent."
                : "Requested. Waiting for approval."
              : "Not in the library yet."}
          </>
        }
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
        {can(user, PERM.ADD_MEDIA) ? (
          <Button variant="primary" size="lg" onClick={addToLibrary} loading={add.isPending}>
            <PlusIcon className="size-5" /> Add to library
          </Button>
        ) : !data.request && can(user, PERM.REQUEST) ? (
          <Button variant="primary" size="lg" onClick={() => setRequesting(true)}>
            <PlusIcon className="size-5" /> Request
          </Button>
        ) : null}
        {data.trailer_key && (
          <Button variant="secondary" size="lg" onClick={() => setTrailer(true)}>
            Trailer
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

export default TitlePreview;
