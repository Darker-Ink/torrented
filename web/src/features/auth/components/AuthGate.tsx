import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Spinner from "@/features/ui/components/Spinner";
import { useInstance } from "../hooks/useSession";

const PUBLIC = ["/login", "/register", "/setup"];

type Props = { children: ReactNode };

/** Sends visitors to setup or login when needed, before rendering pages. */
const AuthGate = ({ children }: Props) => {
  const { data, isLoading, isError, refetch } = useInstance();
  const location = useLocation();
  const navigate = useNavigate();
  const isPublic = PUBLIC.includes(location.pathname);

  useEffect(() => {
    if (!data) return;
    if (data.setup_required && location.pathname !== "/setup") {
      navigate("/setup", { replace: true });
    } else if (!data.setup_required && !data.user && !isPublic) {
      const next = location.pathname + location.search;
      navigate(`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true });
    } else if (data.user && isPublic) {
      navigate("/", { replace: true });
    }
  }, [data, isPublic, location.pathname, location.search, navigate]);

  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-lg font-semibold">Can't reach the server</p>
          <p className="text-muted">Make sure torrented is running, then try again.</p>
          <button
            onClick={() => refetch()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const blocked = (data.setup_required && location.pathname !== "/setup") || (!data.user && !isPublic && !data.setup_required);
  if (blocked) return null;

  return <>{children}</>;
};

export default AuthGate;
