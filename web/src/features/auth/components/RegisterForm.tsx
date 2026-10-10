import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { useInstance, useSetUser } from "../hooks/useSession";

const RegisterForm = () => {
  const [params] = useSearchParams();
  const { data: instance } = useInstance();
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    password: "",
    confirm: "",
    invite: params.get("invite") ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setUser = useSetUser();
  const navigate = useNavigate();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = await api.post<User>("/auth/register", {
        username: form.username,
        display_name: form.display_name || undefined,
        password: form.password,
        invite: form.invite || undefined,
      });
      setUser(user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (instance?.registration === "closed" && !form.invite) {
    return (
      <div className="space-y-4 text-sm text-muted">
        <p>Registration is closed on this server. Ask an admin for an invite link.</p>
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {(instance?.registration !== "open" || form.invite) && (
        <Field label="Invite code">
          <Input value={form.invite} onChange={set("invite")} required={instance?.registration !== "open"} />
        </Field>
      )}
      <Field label="Username" description="Letters, numbers, dots, dashes and underscores.">
        <Input value={form.username} onChange={set("username")} autoComplete="username" required />
      </Field>
      <Field label="Display name">
        <Input value={form.display_name} onChange={set("display_name")} placeholder="Optional" />
      </Field>
      <Field label="Password" description="At least 8 characters.">
        <Input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm password">
        <Input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required />
      </Field>
      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
};

export default RegisterForm;
