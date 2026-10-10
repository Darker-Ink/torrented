import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import Select from "@/features/ui/components/Select";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { useInstance, useSetUser } from "../hooks/useSession";

const steps = ["Welcome", "Account", "Server", "Metadata"];

const Check = ({ ok, children, hint }: { ok: boolean; children: ReactNode; hint: ReactNode }) => (
  <div className="flex items-start gap-3 rounded-lg border border-line bg-white/[0.03] p-4">
    {ok ? (
      <CheckCircleIcon className="size-5 shrink-0 text-success" />
    ) : (
      <ExclamationTriangleIcon className="size-5 shrink-0 text-warning" />
    )}
    <div className="space-y-0.5">
      <p className="text-sm font-semibold">{children}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  </div>
);

const SetupWizard = () => {
  const { data: instance } = useInstance();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    password: "",
    confirm: "",
    instance_name: "torrented",
    registration: "invite",
    tmdb_api_key: "",
    tvdb_api_key: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setUser = useSetUser();
  const navigate = useNavigate();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (step === 1) {
      if (form.password.length < 8) return setError("Password must be at least 8 characters");
      if (form.password !== form.confirm) return setError("Passwords don't match");
    }
    setStep((s) => s + 1);
  };

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await api.post<User>("/setup", {
        username: form.username,
        display_name: form.display_name || undefined,
        password: form.password,
        instance_name: form.instance_name,
        registration: form.registration,
        tmdb_api_key: form.tmdb_api_key || undefined,
        tvdb_api_key: form.tvdb_api_key || undefined,
      });
      setUser(user);
      navigate("/discover", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (errorMessage(err).toLowerCase().includes("username")) setStep(1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <ol className="flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-2">
            <span className={clsx("h-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-white/10")} />
            <span className={clsx("text-xs font-medium", i === step ? "text-fg" : "text-subtle")}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Everything lives in two small databases next to the binary: one for your library (shareable), one for
            accounts and activity. Let's check what this machine can do.
          </p>
          <Check ok={!!instance?.ffmpeg} hint="Used to repackage MKV files and convert audio browsers can't play.">
            {instance?.ffmpeg ? "ffmpeg found" : "ffmpeg not found"}
          </Check>
          <Check ok={!!instance?.ffprobe} hint="Used to scan files inside torrents without downloading them.">
            {instance?.ffprobe ? "ffprobe found" : "ffprobe not found"}
          </Check>
          {!(instance?.ffmpeg && instance?.ffprobe) && (
            <p className="text-xs text-muted">
              You can continue without them — MP4/WebM files will still play. Install ffmpeg and restart to enable
              everything else.
            </p>
          )}
          <Button variant="primary" size="lg" className="w-full" onClick={() => next()}>
            Get started
          </Button>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={next} className="space-y-4">
          <p className="text-sm text-muted">This is the owner account. It can do everything.</p>
          <Field label="Username">
            <Input value={form.username} onChange={set("username")} autoFocus required />
          </Field>
          <Field label="Display name">
            <Input value={form.display_name} onChange={set("display_name")} placeholder="Optional" />
          </Field>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required />
          </Field>
          {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button type="submit" variant="primary" className="flex-1">
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={next} className="space-y-4">
          <Field label="Server name" description="Shown in the header and on the sign-in page.">
            <Input value={form.instance_name} onChange={set("instance_name")} required />
          </Field>
          <Field label="Who can sign up?">
            <Select
              value={form.registration}
              onChange={(v) => setForm((f) => ({ ...f, registration: v }))}
              options={[
                { value: "invite", label: "Invited people only", description: "You hand out invite links." },
                { value: "open", label: "Anyone with the link", description: "Good for a trusted LAN." },
                { value: "closed", label: "Nobody", description: "You create accounts yourself." },
              ]}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit" variant="primary" className="flex-1">
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={finish} className="space-y-4">
          <p className="text-sm text-muted">
            Posters, episode lists and descriptions come from TMDB and TVDB. Built-in keys work out of the box, but
            you can use your own.
          </p>
          <Field label="TMDB API key" description="themoviedb.org → Settings → API. Leave empty for the built-in key.">
            <Input value={form.tmdb_api_key} onChange={set("tmdb_api_key")} placeholder="Built-in key" />
          </Field>
          <Field label="TVDB API key" description="thetvdb.com → Dashboard → API keys. Leave empty for the built-in key.">
            <Input value={form.tvdb_api_key} onChange={set("tvdb_api_key")} placeholder="Built-in key" />
          </Field>
          {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button type="submit" variant="primary" className="flex-1" loading={loading}>
              Finish setup
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default SetupWizard;
