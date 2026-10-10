import { Radio, RadioGroup } from "@headlessui/react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  SignalSlashIcon,
} from "@heroicons/react/20/solid";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import Badge from "@/features/ui/components/Badge";
import Button from "@/features/ui/components/Button";
import Field, { Input, Textarea } from "@/features/ui/components/Field";
import Skeleton from "@/features/ui/components/Skeleton";
import Toggle from "@/features/ui/components/Toggle";
import { toast } from "@/features/ui/components/Toaster";
import { api, errorMessage } from "@/lib/api";
import type { NetworkStatus, SettingsResponse } from "@/lib/types";
import { useNetwork, useSettings } from "../hooks/queries";
import Card from "./Card";

type Choice = { value: string; label: string; description: ReactNode; disabled?: boolean };

const Choices = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Choice[] }) => (
  <RadioGroup value={value} onChange={onChange} className="grid gap-2 sm:grid-cols-2">
    {options.map((o) => (
      <Radio
        key={o.value}
        value={o.value}
        disabled={o.disabled}
        className="group cursor-pointer rounded-lg p-3 ring-1 ring-line transition hover:bg-white/[0.03] focus:outline-none data-[checked]:bg-primary-muted data-[checked]:ring-primary/50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[focus]:ring-primary/60"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-4 shrink-0 place-items-center rounded-full ring-1 ring-line-strong group-data-[checked]:bg-primary group-data-[checked]:ring-primary">
            <span className="size-1.5 rounded-full bg-on-primary opacity-0 group-data-[checked]:opacity-100" />
          </span>
          <span className="text-sm font-semibold">{o.label}</span>
        </div>
        <p className="mt-1 pl-6 text-xs text-muted">{o.description}</p>
      </Radio>
    ))}
  </RadioGroup>
);

const masked = (v: string | undefined) => !!v && v.startsWith("••••");

const StatusLine = ({ status }: { status: NetworkStatus }) => {
  const t = status.torrents;
  const running = t.state === "running";
  const protectedRoute = running && t.route !== "direct";
  const Icon = !running ? SignalSlashIcon : protectedRoute ? ShieldCheckIcon : CheckCircleIcon;
  return (
    <div className="flex items-start gap-3">
      <Icon className={clsx("mt-0.5 size-5 shrink-0", !running ? "text-warning" : protectedRoute ? "text-success" : "text-muted")} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          {!running
            ? "Peer-to-peer is off"
            : protectedRoute
              ? `Torrent traffic goes through ${t.route}`
              : "Torrent traffic goes out directly"}
        </p>
        <p className="text-xs text-muted">
          {!running
            ? t.error
            : t.listen_port
              ? `Accepting peers on port ${t.listen_port}.`
              : "Outgoing connections only."}
          {status.seedbox && ` Seedbox: TorBox (${status.seedbox.mode === "only" ? "only" : "preferred"}).`}
        </p>
      </div>
    </div>
  );
};

type IpCheck = { torrent_ip: string | null; server_ip: string | null; error: string | null };

