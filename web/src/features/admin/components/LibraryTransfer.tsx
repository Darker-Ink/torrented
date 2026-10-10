import { ArrowDownTrayIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Button from "@/features/ui/components/Button";
import ConfirmDialog from "@/features/ui/components/ConfirmDialog";
import Select from "@/features/ui/components/Select";
import { StatCardsSkeleton } from "@/features/ui/components/Skeleton";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { useLibraryInfo } from "../hooks/queries";
import Card from "./Card";
import StatCard from "./StatCard";

type ImportResult = {
  source_version: number;
  migrated_to: number;
  titles_added: number;
  torrents_added: number;
  files_added: number;
};

const LibraryTransfer = () => {
  const { data } = useLibraryInfo();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const runImport = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<ImportResult>(`/admin/library/import?mode=${mode}`, form);
      toast.success(
        `Imported ${res.titles_added} titles and ${res.torrents_added} torrents` +
          (res.source_version < res.migrated_to ? ` (upgraded from schema v${res.source_version})` : ""),
      );
      setFile(null);
      setConfirm(false);
      client.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {!data && <StatCardsSkeleton />}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Titles" value={data.titles} hint={`${data.movies} movies · ${data.shows} shows`} />
          <StatCard label="Episodes" value={data.episodes} />
          <StatCard label="Torrents" value={data.torrents} hint={`${data.files} files`} />
          <StatCard label="Content size" value={formatBytes(data.total_size)} hint="Streamed on demand" />
        </div>
      )}

      <Card title="Export">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-sm text-muted">
            <p>
              Download the library as a single SQLite file: titles, episodes, torrents and their file matches. No
              accounts, history or logs are included, so it's safe to share.
            </p>
            {data && (
              <p className="text-xs text-subtle">
                Schema v{data.schema_version} · library {data.library_id?.slice(0, 8)} · created {formatDate(data.created_at)}
              </p>
            )}
          </div>
          <a href="/api/admin/library/export" download>
            <Button variant="primary">
              <ArrowDownTrayIcon className="size-4" /> Export library
            </Button>
          </a>
        </div>
      </Card>

      <Card title="Import">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Import a library exported from this or another server. Older exports are upgraded to the current schema
            automatically.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button onClick={() => input.current?.click()}>
              <ArrowUpTrayIcon className="size-4" /> {file ? file.name : "Choose file"}
            </Button>
            <Select
              className="w-64"
              value={mode}
              onChange={setMode}
              options={[
                { value: "merge", label: "Merge", description: "Add what's missing, keep everything else" },
                { value: "replace", label: "Replace", description: "Throw away the current library first" },
              ]}
            />
            <Button variant="primary" disabled={!file} onClick={() => (mode === "replace" ? setConfirm(true) : runImport())} loading={loading}>
              Import
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={runImport}
        loading={loading}
        title="Replace the whole library?"
        confirmLabel="Replace"
        danger
      >
        Every title, torrent and file match currently in the library will be deleted and replaced by the imported file.
      </ConfirmDialog>
    </div>
  );
};

export default LibraryTransfer;
