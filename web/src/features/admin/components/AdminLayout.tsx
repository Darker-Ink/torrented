import {
  ArchiveBoxIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  ServerStackIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useUser } from "@/features/auth/hooks/useSession";
import EmptyState from "@/features/ui/components/EmptyState";
import { can, PERM } from "@/lib/permissions";

type Props = { title: string; description?: string; actions?: ReactNode; children: ReactNode; requires?: number };

const AdminLayout = ({ title, description, actions, children, requires }: Props) => {
  const user = useUser();
  const links = [
    { to: "/admin", label: "Overview", icon: ChartBarIcon, show: can(user, PERM.VIEW_LOGS) || can(user, PERM.MANAGE_SETTINGS) },
    { to: "/admin/users", label: "Users", icon: UsersIcon, show: can(user, PERM.MANAGE_USERS) },
    { to: "/admin/torrents", label: "Torrents", icon: ServerStackIcon, show: can(user, PERM.MANAGE_TORRENTS) },
    { to: "/admin/library", label: "Library", icon: ArchiveBoxIcon, show: can(user, PERM.MANAGE_LIBRARY) },
    { to: "/admin/logs", label: "Logs", icon: DocumentTextIcon, show: can(user, PERM.VIEW_LOGS) },
    { to: "/admin/network", label: "VPN & seedbox", icon: GlobeAltIcon, show: can(user, PERM.MANAGE_SETTINGS) },
    { to: "/admin/settings", label: "Settings", icon: Cog6ToothIcon, show: can(user, PERM.MANAGE_SETTINGS) },
  ].filter((l) => l.show);

  const allowed = requires === undefined || can(user, requires);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-24 pb-10 sm:px-10 lg:flex-row">
      <aside className="shrink-0 lg:w-52">
        <p className="mb-3 px-3 text-xs font-semibold tracking-wider text-subtle uppercase">Admin</p>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto lg:flex-col">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/admin"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap transition",
                  isActive ? "bg-white/[0.08] font-semibold text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg",
                )
              }
            >
              <l.icon className="size-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
        {allowed ? children : <EmptyState title="No access">You don't have permission to view this page.</EmptyState>}
      </div>
    </div>
  );
};

export default AdminLayout;
