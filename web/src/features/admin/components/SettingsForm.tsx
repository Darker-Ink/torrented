import { useEffect, useMemo, useState } from "react";
import Button from "@/features/ui/components/Button";
import Field, { Input } from "@/features/ui/components/Field";
import Select from "@/features/ui/components/Select";
import Skeleton from "@/features/ui/components/Skeleton";
import Toggle from "@/features/ui/components/Toggle";
import { toast } from "@/features/ui/components/Toaster";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import type { SettingDef, SettingsResponse } from "@/lib/types";
import { useSettings } from "../hooks/queries";
import Card from "./Card";
import PermissionEditor from "./PermissionEditor";

const SettingControl = ({ def, value, onChange }: { def: SettingDef; value: string; onChange: (v: string) => void }) => {
  if (def.key === "default_permissions") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">{def.label}</p>
        <p className="text-xs text-muted">{def.description}</p>
        <PermissionEditor value={Number(value) || 0} onChange={(v) => onChange(String(v))} allowAdmin={false} />
      </div>
    );
  }
  switch (def.kind) {
    case "bool":
      return <Toggle checked={value === "true"} onChange={(v) => onChange(String(v))} label={def.label} description={def.description} />;
    case "select":
      return (
        <Field label={def.label} description={def.description}>
          <Select value={value} onChange={onChange} options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
        </Field>
      );
    default:
      return (
        <Field label={def.label} description={def.description}>
          <Input
            type={def.kind === "number" ? "number" : "text"}
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => def.kind === "secret" && value.startsWith("••••") && e.target.select()}
            placeholder={def.kind === "secret" ? "Built-in key" : def.default}
            className={def.kind === "secret" ? "font-mono" : undefined}
          />
        </Field>
      );
  }
};

const SettingsForm = () => {
  const { data } = useSettings();
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data) setValues(data.values);
  }, [data]);

  const groups = useMemo(() => {
    const out: Record<string, SettingDef[]> = {};
    data?.definitions.forEach((d) => {
      (out[d.group] ??= []).push(d);
    });
    return out;
  }, [data]);

  const dirty = data && Object.keys(values).some((k) => values[k] !== data.values[k]);

  const save = async () => {
    if (!data) return;
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== data.values[k]));
    setSaving(true);
    try {
      const res = await api.put<SettingsResponse>("/settings", changed);
      client.setQueryData(["admin", "settings"], res);
      client.invalidateQueries({ queryKey: ["instance"] });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const testKeys = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ tmdb: { ok: boolean; error: string | null }; tvdb: { ok: boolean; error: string | null } }>(
        "/settings/test-keys",
        { tmdb_api_key: values.tmdb_api_key, tvdb_api_key: values.tvdb_api_key },
      );
      const msg = (name: string, r: { ok: boolean; error: string | null }) => `${name}: ${r.ok ? "working" : r.error}`;
      (res.tmdb.ok && res.tvdb.ok ? toast.success : toast.error)(`${msg("TMDB", res.tmdb)} · ${msg("TVDB", res.tvdb)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  if (!data) {
    return (
      <div className="space-y-6">
        {[3, 4, 5].map((n, i) => (
          <div key={i} className="space-y-5 rounded-xl p-4 ring-1 ring-white/[0.06]">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: n }).map((_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([group, defs]) => (
        <Card
          key={group}
          title={group}
          actions={
            group === "Metadata" ? (
              <Button size="sm" variant="ghost" onClick={testKeys} loading={testing}>
                Test keys
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-5">
            {defs.map((d) => (
              <SettingControl
                key={d.key}
                def={d}
                value={values[d.key] ?? d.default}
                onChange={(v) => setValues((cur) => ({ ...cur, [d.key]: v }))}
              />
            ))}
          </div>
        </Card>
      ))}
      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" size="lg" onClick={save} loading={saving} disabled={!dirty} className="shadow-xl shadow-black/40">
          Save settings
        </Button>
      </div>
    </div>
  );
};

export default SettingsForm;
