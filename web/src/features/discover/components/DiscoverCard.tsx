import PosterCard, { AvailableBadge, PendingBadge } from "@/features/media/components/PosterCard";
import type { DiscoverItem } from "@/lib/types";
import { titleUrl } from "@/lib/urls";

type Props = { item: DiscoverItem; className?: string };

const DiscoverCard = ({ item, className }: Props) => {
  const to = titleUrl(item);
  const badge = item.available ? (
    <AvailableBadge />
  ) : item.media_id ? (
    <PendingBadge label="In library" />
  ) : item.request_status ? (
    <PendingBadge label={item.request_status === "approved" ? "Approved" : "Requested"} />
  ) : null;

  return (
    <PosterCard
      to={to}
      title={item.title}
      year={item.year}
      poster={item.poster_path}
      rating={item.rating}
      badge={badge}
      className={className}
    />
  );
};

export default DiscoverCard;
