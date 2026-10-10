import clsx from "clsx";
import { useId } from "react";

/** A play button assembled from torrent pieces, the last one still
 * streaming in. */
const Logo = ({ className }: { className?: string }) => {
  const clip = useId();
  return (
    <svg viewBox="0 0 64 64" className={clsx("size-8 text-primary", className)} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <path d="M20.5 11.2c-2.6-1.6-6 .3-6 3.4v34.8c0 3.1 3.4 5 6 3.4l28.3-17.4c2.5-1.6 2.5-5.2 0-6.8z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`} fill="currentColor">
        <rect width="25" height="64" />
        <rect x="28.5" width="9" height="64" />
        <rect x="41" width="30" height="64" opacity=".45" />
      </g>
    </svg>
  );
};

export default Logo;
