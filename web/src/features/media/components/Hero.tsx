import { InformationCircleIcon, PlayIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "@/features/ui/components/Button";
import { formatRuntime } from "@/lib/format";
import { img } from "@/lib/images";
import type { MediaCard } from "@/lib/types";
import { titleUrl, watchUrl } from "@/lib/urls";

type Props = { items: MediaCard[] };

const ROTATE_MS = 9000;

const Hero = ({ items }: Props) => {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const item = items[index];

  useEffect(() => {
    if (items.length < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, items.length]);

  if (!item) return null;

  return (
    <section className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
      {items.map((m, i) => (
        <img
          key={m.id}
          src={img(m.backdrop_path, "original")}
          alt=""
          className={clsx(
            "absolute inset-0 size-full object-cover transition-opacity duration-1000",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/30" />

      <div key={item.id} className="relative flex h-full max-w-2xl animate-rise flex-col justify-end gap-5 px-4 pb-[14vh] sm:px-10">
        {item.logo_path ? (
          <img
            src={img(item.logo_path, "w500")}
            alt={item.title}
            className="max-h-36 w-auto max-w-[80%] self-start object-contain drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
          />
        ) : (
          <h1 className="text-4xl font-black tracking-tight text-shadow sm:text-6xl">{item.title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/80">
          {item.rating ? <span className="font-semibold text-success">{Math.round(item.rating * 10)}% match</span> : null}
          {item.year && <span>{item.year}</span>}
          {item.certification && (
            <span className="rounded border border-white/40 px-1.5 text-xs leading-5">{item.certification}</span>
          )}
          {item.kind === "movie" && item.runtime ? <span>{formatRuntime(item.runtime)}</span> : null}
          {item.genres.slice(0, 3).length > 0 && <span className="text-fg/60">{item.genres.slice(0, 3).join(" · ")}</span>}
        </div>
        {item.overview && <p className="line-clamp-3 max-w-xl text-base text-fg/85 text-shadow">{item.overview}</p>}
        <div className="flex gap-3">
          <Button variant="light" size="lg" onClick={() => navigate(watchUrl(item))}>
            <PlayIcon className="size-6" /> Play
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate(titleUrl(item))}>
            <InformationCircleIcon className="size-6" /> More info
          </Button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute right-4 bottom-[14vh] flex gap-1.5 sm:right-10">
          {items.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setIndex(i)}
              aria-label={`Show ${m.title}`}
              className={clsx("h-1 rounded-full transition-all", i === index ? "w-6 bg-fg" : "w-3 bg-fg/30 hover:bg-fg/60")}
            />
          ))}
        </div>
      )}
      <Link to={titleUrl(item)} className="sr-only">
        {item.title}
      </Link>
    </section>
  );
};

export default Hero;
