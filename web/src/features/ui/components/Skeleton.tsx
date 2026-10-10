import clsx from "clsx";

const Skeleton = ({ className }: { className?: string }) => (
  <div className={clsx("animate-pulse rounded-md bg-white/[0.06]", className)} />
);

export default Skeleton;
