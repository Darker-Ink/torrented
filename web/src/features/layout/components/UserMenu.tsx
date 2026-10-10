import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from "@headlessui/react";
import {
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { isStaff } from "@/lib/permissions";
import type { User } from "@/lib/types";
import Avatar from "./Avatar";

type Props = { user: User };

const itemClass =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg/90 data-[focus]:bg-white/[0.07] data-[focus]:text-fg";

const UserMenu = ({ user }: Props) => {
  const client = useQueryClient();
  const name = user.display_name || user.username;

  const signOut = async () => {
    await api.post("/auth/logout").catch(() => {});
    client.clear();
    window.location.href = "/login";
  };

  return (
    <Menu>
      <MenuButton className="flex items-center gap-2 rounded-md p-0.5 transition hover:opacity-90">
        <Avatar name={name} />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        transition
        className="z-50 mt-2 w-56 rounded-lg border border-line bg-surface p-1.5 shadow-xl shadow-black/50 transition duration-100 focus:outline-none data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted capitalize">{user.role}</p>
        </div>
        <MenuSeparator className="my-1 h-px bg-line" />
        <MenuItem>
          <Link to="/account" className={itemClass}>
            <UserCircleIcon className="size-4 text-muted" /> Account
          </Link>
        </MenuItem>
        {isStaff(user) && (
          <MenuItem>
            <Link to="/admin" className={itemClass}>
              <ShieldCheckIcon className="size-4 text-muted" /> Admin
            </Link>
          </MenuItem>
        )}
        {isStaff(user) && (
          <MenuItem>
            <Link to="/admin/settings" className={itemClass}>
              <Cog6ToothIcon className="size-4 text-muted" /> Settings
            </Link>
          </MenuItem>
        )}
        <MenuSeparator className="my-1 h-px bg-line" />
        <MenuItem>
          <button onClick={signOut} className={itemClass}>
            <ArrowRightStartOnRectangleIcon className="size-4 text-muted" /> Sign out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
};

export default UserMenu;
