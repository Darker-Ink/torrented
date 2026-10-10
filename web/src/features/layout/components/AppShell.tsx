import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "./Navbar";

const BARE = [/^\/watch\//, /^\/login/, /^\/register/, /^\/setup/];

type Props = { children: ReactNode };

const AppShell = ({ children }: Props) => {
  const { pathname } = useLocation();
  const bare = BARE.some((r) => r.test(pathname));
  if (bare) return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main className="flex-1 pb-16">{children}</main>
    </div>
  );
};

export default AppShell;
