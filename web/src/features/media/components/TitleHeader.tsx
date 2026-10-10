import type { ReactNode } from "react";
import { img } from "@/lib/images";

type Props = {
  title: string;
  backdrop?: string | null;
  logo?: string | null;
  tagline?: string | null;
  overview?: string | null;
  meta?: ReactNode[];
  genres?: string[];
  children?: ReactNode;
  /** Short status line under the actions. */
  note?: ReactNode;
};

const TitleHeader = ({ title, backdrop, logo, tagline, overview, meta = [], genres = [], children, note }: Props) => (
  <section className="relative min-h-[72vh] w-full overflow-hidden">
    {backdrop && <img src={img(backdrop, "original")} alt="" className="absolute inset-0 size-full object-cover" />}
    <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/75 to-bg/10" />
    <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/10 to-bg/40" />

    <div className="relative flex min-h-[72vh] max-w-3xl animate-rise flex-col justify-end gap-5 px-4 pt-28 pb-12 sm:px-10">
      {logo ? (
        <img
          src={img(logo, "w500")}
          alt={title}
          className="max-h-40 w-auto max-w-[85%] self-start object-contain drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
        />
      ) : (
        <h1 className="text-4xl font-black tracking-tight text-shadow sm:text-6xl">{title}</h1>
      )}
      {meta.filter(Boolean).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/80">
          {meta.filter(Boolean).map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}
      {tagline && <p className="text-lg text-fg/70 italic">{tagline}</p>}
      {overview && <p className="max-w-2xl text-base leading-relaxed text-fg/85">{overview}</p>}
      {genres.length > 0 && <p className="text-sm text-muted">{genres.join(" · ")}</p>}
      {children && <div className="flex flex-wrap items-center gap-3 pt-1">{children}</div>}
      {note && <div className="-mt-1 flex items-center gap-2 text-sm text-fg/60">{note}</div>}
    </div>
  </section>
);

export default TitleHeader;
