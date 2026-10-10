import { Checkbox, Field, Label } from "@headlessui/react";
import { CheckIcon, DocumentIcon, PaperClipIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useRef, useState } from "react";
import Button from "@/features/ui/components/Button";
import FieldWrap, { Input, Textarea } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { MediaKind } from "@/lib/types";
import { useCreateRequest } from "../hooks/queries";

export type RequestTarget = {
  kind: MediaKind;
  tmdb_id: number;
  title: string;
  seasons: { season_number: number; name: string | null }[];
};

type Props = { open: boolean; onClose: () => void; title: RequestTarget };

const toBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const RequestDialog = ({ open, onClose, title }: Props) => {
  const seasons = title.seasons.filter((s) => s.season_number > 0);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [torrent, setTorrent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useCreateRequest();

  const toggle = (n: number) =>
    setSelected((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)));

  const close = () => {
    setSelected([]);
    setNote("");
    setTorrent("");
    setFile(null);
    onClose();
  };

  const submit = async () => {
    try {
      const res = await create.mutateAsync({
        kind: title.kind,
        tmdb_id: title.tmdb_id,
        seasons: selected.length ? selected : undefined,
        note: note || undefined,
        torrent: file ? undefined : torrent.trim() || undefined,
        torrent_file: file ? await toBase64(file) : undefined,
      });
      const suggested = file || torrent.trim();
      toast.success(
        res.status === "approved"
          ? `${title.title} was added to the library${suggested ? ", checking your torrent" : ""}`
          : suggested
            ? "Request sent, checking your torrent"
            : "Request sent",
      );
      close();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Request ${title.title}`}
      description="Someone who manages the library will pick it up."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={create.isPending}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {title.kind === "tv" && seasons.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Seasons</p>
            <p className="text-xs text-muted">Leave everything unticked to request the whole show.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {seasons.map((s) => (
                <Field key={s.season_number} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-3 py-2">
                  <Checkbox
                    checked={selected.includes(s.season_number)}
                    onChange={() => toggle(s.season_number)}
                    className="group grid size-4 place-items-center rounded border border-line-strong data-[checked]:border-primary data-[checked]:bg-primary"
                  >
                    <CheckIcon className="hidden size-3 text-on-primary group-data-[checked]:block" />
                  </Checkbox>
                  <Label className="cursor-pointer text-sm">{s.name ?? `Season ${s.season_number}`}</Label>
                </Field>
              ))}
            </div>
          </div>
        )}

        <FieldWrap
          label="Torrent"
          description="Optional. Know a good release? It gets checked for the right content and enough seeders before anyone approves it."
        >
          {file ? (
            <div className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2.5 ring-1 ring-line">
              <DocumentIcon className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="rounded p-1 text-muted transition hover:bg-white/10 hover:text-fg"
                aria-label="Remove file"
              >
                <XMarkIcon className="size-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={torrent}
                onChange={(e) => setTorrent(e.target.value)}
                placeholder="Magnet link, info hash or .torrent URL"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={() => fileRef.current?.click()}
                title="Upload a .torrent file"
              >
                <PaperClipIcon className="size-4" /> File
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </FieldWrap>

        <FieldWrap label="Note" description="Optional, e.g. preferred quality or language.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </FieldWrap>
      </div>
    </Modal>
  );
};

export default RequestDialog;
