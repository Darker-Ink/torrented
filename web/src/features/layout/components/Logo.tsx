import clsx from "clsx";

const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 64 64" className={clsx("size-8", className)} aria-hidden>
    <rect width="64" height="64" rx="14" fill="#a0c4eb" />
    <path d="M22 18h20v6h-7v24h-6V24h-7z" fill="#151617" />
    <circle cx="46" cy="44" r="4" fill="#151617" />
  </svg>
);

export default Logo;
