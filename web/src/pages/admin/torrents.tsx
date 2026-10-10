import { Link } from "react-router-dom";
import AdminLayout from "@/features/admin/components/AdminLayout";
import Card from "@/features/admin/components/Card";
import { useAllTorrents, useJobs } from "@/features/admin/hooks/queries";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import Spinner from "@/features/ui/components/Spinner";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import { img } from "@/lib/images";
import { PERM } from "@/lib/permissions";

const TorrentsPage = () => {
  const { data: torrents } = useAllTorrents();
  const { data: jobs } = useJobs();
  const client = useQueryClient();

  const dismiss = async (hash: string) => {
    await api.delete(`/torrents/jobs/${hash}`).catch(() => {});
    client.invalidateQueries({ queryKey: ["admin", "jobs"] });
  };

  return (
    <AdminLayout title="Torrents" description="Every torrent in the library and any work in progress." requires={PERM.MANAGE_TORRENTS}>
      {jobs && jobs.length > 0 && (
        <Card title="In progress & failed" padded={false}>
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.info_hash} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{j.name ?? j.info_hash}</p>
                  <p className={`truncate text-xs ${j.status === "error" ? "text-danger" : "text-muted"}`}>
                    {j.status === "error" ? j.error : j.status === "resolving" ? "Fetching metadata from peers" : "Scanning files"}
                    {j.added_by ? ` · ${j.added_by}` : ""} · {timeAgo(j.created_at)}
                  </p>
                </div>
                {j.status === "error" ? (
                  <Button size="sm" variant="ghost" onClick={() => dismiss(j.info_hash)}>
                    Dismiss
                  </Button>
                ) : (
                  <Spinner size="sm" />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        {!torrents ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : torrents.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No torrents yet. Add one from any title's page.</p>
        ) : (
          <ul className="divide-y divide-line">
            {torrents.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-4 py-3">
                <Link to={`/title/${t.media_id}`} className="w-10 shrink-0">
                  {t.poster_path ? (
                    <img src={img(t.poster_path, "w92")} alt="" className="aspect-[2/3] w-full rounded object-cover" />
                  ) : (
                    <div className="aspect-[2/3] w-full rounded bg-surface" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={t.name}>
                    {t.name}
                  </p>
                  <p className="truncate text-xs text-muted">
                    <Link to={`/title/${t.media_id}`} className="hover:text-primary">
                      {t.media_title}
                    </Link>{" "}
                    · {formatBytes(t.total_size)} · {t.file_count} files · {timeAgo(t.added_at)}
                    {t.job?.added_by ? ` · ${t.job.added_by}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {t.resolution && <Badge tone="primary">{t.resolution}</Badge>}
                  {t.job && t.job.warnings.length > 0 && <Badge tone="warning">{t.job.warnings.length} warnings</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminLayout>
  );
};

export default TorrentsPage;
