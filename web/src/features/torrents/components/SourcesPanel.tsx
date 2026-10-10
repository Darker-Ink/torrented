import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ClipboardIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassCircleIcon,
  PlusIcon,
  ServerStackIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import clsx from "clsx";
import { useState } from "react";
import { useUser } from "@/features/auth/hooks/useSession";
import Button from "@/features/ui/components/Button";
import ConfirmDialog from "@/features/ui/components/ConfirmDialog";
import EmptyState from "@/features/ui/components/EmptyState";
import { CardListSkeleton } from "@/features/ui/components/Skeleton";
import Spinner from "@/features/ui/components/Spinner";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import { can, PERM } from "@/lib/permissions";
import type { Sources, TorrentJob } from "@/lib/types";
import { useSources, useTorrentActions } from "../hooks/queries";
import AddTorrentDialog from "./AddTorrentDialog";
import FileTable from "./FileTable";

type Props = { mediaId: number; title: string; kind: "movie" | "tv" };

const JobStatus = ({ job }: { job: TorrentJob | null }) => {
  if (!job || job.status === "done") return null;
  if (job.status === "error")
    return <p className="text-sm text-danger">{job.error ?? "Something went wrong"}</p>;
  return (
    <p className="flex items-center gap-2 text-sm text-primary">
      <Spinner size="sm" />
      {job.status === "resolving" ? "Fetching the file list from peers…" : "Scanning files…"}
    </p>
  );
};

const menuItem =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg/85 data-[focus]:bg-white/[0.07] data-[focus]:text-fg";

const QualityTile = ({ resolution }: { resolution: string | null }) => (
  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-muted ring-1 ring-primary/20">
    <span className="text-[13px] font-black tracking-tight text-primary">
      {resolution ? resolution.replace("2160p", "4K") : "SD"}
    </span>
  </div>
);

