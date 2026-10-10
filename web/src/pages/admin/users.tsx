import { PencilSquareIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import AdminLayout from "@/features/admin/components/AdminLayout";
import Card from "@/features/admin/components/Card";
import InvitesPanel from "@/features/admin/components/InvitesPanel";
import UserDialog from "@/features/admin/components/UserDialog";
import { useUserActions, useUsers } from "@/features/admin/hooks/queries";
import { useUser } from "@/features/auth/hooks/useSession";
import Avatar from "@/features/layout/components/Avatar";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import ConfirmDialog from "@/features/ui/components/ConfirmDialog";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { PERM } from "@/lib/permissions";
import type { User } from "@/lib/types";

const UsersPage = () => {
  const me = useUser();
  const { data } = useUsers();
  const { remove } = useUserActions();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(`Deleted ${deleting.username}`);
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AdminLayout
      title="Users"
      description="Accounts on this server and what they can do."
      requires={PERM.MANAGE_USERS}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          <PlusIcon className="size-4" /> New user
        </Button>
      }
    >
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-subtle uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Can</th>
                <th className="px-4 py-3 font-medium">Last seen</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.username} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{u.display_name || u.username}</p>
                        <p className="truncate text-xs text-muted">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Badge tone={u.role === "user" ? "neutral" : "primary"}>{u.role}</Badge>
                      {u.disabled && <Badge tone="danger">disabled</Badge>}
                    </div>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-xs text-muted">
                    {u.granted.includes("admin") ? "Everything" : u.granted.map((g) => g.replace(/_/g, " ")).join(", ") || "Nothing"}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-muted">{timeAgo(u.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setEditing(u)}
                        className="rounded p-1.5 text-muted hover:bg-white/10 hover:text-fg"
                        aria-label="Edit"
                      >
                        <PencilSquareIcon className="size-4" />
                      </button>
                      {u.role !== "owner" && u.id !== me?.id && (
                        <button
                          onClick={() => setDeleting(u)}
                          className="rounded p-1.5 text-muted hover:bg-white/10 hover:text-danger"
                          aria-label="Delete"
                        >
                          <TrashIcon className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <InvitesPanel />

      <UserDialog open={creating || !!editing} onClose={() => (setCreating(false), setEditing(null))} user={editing} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        loading={remove.isPending}
        title={`Delete ${deleting?.username}?`}
        confirmLabel="Delete"
        danger
      >
        Their requests, watch history and list are deleted too. Torrents they added stay in the library.
      </ConfirmDialog>
    </AdminLayout>
  );
};

export default UsersPage;
