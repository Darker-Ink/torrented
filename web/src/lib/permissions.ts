import type { User } from "./types";

export const PERM = {
  STREAM: 1 << 0,
  REQUEST: 1 << 1,
  ADD_MEDIA: 1 << 2,
  ADD_TORRENTS: 1 << 3,
  MANAGE_TORRENTS: 1 << 4,
  MANAGE_LIBRARY: 1 << 5,
  MANAGE_REQUESTS: 1 << 6,
  AUTO_APPROVE: 1 << 7,
  MANAGE_USERS: 1 << 8,
  VIEW_LOGS: 1 << 9,
  MANAGE_SETTINGS: 1 << 10,
  ADMIN: 1 << 30,
} as const;

export const can = (user: User | null | undefined, perm: number) => {
  if (!user) return false;
  const p = user.effective_permissions;
  return (p & PERM.ADMIN) !== 0 || (p & perm) === perm;
};

export const isStaff = (user: User | null | undefined) =>
  can(user, PERM.MANAGE_USERS) ||
  can(user, PERM.VIEW_LOGS) ||
  can(user, PERM.MANAGE_SETTINGS) ||
  can(user, PERM.MANAGE_TORRENTS) ||
  can(user, PERM.MANAGE_LIBRARY);
