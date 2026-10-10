import clsx from "clsx";

/** Base placeholder block with a soft shimmer. */
const Skeleton = ({ className }: { className?: string }) => <div className={clsx("shimmer rounded-md", className)} />;

/** A few lines of placeholder text; the last one is shorter. */
export const SkeletonText = ({ lines = 3, className }: { lines?: number; className?: string }) => (
  <div className={clsx("space-y-2", className)}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={clsx("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")} />
    ))}
  </div>
);

export const posterGrid =
  "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8";

/** Poster grid placeholder used by library, search and discover pages. */
export const PosterGridSkeleton = ({ count = 16 }: { count?: number }) => (
  <div className={posterGrid}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="space-y-2">
        <Skeleton className="aspect-[2/3] w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    ))}
  </div>
);

/** Horizontal row placeholder: landscape cards or posters. */
export const RowSkeleton = ({ variant = "landscape", titleWidth = "w-48" }: { variant?: "landscape" | "poster"; titleWidth?: string }) => (
  <div className="space-y-3">
    <div className="px-4 sm:px-10">
      <Skeleton className={clsx("h-6", titleWidth)} />
    </div>
    <div className="flex gap-2 overflow-hidden px-4 py-3 sm:gap-3 sm:px-10">
      {Array.from({ length: 8 }).map((_, i) =>
        variant === "landscape" ? (
          <Skeleton key={i} className="aspect-video w-64 shrink-0 sm:w-72" />
        ) : (
          <div key={i} className="w-36 shrink-0 space-y-2 sm:w-40">
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
        ),
      )}
    </div>
  </div>
);

/** Stacked cards, e.g. requests or torrent sources. */
export const CardListSkeleton = ({ count = 3, media = false, columns = 1 }: { count?: number; media?: boolean; columns?: 1 | 2 }) => (
  <div className={clsx("grid gap-3", columns === 2 && "lg:grid-cols-2")}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="flex gap-4 rounded-2xl p-4 ring-1 ring-white/[0.06]">
        <Skeleton className={media ? "aspect-[2/3] w-20 shrink-0 sm:w-24" : "size-12 shrink-0 rounded-xl"} />
        <div className="flex-1 space-y-2.5 py-1">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
          {media && <Skeleton className="mt-4 h-8 w-48" />}
        </div>
      </div>
    ))}
  </div>
);

/** Table placeholder with a header row. */
export const TableSkeleton = ({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) => (
  <div className="divide-y divide-white/[0.05]">
    <div className="flex gap-6 px-4 py-3">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-20" />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex items-center gap-6 px-4 py-3.5">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: cols - 1 }).map((_, c) => (
          <Skeleton key={c} className={clsx("h-3.5", c === 0 ? "w-40" : "w-24")} />
        ))}
      </div>
    ))}
  </div>
);

export const StatCardsSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="space-y-3 rounded-xl p-4 ring-1 ring-white/[0.06]">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
  </div>
);

export default Skeleton;
