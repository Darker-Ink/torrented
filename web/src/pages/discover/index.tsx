import { Radio, RadioGroup } from "@headlessui/react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DiscoverCard from "@/features/discover/components/DiscoverCard";
import DiscoverRow from "@/features/discover/components/DiscoverRow";
import {
  useDiscoverGenre,
  useDiscoverGenres,
  useDiscoverList,
  useDiscoverSearch,
} from "@/features/discover/hooks/queries";
import { Input } from "@/features/ui/components/Field";
import Select from "@/features/ui/components/Select";
import { PosterGridSkeleton } from "@/features/ui/components/Skeleton";
import type { MediaKind } from "@/lib/types";

const useDebounced = <T,>(value: T, ms = 350) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

const Rows = ({ kind }: { kind: MediaKind }) => {
  const trending = useDiscoverList(kind, "trending");
  const popular = useDiscoverList(kind, "popular");
  const top = useDiscoverList(kind, "top_rated");
  const upcoming = useDiscoverList(kind, kind === "movie" ? "upcoming" : "on_the_air");
  const { data: genres } = useDiscoverGenres(kind);
  const [genre, setGenre] = useState<number | null>(null);
  const byGenre = useDiscoverGenre(kind, genre);

  return (
    <div className="space-y-8">
      <DiscoverRow title="Trending this week" items={trending.data?.results} loading={trending.isLoading} />
      <DiscoverRow title="Popular" items={popular.data?.results} loading={popular.isLoading} />
      <DiscoverRow
        title={kind === "movie" ? "Coming soon" : "Currently airing"}
        items={upcoming.data?.results}
        loading={upcoming.isLoading}
      />
      <DiscoverRow title="All-time favourites" items={top.data?.results} loading={top.isLoading} />
      <div className="space-y-2">
        <div className="flex items-center gap-3 px-4 sm:px-10">
          <span className="text-sm text-muted">Browse by genre</span>
          <Select
            className="w-52"
            value={genre}
            onChange={setGenre}
            placeholder="Pick a genre"
            options={(genres ?? []).map((g) => ({ value: g.id as number | null, label: g.name }))}
          />
        </div>
        {genre !== null && (
          <DiscoverRow
            title={genres?.find((g) => g.id === genre)?.name ?? "Genre"}
            items={byGenre.data?.results}
            loading={byGenre.isLoading}
          />
        )}
      </div>
    </div>
  );
};

const DiscoverPage = () => {
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as MediaKind) || "movie";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const debounced = useDebounced(query);
  const search = useDiscoverSearch(debounced, kind);

  const setKind = (k: MediaKind) => {
    const next = new URLSearchParams(params);
    next.set("kind", k);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-8 pt-24 pb-10">
      <div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-10">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Discover</h1>
          <p className="text-sm text-muted">Find something new and add it to the library or request it.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <RadioGroup value={kind} onChange={setKind} className="flex rounded-lg bg-white/5 p-1">
            {(["movie", "tv"] as const).map((k) => (
              <Radio
                key={k}
                value={k}
                className={clsx(
                  "cursor-pointer rounded-md px-4 py-1.5 text-sm font-semibold text-muted transition data-[checked]:bg-white/10 data-[checked]:text-fg",
                )}
              >
                {k === "movie" ? "Movies" : "Shows"}
              </Radio>
            ))}
          </RadioGroup>
          <div className="relative sm:w-80">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kind === "movie" ? "movies" : "shows"}…`}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {debounced.trim().length > 1 ? (
        <div className="px-4 sm:px-10">
          {search.isLoading ? (
            <PosterGridSkeleton />
          ) : search.data && search.data.results.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
              {search.data.results.map((item) => (
                <DiscoverCard key={`${item.kind}-${item.tmdb_id}`} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-muted">No results for “{debounced}”.</p>
          )}
        </div>
      ) : (
        <Rows key={kind} kind={kind} />
      )}
    </div>
  );
};

export default DiscoverPage;
