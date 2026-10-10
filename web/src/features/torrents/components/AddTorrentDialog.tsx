import { ArrowUpTrayIcon, DocumentIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useRef, useState, type DragEvent } from "react";
import Button from "@/features/ui/components/Button";
import Field, { Textarea } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import Tabs from "@/features/ui/components/Tabs";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useAddTorrent } from "../hooks/queries";

type Props = { open: boolean; onClose: () => void; mediaId: number; title: string; kind: "movie" | "tv" };

const AddTorrentDialog = ({ open, onClose, mediaId, title, kind }: Props) => {
  const [tab, setTab] = useState(0);
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useAddTorrent(mediaId);

  const reset = () => {
    setSource("");
    setFile(null);
    setTab(0);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    try {
      const res = await add.mutateAsync(tab === 0 ? { source } : { file: file! });
      toast.success(
        tab === 0 && source.startsWith("magnet:")
          ? "Fetching torrent details from peers…"
          : `Added ${res.name ?? "torrent"}, scanning files`,
      );
      close();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const canSubmit = tab === 0 ? source.trim().length > 0 : !!file;

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={`Add a torrent to ${title}`}
      description={
        kind === "tv"
          ? "Season packs and single episodes both work. Files are matched to episodes automatically."
          : "The largest video file is used as the movie; extras and samples are skipped."
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={add.isPending}>
            Add torrent
          </Button>
        </>
      }
    >
      <Tabs
        selectedIndex={tab}
        onChange={setTab}
        tabs={[
          {
            key: "link",
            label: "Magnet or link",
            content: (
              <Field
                label="Magnet link, info hash or .torrent URL"
                description="Nothing is downloaded now, only the file list is fetched."
              >
                <Textarea
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="magnet:?xt=urn:btih:…"
                  className="font-mono text-xs"
                  autoFocus
                />
              </Field>
            ),
          },
          {
            key: "file",
            label: "Upload .torrent",
            content: (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={clsx(
                  "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition",
                  dragging ? "border-primary bg-primary-muted" : "border-line-strong hover:border-primary/50 hover:bg-white/[0.02]",
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".torrent,application/x-bittorrent"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <>
                    <DocumentIcon className="size-8 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">{file.name}</p>
                      <p className="text-xs text-muted">{formatBytes(file.size)}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <ArrowUpTrayIcon className="size-8 text-muted" />
                    <div>
                      <p className="text-sm font-semibold">Drop a .torrent file here</p>
                      <p className="text-xs text-muted">or click to choose one</p>
                    </div>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default AddTorrentDialog;
