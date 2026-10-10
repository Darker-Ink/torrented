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
      <main className="flex-1">{children}</main>
      <footer className="px-4 py-10 text-center text-xs text-subtle sm:px-10">
        Streams come straight from the swarm — nothing is kept once you stop watching.
      </footer>
    </div>
  );
};

export default AppShell;
