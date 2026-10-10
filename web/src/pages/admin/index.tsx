import { Link } from "react-router-dom";
import AdminLayout from "@/features/admin/components/AdminLayout";
import Card from "@/features/admin/components/Card";
import StatCard from "@/features/admin/components/StatCard";
import { useOverview } from "@/features/admin/hooks/queries";
import Badge from "@/features/ui/components/Badge";
import Skeleton, { StatCardsSkeleton } from "@/features/ui/components/Skeleton";
import { episodeCode, formatBytes, formatDuration, timeAgo } from "@/lib/format";

const OverviewPage = () => {
  const { data } = useOverview();

  return (
    <AdminLayout title="Overview" description="What's happening on this server right now.">
      {!data ? (
        <div className="space-y-6">
          <StatCardsSkeleton />
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid gap-6 xl:grid-cols-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Titles" value={data.library.titles} hint={`${data.library.movies} movies · ${data.library.shows} shows`} />
            <StatCard label="Torrents" value={data.library.torrents} hint={formatBytes(data.library.total_size)} />
            <StatCard label="Users" value={data.users} />
            <StatCard
              label="Requests"
              value={data.pending_requests}
              hint={
                <Link to="/requests" className="hover:text-primary">
                  pending review →
                </Link>
              }
            />
          </div>

          <Card title="Stream cache">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  {formatBytes(data.engine.cache_bytes)} of {formatBytes(data.engine.cache_limit)}
                </span>
                <span className="text-muted">{data.engine.active.length} torrent(s) active</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (data.engine.cache_bytes / Math.max(1, data.engine.cache_limit)) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-subtle">
                Pieces are only kept while someone is watching; idle torrents are dropped automatically.
              </p>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Now playing" padded={false}>
              {data.now_playing.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">Nobody is watching right now.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.now_playing.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {s.title}
                          {s.season_number !== null && s.episode_number !== null
                            ? ` · ${episodeCode(s.season_number, s.episode_number)}`
                            : ""}
                        </p>
                        <p className="text-xs text-muted">
                          {s.username} · started {timeAgo(s.started_at)} · {formatBytes(s.bytes_sent)} sent
                        </p>
                      </div>
                      <Badge tone={s.mode === "direct" ? "success" : "primary"}>{s.mode}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Active torrents" padded={false}>
              {data.engine.active.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No torrents are loaded.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.engine.active.map((t) => (
                    <li key={t.info_hash} className="space-y-1 px-4 py-3">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted tabular-nums">
                        {t.active_streams} stream(s) · {t.peers} peers · ↓ {t.download_mbps.toFixed(1)} MiB/s · ↑{" "}
                        {t.upload_mbps.toFixed(1)} MiB/s · {formatBytes(t.cache_bytes)} cached
                        {t.active_streams === 0 ? ` · idle ${formatDuration(t.idle_seconds)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="System">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Version</dt>
                <dd>{data.version}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Uptime</dt>
                <dd>{formatDuration(data.uptime_seconds)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Database schemas</dt>
                <dd>
                  main v{data.schema.main} · media v{data.schema.media}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">BitTorrent port</dt>
                <dd>{data.engine.listen_addr ?? "not listening"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">ffmpeg</dt>
                <dd className="truncate">{data.tools.ffmpeg_version ?? <span className="text-warning">not installed</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Background jobs</dt>
                <dd>
                  {data.running_jobs} running
                  {data.failed_jobs > 0 && (
                    <Link to="/admin/torrents" className="text-danger">
                      {" "}
                      · {data.failed_jobs} failed
                    </Link>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
};

export default OverviewPage;
