import { FilmIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import ContinueCard from "@/features/media/components/ContinueCard";
import Hero from "@/features/media/components/Hero";
import MediaCard from "@/features/media/components/MediaCard";
import MediaRow from "@/features/media/components/MediaRow";
import { useHome } from "@/features/media/hooks/queries";
import Button from "@/features/ui/components/Button";
import EmptyState from "@/features/ui/components/EmptyState";
import Skeleton from "@/features/ui/components/Skeleton";
import { can, PERM } from "@/lib/permissions";

const HomeSkeleton = () => (
  <div className="space-y-10">
    <Skeleton className="h-[70vh] w-full rounded-none" />
    {[0, 1].map((i) => (
      <div key={i} className="space-y-3 px-4 sm:px-10">
        <Skeleton className="h-6 w-48" />
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3, 4].map((j) => (
            <Skeleton key={j} className="aspect-video w-72 shrink-0" />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const HomePage = () => {
  const { data, isLoading } = useHome();
  const user = useUser();

  if (isLoading || !data) return <HomeSkeleton />;

  const empty = data.rows.length === 0;
  if (empty) {
    return (
      <div className="pt-32">
        <EmptyState
          icon={FilmIcon}
          title="Your library is empty"
          action={
            can(user, PERM.ADD_MEDIA) || can(user, PERM.REQUEST) ? (
              <Link to="/discover">
                <Button variant="primary">Find something to watch</Button>
              </Link>
            ) : undefined
          }
        >
          {can(user, PERM.ADD_MEDIA)
            ? "Add movies and shows from Discover, then attach a torrent to start streaming."
            : "Nothing has been added yet. Check back soon, or request something from Discover."}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {data.hero.length > 0 ? <Hero items={data.hero} /> : <div className="h-24" />}
      <div className={data.hero.length > 0 ? "relative z-10 -mt-[10vh] space-y-8" : "space-y-8"}>
        {data.rows.map((row) => (
          <MediaRow key={row.id} title={row.title}>
            {row.type === "continue"
              ? row.items.map((item) => <ContinueCard key={`${item.media.kind}-${item.media.id}`} item={item} />)
              : row.items.map((item) => <MediaCard key={item.id} item={item} />)}
          </MediaRow>
        ))}
      </div>
    </div>
  );
};

export default HomePage;
