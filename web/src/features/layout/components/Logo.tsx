import clsx from "clsx";
import { useId } from "react";

/** A play button whose corners are peers, linked to a few more peers around
 * it: streaming straight from the swarm. */
const Logo = ({ className }: { className?: string }) => {
  const gradient = useId();
  return (
    <svg viewBox="0 0 64 64" className={clsx("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9e0f8" />
          <stop offset="1" stopColor="#84ade0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradient})`} />
      <path
        d="M10.5 22.5 L22 18 M10.5 41.5 L22 46 M10.5 22.5 V41.5 M50 32 L54.5 15.5 M50 32 L54.5 48.5"
        stroke="#151617"
        strokeOpacity=".45"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M22 18 V46 L50 32 Z" fill="#151617" stroke="#151617" strokeWidth="8" strokeLinejoin="round" />
      <circle cx="10.5" cy="22.5" r="3.2" fill="#151617" />
      <circle cx="10.5" cy="41.5" r="3.2" fill="#151617" />
      <circle cx="54.5" cy="15.5" r="2.6" fill="#151617" />
      <circle cx="54.5" cy="48.5" r="2.6" fill="#151617" />
      <circle cx="22" cy="18" r="2.4" fill="#a0c4eb" />
      <circle cx="22" cy="46" r="2.4" fill="#a0c4eb" />
      <circle cx="50" cy="32" r="2.4" fill="#a0c4eb" />
    </svg>
  );
};

export default Logo;
