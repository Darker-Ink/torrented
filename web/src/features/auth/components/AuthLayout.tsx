import type { ReactNode } from "react";
import Logo from "@/features/layout/components/Logo";
import { useInstance } from "../hooks/useSession";

type Props = { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean };

const AuthLayout = ({ title, subtitle, children, wide }: Props) => {
  const { data } = useInstance();
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(160,196,235,0.16),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(160,196,235,0.08),transparent_50%)]"
      />
      <div className={`relative w-full animate-rise ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <div className="mb-8 flex items-center gap-3">
          <Logo className="size-10" />
          <span className="text-xl font-black tracking-tight">{data?.name ?? "torrented"}</span>
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
};

export default AuthLayout;
