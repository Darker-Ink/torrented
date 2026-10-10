import Skeleton from "@/features/ui/components/Skeleton";

/** Placeholder matching the title page layout. */
const TitleSkeleton = () => (
  <div className="space-y-6 pb-12">
    <section className="relative min-h-[72vh] overflow-hidden bg-gradient-to-b from-white/[0.03] to-transparent">
      <div className="flex min-h-[72vh] max-w-3xl flex-col justify-end gap-5 px-4 pt-28 pb-12 sm:px-10">
        <Skeleton className="h-20 w-2/3 sm:h-28" />
        <div className="flex gap-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="size-12" />
          <Skeleton className="h-12 w-28" />
        </div>
      </div>
    </section>
    <div className="space-y-8 px-4 sm:px-10">
      <div className="flex gap-6 border-b border-white/[0.08] pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="hidden h-6 w-8 sm:block" />
          <Skeleton className="aspect-video w-36 shrink-0 sm:w-44" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default TitleSkeleton;
