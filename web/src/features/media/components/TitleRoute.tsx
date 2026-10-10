import { FilmIcon } from "@heroicons/react/24/outline";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import TitlePreview from "@/features/discover/components/TitlePreview";
import EmptyState from "@/features/ui/components/EmptyState";
import { ApiError, errorMessage } from "@/lib/api";
import type { MediaKind } from "@/lib/types";
import { canonicalSlug, tmdbIdFromSlug } from "@/lib/urls";
import { useTitleByTmdb } from "../hooks/queries";
import TitleSkeleton from "./TitleSkeleton";
import TitleView from "./TitleView";

type Props = { kind: MediaKind };

/** /show/:slug and /movie/:slug. Shows the library page when the title is
 * on this instance, otherwise a preview with request/add actions. */
const TitleRoute = ({ kind }: Props) => {
  const { slug } = useParams();
  const tmdbId = tmdbIdFromSlug(slug);
  const { data, isLoading, error } = useTitleByTmdb(kind, tmdbId);
  const navigate = useNavigate();
  const location = useLocation();

  // Fix up hand-typed or outdated slugs so the address bar stays shareable.
  useEffect(() => {
    if (!data) return;
    const want = canonicalSlug(data.media);
    if (slug !== want) {
      navigate({ pathname: location.pathname.replace(slug ?? "", want), search: location.search }, { replace: true });
    }
  }, [data, slug, location.pathname, location.search, navigate]);

  if (tmdbId === null) {
    return (
      <div className="pt-32">
        <EmptyState icon={FilmIcon} title="That link doesn't look right" />
      </div>
    );
  }
  if (isLoading) return <TitleSkeleton />;
  if (error instanceof ApiError && error.status === 404) return <TitlePreview kind={kind} tmdbId={tmdbId} />;
  if (error || !data) {
    return (
      <div className="pt-32">
        <EmptyState icon={FilmIcon} title="Couldn't load this title">
          {errorMessage(error)}
        </EmptyState>
      </div>
    );
  }
  return <TitleView key={data.media.id} data={data} />;
};

export default TitleRoute;
