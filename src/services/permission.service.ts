// File: permission.service.ts
// Path: src/services/permission.service.ts
//
// Builds a user's permission map. Super admin gets everything at ALL with no
// DB rows. Everyone else gets their role's map, cached per role (users with the
// same role share it, so one role edit busts one key).
//
// Cache is in-process. With more than one instance, a role edit reaches other
// instances only after CACHE_TTL_MS — swap for Redis if that gap matters.

import { PermissionScope } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  ALL_PERMISSION_KEYS,
  PermissionKey,
  isPermissionKey,
  isScopedAction,
} from "@/config/permissions.registry";
import type { AuthUser } from "@/types/express";

export type Grant = PermissionScope | true; // true = unscoped action granted
export type PermissionMap = Partial<Record<PermissionKey, Grant>>;

const CACHE_TTL_MS = 60 * 1000;
const roleCache = new Map<string, { map: PermissionMap; expiresAt: number }>();

const SUPER_ADMIN_MAP: PermissionMap = Object.fromEntries(
  ALL_PERMISSION_KEYS.map((k) => [k, isScopedAction(k) ? "ALL" : true]),
);

const buildRoleMap = async (roleId: string): Promise<PermissionMap> => {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionKey: true, scope: true },
  });

  const map: PermissionMap = {};
  for (const row of rows) {
    if (!isPermissionKey(row.permissionKey)) continue; // stale key of a removed action
    map[row.permissionKey] = isScopedAction(row.permissionKey) ? row.scope : true;
  }
  return map;
};

const getRoleMap = async (roleId: string): Promise<PermissionMap> => {
  const cached = roleCache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const map = await buildRoleMap(roleId);
  roleCache.set(roleId, { map, expiresAt: Date.now() + CACHE_TTL_MS });
  return map;
};

export const getUserPermissionMap = (
  user: Pick<AuthUser, "isSuperAdmin" | "roleId">,
): Promise<PermissionMap> =>
  user.isSuperAdmin ? Promise.resolve(SUPER_ADMIN_MAP) : getRoleMap(user.roleId);

export const bustRolePermissionCache = (roleId: string) => {
  roleCache.delete(roleId);
};
