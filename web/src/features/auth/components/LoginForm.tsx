import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { useInstance, useSetUser } from "../hooks/useSession";

const LoginForm = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setUser = useSetUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: instance } = useInstance();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await api.post<User>("/auth/login", { username, password });
      setUser(user);
      navigate(params.get("next") || "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Username">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
      </Field>
      <Field label="Password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
        Sign in
      </Button>
      {instance?.registration !== "closed" && (
        <p className="text-center text-sm text-muted">
          {instance?.registration === "invite" ? "Got an invite?" : "New here?"}{" "}
          <Link to="/register" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </form>
  );
};

export default LoginForm;
