// File: columnAccess.controller.ts
// Path: src/controller/columnAccess.controller.ts
//
// Column access — which table columns each role may NOT see (a deny list, so a
// new column is visible until an admin hides it). An admin arranges it by drag
// and drop on the table itself; it is stored on the tenant (Tenant.settings
// .columnAccess[table][roleId] = column ids), no extra table. Super admin always
// sees every column.
//
// GET  /column-access/:table/mine          the columns hidden from me
// GET  /column-access/:table               every role + what it hides (roles.read)
// PUT  /column-access/:table/:roleId       save one role's hidden columns (roles.assign_permissions)

import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import { createAuditLog } from "@/services/auditLogs.service";

/** tables whose columns can be controlled */
export const ACCESS_TABLES = ["clients"] as const;

type AccessMap = Record<string, Record<string, string[]>>; // table → role → hidden ids

export const tableParams = z.object({ table: z.enum(ACCESS_TABLES) });
export const roleTableParams = z.object({ table: z.enum(ACCESS_TABLES), roleId: z.string().uuid() });
export const saveAccessBody = z
  .object({ hidden: z.array(z.string().min(1).max(80)).max(400) })
  .strict();

const readSettings = async () => {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantIdOrThrow() }, select: { settings: true } });
  const settings = (t.settings ?? {}) as Record<string, unknown>;
  return { settings, access: (settings.columnAccess ?? {}) as AccessMap };
};

export const getMyHiddenColumns = async (req: Request, res: Response) => {
  const { table } = tableParams.parse(req.params);
  if (req.user.isSuperAdmin) {
    res.json({ success: true, data: { hidden: [] } });
    return;
  }
  const { access } = await readSettings();
  res.json({ success: true, data: { hidden: access[table]?.[req.user.roleId] ?? [] } });
};

export const getColumnAccess = async (req: Request, res: Response) => {
  const { table } = tableParams.parse(req.params);
  const [{ access }, roles] = await Promise.all([
    readSettings(),
    prisma.role.findMany({
      where: { tenantId: tenantIdOrThrow() },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isSystem: true, _count: { select: { users: true } } },
    }),
  ]);
  res.json({
    success: true,
    data: {
      roles: roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem, users: r._count.users })),
      hidden: access[table] ?? {},
    },
  });
};

export const saveColumnAccess = async (req: Request, res: Response) => {
  const { table, roleId } = roleTableParams.parse(req.params);
  const { hidden } = saveAccessBody.parse(req.body);
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId: tenantIdOrThrow() }, select: { id: true } });
  if (!role) {
    res.status(404).json({ success: false, code: "NOT_FOUND", message: "Role not found." });
    return;
  }
  const { settings, access } = await readSettings();
  const before = access[table]?.[roleId] ?? [];
  const next: AccessMap = { ...access, [table]: { ...(access[table] ?? {}), [roleId]: [...new Set(hidden)] } };
  await prisma.tenant.update({
    where: { id: tenantIdOrThrow() },
    data: { settings: { ...settings, columnAccess: next } as object },
  });
  await createAuditLog({
    actorId: req.user.id,
    action: "UPDATE",
    module: "column_access",
    recordId: roleId,
    oldData: { table, hidden: before },
    newData: { table, hidden },
    req,
  });
  res.json({ success: true, data: { hidden: next[table]![roleId] } });
};
