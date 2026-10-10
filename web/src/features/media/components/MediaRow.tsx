import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useRef, useState, type ReactNode } from "react";

type Props = { title: ReactNode; children: ReactNode; action?: ReactNode };

/** A horizontally scrolling row with paging arrows on hover. */
const MediaRow = ({ title, children, action }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
  };

  const arrow = "absolute top-0 bottom-0 z-10 hidden w-10 items-center justify-center bg-bg/70 text-fg opacity-0 transition group-hover/row:opacity-100 hover:bg-bg/90 sm:flex sm:w-12";

  return (
    <section className="group/row relative space-y-2">
      <div className="flex items-baseline justify-between gap-4 px-4 sm:px-10">
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
        {action}
      </div>
      <div className="relative">
        {!edges.start && (
          <button className={clsx(arrow, "left-0 rounded-r-md")} onClick={() => page(-1)} aria-label="Scroll left">
            <ChevronLeftIcon className="size-8" />
          </button>
        )}
        <div
          ref={ref}
          onScroll={update}
          className="scrollbar-none flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 py-3 sm:scroll-px-10 sm:gap-3 sm:px-10"
        >
          {children}
        </div>
        {!edges.end && (
          <button className={clsx(arrow, "right-0 rounded-l-md")} onClick={() => page(1)} aria-label="Scroll right">
            <ChevronRightIcon className="size-8" />
          </button>
        )}
      </div>
    </section>
  );
};

export default MediaRow;
