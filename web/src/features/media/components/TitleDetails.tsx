import { ArrowTopRightOnSquareIcon, UserIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import { formatDate, formatRuntime } from "@/lib/format";
import { img } from "@/lib/images";
import type { CastMember, MediaKind } from "@/lib/types";

type Props = {
  kind: MediaKind;
  tmdbId: number;
  imdbId?: string | null;
  releaseDate?: string | null;
  runtime?: number | null;
  status?: string | null;
  rating?: number | null;
  voteCount?: number | null;
  certification?: string | null;
  language?: string | null;
  networks?: string[];
  genres?: string[];
  cast: CastMember[];
  seasons?: number;
  footer?: React.ReactNode;
};

const languageName = (code?: string | null) => {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) =>
  children ? (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="text-[15px] text-fg/90">{children}</dd>
    </div>
  ) : null;

const CastList = ({ cast }: { cast: CastMember[] }) => {
  const [all, setAll] = useState(false);
  const shown = all ? cast : cast.slice(0, 8);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg/90">Cast</h3>
      <ul className="space-y-1">
        {shown.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-white/[0.04]">
            <span className="size-11 shrink-0 overflow-hidden rounded-full bg-surface ring-1 ring-white/10">
              {c.profile_path ? (
                <img src={img(c.profile_path, "w185")} alt="" loading="lazy" className="size-full object-cover" />
              ) : (
                <UserIcon className="m-auto mt-2.5 size-6 text-subtle" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              {c.character && <span className="block truncate text-xs text-muted">{c.character}</span>}
            </span>
          </li>
        ))}
      </ul>
      {cast.length > 8 && (
        <button onClick={() => setAll((a) => !a)} className="px-1.5 text-sm font-semibold text-primary hover:underline">
          {all ? "Show less" : `Show all ${cast.length}`}
        </button>
      )}
    </div>
  );
};

const TitleDetails = (p: Props) => {
  const tmdbUrl = `https://www.themoviedb.org/${p.kind}/${p.tmdbId}`;
  const imdbUrl = p.imdbId ? `https://www.imdb.com/title/${p.imdbId}` : null;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-fg/90">About</h3>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
          <Fact label={p.kind === "tv" ? "First aired" : "Released"}>{p.releaseDate ? formatDate(p.releaseDate) : null}</Fact>
          <Fact label={p.kind === "tv" ? "Episode length" : "Runtime"}>{formatRuntime(p.runtime)}</Fact>
          <Fact label="Seasons">{p.kind === "tv" && p.seasons ? p.seasons : null}</Fact>
          <Fact label="Status">{p.status}</Fact>
          <Fact label="Rating">
            {p.rating ? (
              <>
                ★ {p.rating.toFixed(1)}
                {p.voteCount ? <span className="text-muted"> · {p.voteCount.toLocaleString()} votes</span> : null}
              </>
            ) : null}
          </Fact>
          <Fact label="Certification">{p.certification}</Fact>
          <Fact label="Language">{languageName(p.language)}</Fact>
          <Fact label={p.kind === "tv" ? "Network" : "Studio"}>{p.networks?.length ? p.networks.join(", ") : null}</Fact>
        </dl>
        {p.genres && p.genres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {p.genres.map((g) => (
              <span key={g} className="rounded-full bg-white/[0.06] px-3 py-1 text-sm text-fg/80 ring-1 ring-white/[0.08]">
                {g}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <a
            href={tmdbUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted ring-1 ring-white/10 transition hover:text-fg hover:ring-white/25"
          >
            TMDB <ArrowTopRightOnSquareIcon className="size-3.5" />
          </a>
          {imdbUrl && (
            <a
              href={imdbUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted ring-1 ring-white/10 transition hover:text-fg hover:ring-white/25"
            >
              IMDb <ArrowTopRightOnSquareIcon className="size-3.5" />
            </a>
          )}
        </div>
        {p.footer}
      </div>
      {p.cast.length > 0 && (
        <aside className="lg:border-l lg:border-white/[0.06] lg:pl-8">
          <CastList cast={p.cast} />
        </aside>
      )}
    </div>
  );
};

export default TitleDetails;
