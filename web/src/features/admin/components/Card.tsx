import clsx from "clsx";
import type { ReactNode } from "react";

type Props = { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean };

const Card = ({ title, actions, children, className, padded = true }: Props) => (
  <section className={clsx("rounded-xl border border-line bg-bg-raised", className)}>
    {(title || actions) && (
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        {title && <h2 className="text-sm font-semibold">{title}</h2>}
        {actions}
      </div>
    )}
    <div className={clsx(padded && "p-4")}>{children}</div>
  </section>
);

export default Card;
