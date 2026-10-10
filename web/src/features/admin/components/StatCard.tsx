import type { ReactNode } from "react";

type Props = { label: string; value: ReactNode; hint?: ReactNode };

const StatCard = ({ label, value, hint }: Props) => (
  <div className="rounded-xl border border-line bg-bg-raised p-4">
    <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
    <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
  </div>
);

export default StatCard;
