import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import DiscoverCard from "@/features/discover/components/DiscoverCard";
import { useDiscoverSearch } from "@/features/discover/hooks/queries";
import MediaGrid from "@/features/media/components/MediaGrid";
import { useLibrary } from "@/features/media/hooks/queries";
import { PosterGridSkeleton } from "@/features/ui/components/Skeleton";
import { can, PERM } from "@/lib/permissions";

const SearchPage = () => {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  const user = useUser();
  const canDiscover = can(user, PERM.REQUEST) || can(user, PERM.ADD_MEDIA);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      setParams(query ? { q: query } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [query, setParams]);

  const active = debounced.trim().length > 1;
  const library = useLibrary({ q: debounced, available: "all", limit: 48 }, active);
  const remote = useDiscoverSearch(canDiscover ? debounced : "");
  const outside = (remote.data?.results ?? []).filter((r) => !r.media_id);

  return (
    <div className="space-y-10 px-4 pt-24 pb-10 sm:px-10">
      <div className="relative max-w-2xl">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Titles, people, genres…"
          className="h-14 w-full rounded-lg border border-line bg-white/[0.05] pr-4 pl-13 text-lg placeholder:text-subtle focus:border-primary/60 focus:outline-none"
        />
      </div>

      {active && (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-bold">In your library</h2>
            {library.isLoading ? (
              <PosterGridSkeleton count={8} />
            ) : library.data && library.data.items.length > 0 ? (
              <MediaGrid items={library.data.items} />
            ) : (
              <p className="text-sm text-muted">Nothing in the library matches “{debounced}”.</p>
            )}
          </section>

          {canDiscover && (
            <section className="space-y-4">
              <h2 className="text-xl font-bold">More to add</h2>
              {remote.isLoading ? (
                <PosterGridSkeleton count={8} />
              ) : outside.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                  {outside.map((item) => (
                    <DiscoverCard key={`${item.kind}-${item.tmdb_id}`} item={item} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">No other matches on TMDB.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default SearchPage;
