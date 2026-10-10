import { useEffect, useState } from "react";
import { useUser } from "@/features/auth/hooks/useSession";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import Modal from "@/features/ui/components/Modal";
import Select from "@/features/ui/components/Select";
import Toggle from "@/features/ui/components/Toggle";
import { toast } from "@/features/ui/components/Toaster";
import { errorMessage } from "@/lib/api";
import { PERM } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { useUserActions } from "../hooks/queries";
import PermissionEditor from "./PermissionEditor";

type Props = { open: boolean; onClose: () => void; user?: User | null };

const UserDialog = ({ open, onClose, user }: Props) => {
  const me = useUser();
  const { create, update } = useUserActions();
  const editing = !!user;
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    password: "",
    role: "user",
    permissions: PERM.STREAM | PERM.REQUEST,
    disabled: false,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      username: user?.username ?? "",
      display_name: user?.display_name ?? "",
      password: "",
      role: user?.role ?? "user",
      permissions: user?.permissions ?? PERM.STREAM | PERM.REQUEST,
      disabled: user?.disabled ?? false,
    });
  }, [open, user]);

  const isOwner = user?.role === "owner";
  const self = user?.id === me?.id;

  const save = async () => {
    try {
      if (editing) {
        await update.mutateAsync({
          id: user!.id,
          display_name: form.display_name,
          ...(isOwner ? {} : { role: form.role, permissions: form.permissions }),
          ...(isOwner || self ? {} : { disabled: form.disabled }),
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success("User updated");
      } else {
        await create.mutateAsync({
          username: form.username,
          display_name: form.display_name || undefined,
          password: form.password,
          role: form.role,
          permissions: form.permissions,
        });
        toast.success(`Created ${form.username}`);
      }
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${user!.display_name || user!.username}` : "New user"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={create.isPending || update.isPending}>
            {editing ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username">
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              disabled={editing}
            />
          </Field>
          <Field label="Display name">
            <Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
          </Field>
          <Field label={editing ? "Reset password" : "Password"} description={editing ? "Leave empty to keep it. Signs them out." : "At least 8 characters."}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="new-password"
            />
          </Field>
          {!isOwner && (
            <Field label="Role">
              <Select
                value={form.role}
                onChange={(role) => setForm((f) => ({ ...f, role }))}
                options={[
                  { value: "user", label: "User" },
                  ...(me?.role === "owner" ? [{ value: "admin", label: "Admin", description: "Has every permission." }] : []),
                ]}
              />
            </Field>
          )}
        </div>
        {!isOwner && form.role === "user" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Permissions</p>
            <PermissionEditor
              value={form.permissions}
              onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
              allowAdmin={me?.role === "owner" || me?.role === "admin"}
            />
          </div>
        )}
        {editing && !isOwner && !self && (
          <Toggle
            checked={form.disabled}
            onChange={(disabled) => setForm((f) => ({ ...f, disabled }))}
            label="Disabled"
            description="Disabled users are signed out and can't sign in."
          />
        )}
      </div>
    </Modal>
  );
};

export default UserDialog;
