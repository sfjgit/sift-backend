// File: permission.controller.ts
// Path: src/controller/permission.controller.ts

import { Request, Response } from "express";
import { PermissionScope } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  MODULES,
  PermissionKey,
  SCOPE_DESCRIPTIONS,
  findMissingRequirements,
  isScopedAction,
} from "@/config/permissions.registry";
import {
  bustRolePermissionCache,
  getUserPermissionMap,
} from "@/services/permission.service";
import type { GrantInput } from "@/validators/role.validator";
import { ApiError, notFound } from "@/utils/httpError";

// grid ticks → rows; unscoped actions always store OWN (ignored on read).
// Rejects a set where an action is ticked without what it requires.
export const toGrantRows = (grants: GrantInput[]) => {
  const byKey = new Map<PermissionKey, PermissionScope>();
  for (const g of grants) {
    const key = g.permissionKey as PermissionKey;
    byKey.set(key, isScopedAction(key) ? g.scope ?? "OWN" : "OWN");
  }

  const missing = findMissingRequirements([...byKey.keys()]);
  if (missing.length) {
    throw ApiError(
      400,
      `Missing required permissions: ${missing
        .map((m) => `${m.key} needs ${m.missing.join(", ")}`)
        .join("; ")}`,
      "MISSING_REQUIRED_PERMISSIONS",
    );
  }

  return [...byKey].map(([permissionKey, scope]) => ({ permissionKey, scope }));
};

// ── GET /permissions/registry — admin grid rows/columns come from here
export const getRegistry = (_req: Request, res: Response) => {
  res.json({ success: true, data: MODULES });
};

// ── GET /permissions/scopes
export const getScopes = (_req: Request, res: Response) => {
  const data = Object.values(PermissionScope).map((value) => ({
    value,
    label: value.replace(/_/g, " "),
    desc: SCOPE_DESCRIPTIONS[value],
  }));
  res.json({ success: true, data });
};

// ── GET /me/permissions — frontend show/hide
export const getMyPermissions = async (req: Request, res: Response) => {
  res.json({ success: true, data: await getUserPermissionMap(req.user) });
};

// ── GET /roles/:roleId/permissions
export const getRoleGrants = async (req: Request, res: Response) => {
  const { roleId } = req.validatedParams;

  const grants = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionKey: true, scope: true },
  });

  res.json({ success: true, data: grants });
};

// ── PUT /roles/:roleId/permissions — full replace; the grid sends every ticked box
export const saveRoleGrants = async (req: Request, res: Response) => {
  const { roleId } = req.validatedParams;
  const { grants } = req.validatedBody as { grants: GrantInput[] };

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw ApiError(400, "System roles cannot be edited", "SYSTEM_ROLE");

  const rows = toGrantRows(grants).map((g) => ({ roleId, ...g }));

  const before = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionKey: true, scope: true },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: rows }),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "ROLE_PERMISSIONS_UPDATED",
        module: "roles",
        recordId: roleId,
        oldData: before,
        newData: rows,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    }),
  ]);

  bustRolePermissionCache(roleId);
  res.json({ success: true, data: { count: rows.length } });
};
