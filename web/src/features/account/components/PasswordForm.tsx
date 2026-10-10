import { useState, type FormEvent } from "react";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";

const PasswordForm = () => {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) {
      toast.error("New passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await api.patch("/auth/me", { current_password: form.current, new_password: form.next });
      setForm({ current: "", next: "", confirm: "" });
      toast.success("Password changed");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current password">
        <Input type="password" value={form.current} onChange={set("current")} autoComplete="current-password" required />
      </Field>
      <Field label="New password" description="At least 8 characters.">
        <Input type="password" value={form.next} onChange={set("next")} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required />
      </Field>
      <Button type="submit" variant="primary" loading={loading}>
        Change password
      </Button>
    </form>
  );
};

export default PasswordForm;
