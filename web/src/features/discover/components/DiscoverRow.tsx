import MediaRow from "@/features/media/components/MediaRow";
import Skeleton from "@/features/ui/components/Skeleton";
import type { DiscoverItem } from "@/lib/types";
import DiscoverCard from "./DiscoverCard";

type Props = { title: string; items?: DiscoverItem[]; loading?: boolean };

const DiscoverRow = ({ title, items, loading }: Props) => (
  <MediaRow title={title}>
    {loading || !items
      ? Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-36 shrink-0 space-y-2 sm:w-40">
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))
      : items.map((item) => (
          <DiscoverCard key={`${item.kind}-${item.tmdb_id}`} item={item} className="w-36 shrink-0 snap-start sm:w-40" />
        ))}
  </MediaRow>
);

export default DiscoverRow;
