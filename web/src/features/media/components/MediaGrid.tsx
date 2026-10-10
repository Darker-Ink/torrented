import type { MediaCard } from "@/lib/types";
import PosterCard from "./PosterCard";

type Props = { items: MediaCard[] };

const MediaGrid = ({ items }: Props) => (
  <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
    {items.map((m) => (
      <PosterCard
        key={m.id}
        to={`/title/${m.id}`}
        title={m.title}
        year={m.year}
        poster={m.poster_path}
        rating={m.rating}
        dimmed={!m.available}
      />
    ))}
  </div>
);

export default MediaGrid;
