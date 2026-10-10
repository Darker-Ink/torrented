import { Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ClipboardIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassCircleIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";
import { useUser } from "@/features/auth/hooks/useSession";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import ConfirmDialog from "@/features/ui/components/ConfirmDialog";
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
  if (!job) return null;
  if (job.status === "resolving")
    return (
      <span className="flex items-center gap-1.5 text-xs text-primary">
        <Spinner size="sm" /> Fetching file list from peers…
      </span>
    );
  if (job.status === "probing")
    return (
      <span className="flex items-center gap-1.5 text-xs text-primary">
        <Spinner size="sm" /> Scanning files…
      </span>
    );
  if (job.status === "error") return <span className="text-xs text-danger">{job.error}</span>;
  return null;
};

const menuItem =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg/90 data-[focus]:bg-white/[0.07] data-[disabled]:opacity-40";

const TorrentEntry = ({
  entry,
  mediaId,
  kind,
}: {
  entry: Sources["torrents"][number];
  mediaId: number;
  kind: "movie" | "tv";
}) => {
  const { torrent, files, job } = entry;
  const user = useUser();
  const { remove, remap, probe } = useTorrentActions(mediaId);
  const [confirm, setConfirm] = useState(false);
  const editable = can(user, PERM.MANAGE_TORRENTS) || (can(user, PERM.ADD_TORRENTS) && job?.user_id === user?.id);
  const videos = files.filter((f) => f.kind === "video" && f.mapping !== "ignored");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Disclosure as="div" className="rounded-lg border border-line bg-white/[0.02]">
      <div className="flex items-start gap-3 p-4">
        <DisclosureButton className="group flex min-w-0 flex-1 items-start gap-3 text-left">
          <ChevronDownIcon className="mt-0.5 size-5 shrink-0 text-muted transition group-data-[open]:rotate-180" />
          <div className="min-w-0 space-y-1.5">
            <p className="truncate font-semibold" title={torrent.name}>
              {torrent.name}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {torrent.resolution && <Badge tone="primary">{torrent.resolution}</Badge>}
              {torrent.source && <Badge>{torrent.source}</Badge>}
              {torrent.video_codec && <Badge>{torrent.video_codec}</Badge>}
              {torrent.hdr && <Badge tone="warning">{torrent.hdr}</Badge>}
              {torrent.audio && <Badge>{torrent.audio}</Badge>}
              <span className="text-xs text-muted">
                {formatBytes(torrent.total_size)} · {videos.length} video{videos.length === 1 ? "" : "s"}
                {torrent.release_group ? ` · ${torrent.release_group}` : ""} · added {timeAgo(torrent.added_at)}
                {job?.added_by ? ` by ${job.added_by}` : ""}
              </span>
            </div>
            <JobStatus job={job} />
          </div>
        </DisclosureButton>
        {editable && (
          <Menu>
            <MenuButton className="rounded-md p-1.5 text-muted hover:bg-white/10 hover:text-fg" aria-label="Actions">
              <EllipsisVerticalIcon className="size-5" />
            </MenuButton>
            <MenuItems
              anchor="bottom end"
              transition
              className="z-50 mt-1 w-56 rounded-lg border border-line bg-surface p-1 shadow-xl transition data-[closed]:opacity-0"
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
                    onClick={() =>
                      run(() => remap.mutateAsync({ torrentId: torrent.id, reset: true }), "Episodes matched again")
                    }
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
                <button className={`${menuItem} text-danger`} onClick={() => setConfirm(true)}>
                  <TrashIcon className="size-4" /> Remove torrent
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        )}
      </div>

      {job && job.warnings.length > 0 && (
        <div className="mx-4 mb-3 space-y-1 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          {job.warnings.map((w, i) => (
            <p key={i} className="flex gap-1.5">
              <ExclamationTriangleIcon className="mt-px size-3.5 shrink-0" />
              <span className="break-all">{w}</span>
            </p>
          ))}
        </div>
      )}

      <DisclosurePanel className="border-t border-line px-4 py-3">
        <FileTable files={files} mediaId={mediaId} torrentId={torrent.id} kind={kind} editable={editable} />
      </DisclosurePanel>

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
    </Disclosure>
  );
};

const SourcesPanel = ({ mediaId, title, kind }: Props) => {
  const user = useUser();
  const { data, isLoading } = useSources(mediaId);
  const { dismiss } = useTorrentActions(mediaId);
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-4 px-4 sm:px-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Sources</h2>
          <p className="text-sm text-muted">Torrents attached to this title and what's inside them.</p>
        </div>
        {can(user, PERM.ADD_TORRENTS) && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" /> Add torrent
          </Button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          {data?.pending.map((job) => (
            <div key={job.info_hash} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] p-4">
              <div className="min-w-0 space-y-1">
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
            <TorrentEntry key={entry.torrent.id} entry={entry} mediaId={mediaId} kind={kind} />
          ))}
          {data && data.torrents.length === 0 && data.pending.length === 0 && (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              No torrents yet.
            </p>
          )}
        </div>
      )}

      <AddTorrentDialog open={adding} onClose={() => setAdding(false)} mediaId={mediaId} title={title} kind={kind} />
    </section>
  );
};

export default SourcesPanel;