const TorrentEntry = ({
  entry,
  mediaId,
  kind,
  defaultOpen,
}: {
  entry: Sources["torrents"][number];
  mediaId: number;
  kind: "movie" | "tv";
  defaultOpen: boolean;
}) => {
  const { torrent, files, job } = entry;
  const user = useUser();
  const { remove, remap, probe } = useTorrentActions(mediaId);
  const [open, setOpen] = useState(defaultOpen);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const editable = can(user, PERM.MANAGE_TORRENTS) || (can(user, PERM.ADD_TORRENTS) && job?.user_id === user?.id);
  const videos = files.filter((f) => f.kind === "video" && f.mapping !== "ignored").length;
  const subs = files.filter((f) => f.kind === "subtitle").length;
  const warnings = job?.warnings ?? [];
  const tags = [torrent.source, torrent.video_codec, torrent.audio, torrent.hdr].filter(Boolean);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.025] ring-1 ring-white/[0.07]">
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <QualityTile resolution={torrent.resolution} />
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 space-y-1 text-left">
          <p className="truncate font-semibold" title={torrent.name}>
            {torrent.name}
          </p>
          <p className="truncate text-sm text-muted">
            {[
              tags.join(" · ") || null,
              formatBytes(torrent.total_size),
              `${videos} video${videos === 1 ? "" : "s"}${subs ? `, ${subs} subtitle${subs === 1 ? "" : "s"}` : ""}`,
              `added ${timeAgo(torrent.added_at)}${job?.added_by ? ` by ${job.added_by}` : ""}`,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
          <JobStatus job={job} />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {warnings.length > 0 && (
            <button
              onClick={() => setWarningsOpen((w) => !w)}
              className="flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning ring-1 ring-warning/25 transition hover:bg-warning/15"
            >
              <ExclamationTriangleIcon className="size-3.5" />
              {warnings.length}
            </button>
          )}
          {editable && (
            <Menu>
              <MenuButton className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-white/10 hover:text-fg" aria-label="Actions">
                <EllipsisHorizontalIcon className="size-5" />
              </MenuButton>
              <MenuItems
                anchor="bottom end"
                transition
                className="z-50 mt-1 w-56 rounded-xl border border-white/10 bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl transition data-[closed]:opacity-0"
              >
                <MenuItem>
                  <button className={menuItem} onClick={() => run(() => probe.mutateAsync(torrent.id), "Scanning files")}>
                    <MagnifyingGlassCircleIcon className="size-4 text-muted" /> Scan files again
                  </button>
                </MenuItem>
                {kind === "tv" && (
                  <MenuItem>
                    <button
                      className={menuItem}
                      onClick={() => run(() => remap.mutateAsync({ torrentId: torrent.id, reset: true }), "Episodes matched again")}
                    >
                      <ArrowPathIcon className="size-4 text-muted" /> Re-match episodes
                    </button>
                  </MenuItem>
                )}
                <MenuItem>
                  <button
                    className={menuItem}
                    onClick={() => navigator.clipboard.writeText(torrent.magnet).then(() => toast.info("Magnet link copied"))}
                  >
                    <ClipboardIcon className="size-4 text-muted" /> Copy magnet link
                  </button>
                </MenuItem>
                <MenuItem>
                  <button className={clsx(menuItem, "!text-danger")} onClick={() => setConfirm(true)}>
                    <TrashIcon className="size-4" /> Remove torrent
                  </button>
                </MenuItem>
              </MenuItems>
            </Menu>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-white/10 hover:text-fg"
            aria-label={open ? "Hide files" : "Show files"}
          >
            <ChevronDownIcon className={clsx("size-5 transition", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {warningsOpen && warnings.length > 0 && (
        <ul className="mx-4 mb-4 space-y-1.5 rounded-xl bg-warning/[0.07] px-4 py-3 text-xs text-warning/90 ring-1 ring-warning/15 sm:mx-5">
          {warnings.map((w, i) => (
            <li key={i} className="break-all">
              {w}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="border-t border-white/[0.06]">
          <FileTable files={files} mediaId={mediaId} torrentId={torrent.id} kind={kind} editable={editable} />
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => run(() => remove.mutateAsync(torrent.id), "Torrent removed").then(() => setConfirm(false))}
        loading={remove.isPending}
        title="Remove this torrent?"
        confirmLabel="Remove"
        danger
      >
        Episodes that only this torrent provides will no longer be playable.
      </ConfirmDialog>
    </div>
  );
};

const SourcesPanel = ({ mediaId, title, kind }: Props) => {
  const user = useUser();
  const { data, isLoading } = useSources(mediaId);
  const { dismiss } = useTorrentActions(mediaId);
  const [adding, setAdding] = useState(false);
  const canAdd = can(user, PERM.ADD_TORRENTS);
  const empty = data && data.torrents.length === 0 && data.pending.length === 0;

  return (
    <div className="space-y-5">
      {!empty && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Torrents attached to {title}. Files are matched to {kind === "tv" ? "episodes" : "the movie"} automatically.
            Fix anything that's off with the pencil.
          </p>
          {canAdd && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <PlusIcon className="size-4" /> Add torrent
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <CardListSkeleton count={2} />
      ) : empty ? (
        <EmptyState
          icon={ServerStackIcon}
          title="No torrents yet"
          action={
            canAdd ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <PlusIcon className="size-4" /> Add torrent
              </Button>
            ) : undefined
          }
        >
          Attach a magnet link or .torrent file and everyone on this server can stream it.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {data?.pending.map((job) => (
            <div
              key={job.info_hash}
              className="flex items-center gap-4 rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.07] sm:p-5"
            >
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/[0.05]">
                {job.status === "error" ? (
                  <ExclamationTriangleIcon className="size-5 text-danger" />
                ) : (
                  <Spinner size="sm" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-semibold">{job.name ?? job.info_hash}</p>
                <JobStatus job={job} />
              </div>
              {job.status === "error" && (
                <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(job.info_hash)}>
                  Dismiss
                </Button>
              )}
            </div>
          ))}
          {data?.torrents.map((entry) => (
            <TorrentEntry
              key={entry.torrent.id}
              entry={entry}
              mediaId={mediaId}
              kind={kind}
              defaultOpen={data.torrents.length === 1}
            />
          ))}
        </div>
      )}

      <AddTorrentDialog open={adding} onClose={() => setAdding(false)} mediaId={mediaId} title={title} kind={kind} />
    </div>
  );
};

export default SourcesPanel;
