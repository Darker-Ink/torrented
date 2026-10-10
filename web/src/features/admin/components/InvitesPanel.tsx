import { ClipboardIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { PERM } from "@/lib/permissions";
import { useInviteActions, useInvites } from "../hooks/queries";
import Card from "./Card";
import PermissionEditor from "./PermissionEditor";

const inviteLink = (code: string) => `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;

const copy = (code: string) =>
  navigator.clipboard
    .writeText(inviteLink(code))
    .then(() => toast.success("Invite link copied"))
    .catch(() => toast.info(inviteLink(code)));

const InvitesPanel = () => {
  const { data } = useInvites();
  const { create, remove } = useInviteActions();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ permissions: PERM.STREAM | PERM.REQUEST, max_uses: "1", days: "7", note: "" });

  const submit = async () => {
    try {
      const res = await create.mutateAsync({
        permissions: form.permissions,
        max_uses: Number(form.max_uses) || 0,
        expires_in_days: Number(form.days) || undefined,
        note: form.note || undefined,
      });
      setOpen(false);
      copy(res.code);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card
      title="Invites"
      padded={false}
      actions={
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
          <PlusIcon className="size-4" /> New invite
        </Button>
      }
    >
      {data && data.length > 0 ? (
        <ul className="divide-y divide-line">
          {data.map((inv) => {
            const used = inv.max_uses > 0 && inv.uses >= inv.max_uses;
            const expired = !!inv.expires_at && new Date(inv.expires_at) < new Date();
            return (
              <li key={inv.code} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm">{inv.code}</p>
                  <p className="text-xs text-muted">
                    {inv.uses}/{inv.max_uses || "∞"} used
                    {inv.expires_at ? ` · ${expired ? "expired" : `expires ${formatDate(inv.expires_at)}`}` : ""}
                    {inv.note ? ` · ${inv.note}` : ""} · by {inv.created_by_name ?? "unknown"} {timeAgo(inv.created_at)}
                  </p>
                </div>
                {!used && !expired && (
                  <Button size="sm" variant="ghost" onClick={() => copy(inv.code)}>
                    <ClipboardIcon className="size-4" /> Copy link
                  </Button>
                )}
                <button
                  onClick={() => remove.mutate(inv.code)}
                  className="rounded p-1.5 text-muted hover:bg-white/10 hover:text-danger"
                  aria-label="Delete invite"
                >
                  <TrashIcon className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted">No invites yet.</p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="New invite"
        description="The link is copied to your clipboard once it's created."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={create.isPending}>
              Create invite
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Uses" description="0 for unlimited">
              <Input type="number" min={0} value={form.max_uses} onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))} />
            </Field>
            <Field label="Expires after (days)" description="0 for never">
              <Input type="number" min={0} value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
            </Field>
            <Field label="Note">
              <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Optional" />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Permissions for new accounts</p>
            <PermissionEditor value={form.permissions} onChange={(permissions) => setForm((f) => ({ ...f, permissions }))} allowAdmin={false} />
          </div>
        </div>
      </Modal>
    </Card>
  );
};

export default InvitesPanel;
