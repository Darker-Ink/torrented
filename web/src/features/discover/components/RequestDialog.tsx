import { Checkbox, Field, Label } from "@headlessui/react";
import { CheckIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import Button from "@/features/ui/components/Button";
import FieldWrap, { Textarea } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import type { MediaKind } from "@/lib/types";

export type RequestTarget = {
  kind: MediaKind;
  tmdb_id: number;
  title: string;
  seasons: { season_number: number; name: string | null }[];
};
import { useCreateRequest } from "../hooks/queries";

type Props = { open: boolean; onClose: () => void; title: RequestTarget };

const RequestDialog = ({ open, onClose, title }: Props) => {
  const seasons = title.seasons.filter((s) => s.season_number > 0);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const create = useCreateRequest();

  const toggle = (n: number) =>
    setSelected((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)));

  const submit = async () => {
    try {
      const res = await create.mutateAsync({
        kind: title.kind,
        tmdb_id: title.tmdb_id,
        seasons: selected.length ? selected : undefined,
        note: note || undefined,
      });
      toast.success(res.status === "approved" ? `${title.title} was added to the library` : "Request sent");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Request ${title.title}`}
      description="Someone who manages the library will pick it up."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
        <FieldWrap label="Note" description="Optional, e.g. preferred quality or language.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </FieldWrap>
      </div>
    </Modal>
  );
};

export default RequestDialog;
