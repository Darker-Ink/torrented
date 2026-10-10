import { RectangleStackIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useUser } from "@/features/auth/hooks/useSession";
import MediaGrid from "@/features/media/components/MediaGrid";
import { useGenres, useLibrary, type LibraryParams } from "@/features/media/hooks/queries";
import Button from "@/features/ui/components/Button";
import EmptyState from "@/features/ui/components/EmptyState";
import Select from "@/features/ui/components/Select";
import { PosterGridSkeleton } from "@/features/ui/components/Skeleton";
import { can, PERM } from "@/lib/permissions";
import type { MediaKind } from "@/lib/types";

type Props = { kind: MediaKind; title: string };

const PAGE = 60;

const LibraryBrowser = ({ kind, title }: Props) => {
  const user = useUser();
  const [genre, setGenre] = useState<string>("");
  const [sort, setSort] = useState<NonNullable<LibraryParams["sort"]>>("added");
  const [availability, setAvailability] = useState<NonNullable<LibraryParams["available"]>>("available");
  const [limit, setLimit] = useState(PAGE);
  const { data: genres } = useGenres();
  const { data, isLoading, isFetching } = useLibrary({ kind, genre, sort, available: availability, limit });

  return (
    <div className="space-y-8 px-4 pt-24 pb-10 sm:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{title}</h1>
          {data && <p className="text-sm text-muted">{data.total} titles</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-44"
            value={genre}
            onChange={setGenre}
            options={[{ value: "", label: "All genres" }, ...(genres ?? []).map((g) => ({ value: g, label: g }))]}
          />
          <Select
            className="w-40"
            value={sort}
            onChange={setSort}
            options={[
              { value: "added", label: "Recently added" },
              { value: "title", label: "A–Z" },
              { value: "year", label: "Release year" },
              { value: "rating", label: "Top rated" },
            ]}
          />
          {can(user, PERM.ADD_TORRENTS) && (
            <Select
              className="w-48"
              value={availability}
              onChange={setAvailability}
              options={[
                { value: "available", label: "Ready to watch" },
                { value: "missing", label: "Waiting for a torrent" },
                { value: "all", label: "Everything" },
              ]}
            />
          )}
        </div>
      </div>

      {isLoading ? (
        <PosterGridSkeleton />
      ) : data && data.items.length > 0 ? (
        <>
          <MediaGrid items={data.items} />
          {data.items.length < data.total && (
            <div className="flex justify-center">
              <Button onClick={() => setLimit((l) => l + PAGE)} loading={isFetching}>
                Load more
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState icon={RectangleStackIcon} title="Nothing here yet">
          {genre ? "No titles match this genre." : "Add some titles from Discover to fill this page."}
        </EmptyState>
      )}
    </div>
  );
};

export default LibraryBrowser;
