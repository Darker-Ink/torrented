import { useEffect, useState } from "react";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import type { TorrentFile } from "@/lib/types";
import { useTorrentActions } from "../hooks/queries";

type Props = {
  open: boolean;
  onClose: () => void;
  mediaId: number;
  torrentId: number;
  file: TorrentFile;
};

/** "1, 2, 5-7" → [1, 2, 5, 6, 7] */
const parseEpisodes = (text: string) => {
  const out = new Set<number>();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let i = Math.min(a, b); i <= Math.max(a, b) && i - a < 200; i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    } else {
      return null;
    }
  }
  return [...out].sort((a, b) => a - b);
};

const MappingDialog = ({ open, onClose, mediaId, torrentId, file }: Props) => {
  const [season, setSeason] = useState("");
  const [episodes, setEpisodes] = useState("");
  const { updateFile } = useTorrentActions(mediaId);

  useEffect(() => {
    if (!open) return;
    setSeason(file.season_number?.toString() ?? "");
    setEpisodes(file.episode_numbers.join(", "));
  }, [open, file]);

  const save = async (mapping: TorrentFile["mapping"]) => {
    const eps = parseEpisodes(episodes);
    if (mapping === "manual" && (eps === null || !season || eps.length === 0)) {
      toast.error("Enter a season and at least one episode, e.g. 3 or 3-4");
      return;
    }
    try {
      await updateFile.mutateAsync({
        torrentId,
        fileId: file.id,
        mapping,
        season_number: mapping === "manual" ? Number(season) : undefined,
        episode_numbers: mapping === "manual" ? eps! : undefined,
      });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Match file to episodes"
      description={<span className="font-mono text-xs break-all">{file.path}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={() => save("auto")} loading={updateFile.isPending}>
            Use automatic
          </Button>
          <Button variant="danger" onClick={() => save("ignored")} loading={updateFile.isPending}>
            Ignore file
          </Button>
          <Button variant="primary" onClick={() => save("manual")} loading={updateFile.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Season">
          <Input type="number" min={0} value={season} onChange={(e) => setSeason(e.target.value)} />
        </Field>
        <Field label="Episodes" description="e.g. 4, or 4-5 for a double episode" className="col-span-2">
          <Input value={episodes} onChange={(e) => setEpisodes(e.target.value)} placeholder="1" />
        </Field>
      </div>
    </Modal>
  );
};

export default MappingDialog;
