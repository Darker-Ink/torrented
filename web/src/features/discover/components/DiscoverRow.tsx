import MediaRow from "@/features/media/components/MediaRow";
import Skeleton from "@/features/ui/components/Skeleton";
import type { DiscoverItem } from "@/lib/types";
import DiscoverCard from "./DiscoverCard";

type Props = { title: string; items?: DiscoverItem[]; loading?: boolean };

const DiscoverRow = ({ title, items, loading }: Props) => (
  <MediaRow title={title}>
    {loading || !items
      ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] w-36 shrink-0 sm:w-40" />)
      : items.map((item) => (
          <DiscoverCard key={`${item.kind}-${item.tmdb_id}`} item={item} className="w-36 shrink-0 snap-start sm:w-40" />
        ))}
  </MediaRow>
);

export default DiscoverRow;