const NetworkSettings = () => {
  const settings = useSettings();
  const network = useNetwork();
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [ip, setIp] = useState<IpCheck | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings.data) setValues(settings.data.values);
  }, [settings.data]);

  const set = (key: string) => (v: string) => setValues((cur) => ({ ...cur, [key]: v }));
  const v = (key: string) => values[key] ?? "";
  const original = settings.data?.values ?? {};
  const changed = Object.fromEntries(
    Object.entries(values).filter(([k, val]) => (k.startsWith("vpn_") || k.startsWith("seedbox_")) && val !== original[k]),
  );
  const dirty = Object.keys(changed).length > 0;

  const save = async () => {
    setSaving(true);
    setIp(null);
    try {
      // Saving VPN or seedbox settings restarts the torrent session.
      const res = await api.put<SettingsResponse>("/settings", changed);
      client.setQueryData(["admin", "settings"], res);
      const status = await api.get<NetworkStatus>("/admin/network");
      client.setQueryData(["admin", "network"], status);
      if (status.torrents.state === "running" || status.seedbox?.mode === "only") toast.success("Saved and applied");
      else toast.error(`Saved, but peer-to-peer is off: ${status.torrents.error}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const reconnect = async () => {
    setSaving(true);
    try {
      client.setQueryData(["admin", "network"], await api.post<NetworkStatus>("/admin/network/apply"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const checkIp = async () => {
    setChecking(true);
    try {
      setIp(await api.post<IpCheck>("/admin/network/check-ip"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const testSeedbox = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ ok: boolean; email?: string; plan?: number; error?: string }>("/admin/seedbox/test", {
        api_key: v("seedbox_api_key"),
      });
      if (res.ok) toast.success(`Connected to TorBox${res.email ? ` as ${res.email}` : ""}`);
      else toast.error(res.error ?? "TorBox didn't accept the key");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  if (!settings.data || !network.data) {
    return (
      <div className="space-y-6">
        {[2, 4, 3].map((n, i) => (
          <div key={i} className="space-y-4 rounded-xl p-4 ring-1 ring-white/[0.06]">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: n }).map((_, j) => (
              <Skeleton key={j} className="h-12 w-full" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const mode = v("vpn_mode") || "off";
  const seedbox = v("seedbox_provider") || "off";
  const seedboxOnly = seedbox !== "off" && v("seedbox_mode") === "only";
  const sameIp = ip?.torrent_ip && ip.server_ip && ip.torrent_ip === ip.server_ip;

  return (
    <div className="space-y-6">
      <Card
        title="Status"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={reconnect} loading={saving && !dirty} disabled={dirty}>
              <ArrowPathIcon className="size-4" /> Reconnect
            </Button>
            <Button size="sm" onClick={checkIp} loading={checking} disabled={network.data.torrents.state !== "running"}>
              Check IP
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <StatusLine status={network.data} />
          {ip && (
            <div className="grid gap-2 rounded-lg bg-black/25 p-3 text-sm ring-1 ring-white/[0.06] sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted">Peers see</p>
                <p className="font-mono">{ip.torrent_ip ?? "unreachable"}</p>
              </div>
              <div>
                <p className="text-xs text-muted">This server's own address</p>
                <p className="font-mono">{ip.server_ip ?? "unknown"}</p>
              </div>
              {(ip.error || sameIp) && (
                <p className="flex items-center gap-1.5 text-xs text-warning sm:col-span-2">
                  <ExclamationTriangleIcon className="size-4" />
                  {ip.error ?? (network.data.torrents.route === "direct" ? "No VPN is set up." : "Both are the same, so the VPN isn't hiding this server.")}
                </p>
              )}
              {!ip.error && !sameIp && ip.torrent_ip && (
                <p className="flex items-center gap-1.5 text-xs text-success sm:col-span-2">
                  <ShieldCheckIcon className="size-4" /> Peers don't see this server's address.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="VPN">
        <div className="space-y-5">
          {seedboxOnly && (
            <p className="rounded-lg bg-primary-muted px-3 py-2 text-xs text-primary">
              Seedbox only mode is on, so this server never connects to peers and doesn't need a VPN.
            </p>
          )}
          <Choices
            value={mode}
            onChange={set("vpn_mode")}
            options={[
              { value: "off", label: "No VPN", description: "Connect to peers from this server's own address." },
              {
                value: "socks5",
                label: "SOCKS5 proxy",
                description: "Most VPN providers offer one. DHT, uTP and UDP trackers are switched off, since they can't be proxied.",
              },
              {
                value: "wireguard",
                label: "WireGuard",
                description: network.data.wireguard_supported
                  ? "Paste a config file. Only torrent traffic uses the tunnel; the web UI stays reachable as before."
                  : "Only available when the server runs on Linux.",
                disabled: !network.data.wireguard_supported,
              },
              {
                value: "interface",
                label: "Existing interface",
                description: "Bind torrent traffic to a tunnel that's already up, such as wg0 or tun0.",
              },
            ]}
          />

          {mode === "socks5" && (
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label="Host">
                <Input value={v("vpn_socks5_host")} onChange={(e) => set("vpn_socks5_host")(e.target.value)} placeholder="10.64.0.1" />
              </Field>
              <Field label="Port">
                <Input type="number" value={v("vpn_socks5_port")} onChange={(e) => set("vpn_socks5_port")(e.target.value)} />
              </Field>
              <Field label="Username" description="Leave empty if the proxy needs no login.">
                <Input value={v("vpn_socks5_username")} onChange={(e) => set("vpn_socks5_username")(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={v("vpn_socks5_password")}
                  onChange={(e) => set("vpn_socks5_password")(e.target.value)}
                  onFocus={(e) => masked(e.target.value) && e.target.select()}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          )}

          {mode === "interface" && (
            <Field
              label="Interface name"
              description="If the interface goes away, torrent traffic stops instead of falling back to the normal connection."
            >
              <Input value={v("vpn_interface")} onChange={(e) => set("vpn_interface")(e.target.value)} placeholder="wg0" className="font-mono" />
            </Field>
          )}

          {mode === "wireguard" && (
            <Field
              label="WireGuard config"
              description={
                masked(original.vpn_wireguard_config) && masked(v("vpn_wireguard_config"))
                  ? "A config is saved. Paste a new one to replace it."
                  : "The .conf file from your provider (Mullvad, Proton, AirVPN, ...). In Docker the container needs cap_add: NET_ADMIN."
              }
            >
              <Textarea
                value={masked(v("vpn_wireguard_config")) ? "" : v("vpn_wireguard_config")}
                onChange={(e) => set("vpn_wireguard_config")(e.target.value || original.vpn_wireguard_config || "")}
                placeholder={masked(original.vpn_wireguard_config) ? "Saved config (hidden)" : "[Interface]\nPrivateKey = ...\nAddress = 10.2.0.2/32\n\n[Peer]\nPublicKey = ...\nEndpoint = ...\nAllowedIPs = 0.0.0.0/0"}
                className="min-h-44 font-mono text-xs"
                spellCheck={false}
              />
            </Field>
          )}
        </div>
      </Card>

      <Card
        title="Seedbox"
        actions={
          seedbox !== "off" ? (
            <Button size="sm" variant="ghost" onClick={testSeedbox} loading={testing}>
              Test key
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          <Choices
            value={seedbox}
            onChange={set("seedbox_provider")}
            options={[
              { value: "off", label: "No seedbox", description: "Stream straight from peers." },
              {
                value: "torbox",
                label: "TorBox",
                description: "TorBox fetches the torrent on its servers (instantly if it's cached there) and files stream over HTTPS.",
              },
            ]}
          />
          {seedbox !== "off" && (
            <>
              <Field label="API key" description="From the settings page of your TorBox account.">
                <Input
                  value={v("seedbox_api_key")}
                  onChange={(e) => set("seedbox_api_key")(e.target.value)}
                  onFocus={(e) => masked(e.target.value) && e.target.select()}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Choices
                value={v("seedbox_mode") || "prefer"}
                onChange={set("seedbox_mode")}
                options={[
                  {
                    value: "prefer",
                    label: "Prefer the seedbox",
                    description: "Stream from TorBox once it has the files, and from peers until then.",
                  },
                  {
                    value: "only",
                    label: "Seedbox only",
                    description: "Never connect to peers, not even for metadata. Playback waits until TorBox has the files.",
                  },
                ]}
              />
              <Toggle
                checked={v("seedbox_add_on_import") !== "false"}
                onChange={(c) => set("seedbox_add_on_import")(String(c))}
                label="Send new torrents to the seedbox"
                description="Add torrents to TorBox as soon as they're attached to a title, so they're ready before anyone presses play."
              />
            </>
          )}
        </div>
      </Card>

      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3">
          <Badge tone="warning">Unsaved changes</Badge>
          <Button variant="primary" size="lg" onClick={save} loading={saving} className="shadow-xl shadow-black/40">
            Save and apply
          </Button>
        </div>
      )}
    </div>
  );
};

export default NetworkSettings;
