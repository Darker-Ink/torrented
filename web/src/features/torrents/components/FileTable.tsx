import { DocumentTextIcon, FilmIcon, PencilIcon, PaperClipIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { useState } from "react";
import { episodeCode, formatBytes, formatClock } from "@/lib/format";
import type { TorrentFile } from "@/lib/types";
import MappingDialog from "./MappingDialog";

type Props = {
  files: TorrentFile[];
  mediaId: number;
  torrentId: number;
  kind: "movie" | "tv";
  editable: boolean;
};

const icons = { video: FilmIcon, subtitle: DocumentTextIcon, other: PaperClipIcon };

const chip = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap";

const Match = ({ file, kind }: { file: TorrentFile; kind: "movie" | "tv" }) => {
  if (file.kind === "subtitle")
    return <span className={clsx(chip, "bg-white/[0.04] text-fg/60 ring-white/10")}>{file.language?.toUpperCase() ?? "SUB"}</span>;
  if (file.kind !== "video") return null;
  if (file.mapping === "ignored")
    return <span className={clsx(chip, "bg-white/[0.04] text-fg/45 ring-white/10")}>{file.is_sample ? "Sample" : "Ignored"}</span>;
  if (kind === "movie") return <span className={clsx(chip, "bg-success/10 text-success ring-success/25")}>Movie</span>;
  if (file.season_number !== null && file.episode_numbers.length > 0) {
    const linked = file.linked_episodes > 0;
    return (
      <span
        className={clsx(
          chip,
          linked ? "bg-success/10 text-success ring-success/25" : "bg-warning/10 text-warning ring-warning/25",
        )}
        title={linked ? (file.mapping === "manual" ? "Matched by hand" : "Matched automatically") : "Episode not found on this show"}
      >
        {episodeCode(file.season_number, file.episode_numbers)}
        {file.mapping === "manual" && <span className="ml-1 opacity-60">✎</span>}
      </span>
    );
  }
  return <span className={clsx(chip, "bg-warning/10 text-warning ring-warning/25")}>Unmatched</span>;
};

const split = (path: string) => {
  const i = path.lastIndexOf("/");
  return i === -1 ? { dir: "", base: path } : { dir: path.slice(0, i), base: path.slice(i + 1) };
};

const FileTable = ({ files, mediaId, torrentId, kind, editable }: Props) => {
  const [editing, setEditing] = useState<TorrentFile | null>(null);
  const [showOther, setShowOther] = useState(false);
  const order = { video: 0, subtitle: 1, other: 2 };
  const sorted = [...files].sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path));
  const main = sorted.filter((f) => f.kind !== "other");
  const other = sorted.filter((f) => f.kind === "other");
  const shown = showOther ? sorted : main;

  return (
    <>
      <ul className="divide-y divide-white/[0.04]">
        {shown.map((f) => {
          const Icon = icons[f.kind];
          const { dir, base } = split(f.path);
          const details =
            f.kind === "video"
              ? [
                  f.resolution,
                  f.video_codec?.toUpperCase(),
                  f.audio_codec?.toUpperCase(),
                  f.duration ? formatClock(f.duration) : null,
                  f.probe?.hdr ? "HDR" : null,
                  !f.probed_at ? "not scanned yet" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : null;
          const canEdit = editable && f.kind === "video" && kind === "tv";
          return (
            <li
              key={f.id}
              className={clsx(
                "group/file flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.025] sm:px-5",
                f.mapping === "ignored" && "opacity-55",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-fg/50">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg/90" title={f.path}>
                  {base}
                </p>
                {(dir || details) && (
                  <p className="truncate text-xs text-subtle">{[details, dir].filter(Boolean).join("  ·  ")}</p>
                )}
              </div>
              <Match file={f} kind={kind} />
              <span className="hidden w-16 text-right text-xs text-muted tabular-nums sm:block">{formatBytes(f.size)}</span>
              {editable && (
                <span className="w-7">
                  {canEdit && (
                    <button
                      onClick={() => setEditing(f)}
                      className="grid size-7 place-items-center rounded-md text-muted opacity-0 transition group-hover/file:opacity-100 hover:bg-white/10 hover:text-fg focus:opacity-100"
                      aria-label="Change episode match"
                      title="Change episode match"
                    >
                      <PencilIcon className="size-3.5" />
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {other.length > 0 && (
        <button
          onClick={() => setShowOther((s) => !s)}
          className="w-full border-t border-white/[0.04] px-5 py-2.5 text-left text-xs font-semibold text-muted transition hover:bg-white/[0.02] hover:text-fg"
        >
          {showOther ? "Hide other files" : `+ ${other.length} other file${other.length === 1 ? "" : "s"}`}
        </button>
      )}
      {editing && (
        <MappingDialog open={!!editing} onClose={() => setEditing(null)} mediaId={mediaId} torrentId={torrentId} file={editing} />
      )}
    </>
  );
};

export default FileTable;
