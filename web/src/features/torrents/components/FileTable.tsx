import { DocumentTextIcon, FilmIcon, PencilSquareIcon, QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useState } from "react";
import Badge from "@/features/ui/components/Badge";
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

const kindIcon = {
  video: FilmIcon,
  subtitle: DocumentTextIcon,
  other: QuestionMarkCircleIcon,
};

const MappingCell = ({ file, kind }: { file: TorrentFile; kind: "movie" | "tv" }) => {
  if (file.kind !== "video") {
    return file.kind === "subtitle" ? (
      <span className="text-xs text-muted uppercase">{file.language ?? "subtitle"}</span>
    ) : null;
  }
  if (file.mapping === "ignored") return <Badge>{file.is_sample ? "Sample" : "Ignored"}</Badge>;
  if (kind === "movie") return <Badge tone="success">Movie</Badge>;
  if (file.season_number !== null && file.episode_numbers.length > 0) {
    const linked = file.linked_episodes > 0;
    return (
      <Badge tone={linked ? (file.mapping === "manual" ? "primary" : "success") : "warning"}>
        {episodeCode(file.season_number, file.episode_numbers)}
        {!linked && " · unknown"}
      </Badge>
    );
  }
  return <Badge tone="warning">Unmatched</Badge>;
};

const FileTable = ({ files, mediaId, torrentId, kind, editable }: Props) => {
  const [editing, setEditing] = useState<TorrentFile | null>(null);
  const shown = files.filter((f) => f.kind !== "other" || files.length < 30);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-subtle uppercase">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">File</th>
              <th className="px-3 py-2 font-medium">Match</th>
              <th className="px-3 py-2 font-medium">Details</th>
              <th className="px-3 py-2 text-right font-medium">Size</th>
              {editable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const Icon = kindIcon[f.kind];
              return (
                <tr key={f.id} className={clsx("border-b border-line/60 last:border-0", f.mapping === "ignored" && "opacity-50")}>
                  <td className="max-w-md py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted" />
                      <span className="truncate font-mono text-xs" title={f.path}>
                        {f.path}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <MappingCell file={f} kind={kind} />
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted">
                    {f.kind === "video" &&
                      [
                        f.resolution,
                        f.video_codec?.toUpperCase(),
                        f.audio_codec?.toUpperCase(),
                        f.duration ? formatClock(f.duration) : null,
                        f.probe?.hdr ? "HDR" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    {f.kind === "video" && !f.probed_at && <span className="text-subtle"> · not scanned</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs whitespace-nowrap text-muted">{formatBytes(f.size)}</td>
                  {editable && (
                    <td className="py-2 pl-1">
                      {f.kind === "video" && kind === "tv" && (
                        <button
                          onClick={() => setEditing(f)}
                          className="rounded p-1 text-muted hover:bg-white/10 hover:text-fg"
                          aria-label="Edit match"
                        >
                          <PencilSquareIcon className="size-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <MappingDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          mediaId={mediaId}
          torrentId={torrentId}
          file={editing}
        />
      )}
    </>
  );
};

export default FileTable;
