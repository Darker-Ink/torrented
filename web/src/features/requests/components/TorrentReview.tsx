import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import Spinner from "@/features/ui/components/Spinner";
import { formatBytes, timeAgo } from "@/lib/format";
import type { MediaRequest, ReviewVerdict, TorrentReview as Review } from "@/lib/types";

const icons: Record<ReviewVerdict, { icon: typeof CheckCircleIcon; className: string }> = {
  pass: { icon: CheckCircleIcon, className: "text-success" },
  warn: { icon: ExclamationTriangleIcon, className: "text-warning" },
  fail: { icon: XCircleIcon, className: "text-danger" },
};

const summary: Record<ReviewVerdict, string> = {
  pass: "Looks good",
  warn: "Worth a look",
  fail: "Problems found",
};

const isReview = (r: MediaRequest["review"]): r is Review => !!r && "checks" in r;

type Props = {
  request: MediaRequest;
  onRecheck?: () => void;
  rechecking?: boolean;
};

/** The automatic review of a torrent suggested with a request. */
const TorrentReview = ({ request, onRecheck, rechecking }: Props) => {
  const { review, review_status: status } = request;
  const checking = status === "checking";
  const verdict = isReview(review) ? review.verdict : null;
  const tone = checking ? null : status === "error" ? "fail" : verdict;

  return (
    <div className="overflow-hidden rounded-lg bg-black/25 ring-1 ring-white/[0.07]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        {checking ? (
          <Spinner size="sm" />
        ) : (
          tone &&
          (() => {
            const { icon: Icon, className } = icons[tone];
            return <Icon className={clsx("size-4 shrink-0", className)} />;
          })()
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-fg/90" title={request.torrent_name ?? undefined}>
            {request.torrent_name ?? "Suggested torrent"}
          </p>
          <p className="text-[11px] text-muted">
            {checking
              ? "Checking the torrent…"
              : status === "error"
                ? "Couldn't check it"
                : verdict
                  ? [
                      summary[verdict],
                      isReview(review) && formatBytes(review.size),
                      request.torrent_attached
                        ? "attached"
                        : request.status !== "pending" && request.status !== "declined" && verdict === "fail"
                          ? "not attached"
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null}
          </p>
        </div>
        {onRecheck && !checking && !request.torrent_attached && (
          <button
            type="button"
            onClick={onRecheck}
            disabled={rechecking}
            title={review ? `Checked ${timeAgo(review.checked_at)}. Check again.` : "Check again"}
            className="rounded p-1 text-muted transition hover:bg-white/10 hover:text-fg disabled:opacity-50"
          >
            <ArrowPathIcon className={clsx("size-4", rechecking && "animate-spin")} />
          </button>
        )}
      </div>

      {checking ? (
        <div className="space-y-2 px-3 py-2.5">
          {[70, 55, 80].map((w) => (
            <div key={w} className="flex items-center gap-2">
              <div className="size-3.5 rounded-full shimmer" />
              <div className="h-2.5 rounded shimmer" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : review && !isReview(review) ? (
        <p className="px-3 py-2.5 text-xs text-danger/90">{review.error}</p>
      ) : isReview(review) ? (
        <ul className="divide-y divide-white/[0.04]">
          {review.checks.map((c) => {
            const { icon: Icon, className } = icons[c.status];
            return (
              <li key={c.key} className="flex gap-2 px-3 py-1.5">
                <Icon className={clsx("mt-0.5 size-3.5 shrink-0", className)} />
                <div className="min-w-0 text-xs leading-5">
                  <span className="font-medium text-fg/90">{c.label}</span>
                  <span className="text-muted"> · {c.detail}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export default TorrentReview;
