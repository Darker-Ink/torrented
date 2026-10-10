import { useEffect, useState } from "react";
import AdminLayout from "@/features/admin/components/AdminLayout";
import Card from "@/features/admin/components/Card";
import { useLogs, useStreamLog } from "@/features/admin/hooks/queries";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import { Input } from "@/features/ui/components/Field";
import Select from "@/features/ui/components/Select";
import Tabs from "@/features/ui/components/Tabs";
import { episodeCode, formatBytes, formatDuration, timeAgo } from "@/lib/format";
import { PERM } from "@/lib/permissions";

const Pager = ({ page, total, limit, onChange }: { page: number; total: number; limit: number; onChange: (p: number) => void }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
      <span>
        {total} entries · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
};

const actionTone = (a: string) =>
  a.includes("failed") || a.includes("delete") || a.includes("remove") || a.includes("declined")
    ? "danger"
    : a.startsWith("auth")
      ? "neutral"
      : "primary";

const AuditLog = () => {
  const [action, setAction] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useLogs({ action, q, page });

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select
          className="w-48"
          value={action}
          onChange={(v) => {
            setAction(v);
            setPage(1);
          }}
          options={[
            { value: "", label: "All actions" },
            { value: "auth", label: "Sign-ins" },
            { value: "torrent", label: "Torrents" },
            { value: "library", label: "Library" },
            { value: "request", label: "Requests" },
            { value: "user", label: "Users" },
            { value: "invite", label: "Invites" },
            { value: "settings", label: "Settings" },
          ]}
        />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search user, target…" className="max-w-xs" />
      </div>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-subtle uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((e) => (
                <tr key={e.id} className="border-b border-line/60 align-top last:border-0">
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted" title={e.created_at}>
                    {timeAgo(e.created_at)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{e.username ?? <span className="text-subtle">System</span>}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                  </td>
                  <td className="max-w-sm px-4 py-2.5">
                    <p className="truncate">{e.target}</p>
                    {e.details && (
                      <p className="truncate font-mono text-[11px] text-subtle" title={JSON.stringify(e.details)}>
                        {JSON.stringify(e.details)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted">{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} total={data.total} limit={data.limit} onChange={setPage} />}
      </Card>
    </div>
  );
};

const StreamLog = () => {
  const [page, setPage] = useState(1);
  const { data } = useStreamLog(page);
  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-subtle uppercase">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Who</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Mode</th>
              <th className="px-4 py-3 font-medium">Watched</th>
              <th className="px-4 py-3 text-right font-medium">Sent</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">{timeAgo(s.started_at)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{s.username ?? "Unknown"}</td>
                <td className="max-w-xs truncate px-4 py-2.5">
                  {s.title}
                  {s.season_number !== null && s.episode_number !== null && (
                    <span className="text-muted"> · {episodeCode(s.season_number, s.episode_number)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={s.mode === "direct" ? "success" : "primary"}>{s.mode}</Badge>
                </td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">
                  {s.ended_at
                    ? formatDuration((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000)
                    : "Still watching"}
                </td>
                <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted">{formatBytes(s.bytes_sent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={page} total={data.total} limit={data.limit} onChange={setPage} />}
    </Card>
  );
};

const LogsPage = () => (
  <AdminLayout title="Logs" description="Who did what, and what got watched." requires={PERM.VIEW_LOGS}>
    <Tabs
      tabs={[
        { key: "audit", label: "Activity", content: <AuditLog /> },
        { key: "streams", label: "Playback history", content: <StreamLog /> },
      ]}
    />
  </AdminLayout>
);

export default LogsPage;
