import { BookmarkIcon } from "@heroicons/react/24/outline";
import MediaGrid from "@/features/media/components/MediaGrid";
import { useWatchlist } from "@/features/media/hooks/queries";
import EmptyState from "@/features/ui/components/EmptyState";
import Spinner from "@/features/ui/components/Spinner";

const MyListPage = () => {
  const { data, isLoading } = useWatchlist();
  return (
    <div className="space-y-8 px-4 pt-24 pb-10 sm:px-10">
      <h1 className="text-3xl font-black tracking-tight">My List</h1>
      {isLoading ? (
        <Spinner />
      ) : data && data.length > 0 ? (
        <MediaGrid items={data} />
      ) : (
        <EmptyState icon={BookmarkIcon} title="Your list is empty">
          Use the + button on any title to save it for later.
        </EmptyState>
      )}
    </div>
  );
};

export default MyListPage;
