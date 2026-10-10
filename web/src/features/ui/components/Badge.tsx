import clsx from "clsx";
import type { ReactNode } from "react";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-white/8 text-muted ring-white/10",
  primary: "bg-primary-muted text-primary ring-primary/25",
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/12 text-warning ring-warning/25",
  danger: "bg-danger/12 text-danger ring-danger/25",
};

type Props = { tone?: Tone; children: ReactNode; className?: string };

const Badge = ({ tone = "neutral", children, className }: Props) => (
  <span
    className={clsx(
      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset",
      tones[tone],
      className,
    )}
  >
    {children}
  </span>
);

export default Badge;
