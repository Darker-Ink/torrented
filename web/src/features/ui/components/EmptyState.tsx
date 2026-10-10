import clsx from "clsx";
import type { ComponentType, ReactNode, SVGProps } from "react";

type Props = {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

const EmptyState = ({ icon: Icon, title, children, action, className }: Props) => (
  <div className={clsx("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
    {Icon && (
      <div className="grid size-14 place-items-center rounded-2xl bg-white/5 ring-1 ring-line">
        <Icon className="size-7 text-muted" />
      </div>
    )}
    <h3 className="text-base font-semibold">{title}</h3>
    {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    {action && <div className="pt-2">{action}</div>}
  </div>
);

export default EmptyState;
