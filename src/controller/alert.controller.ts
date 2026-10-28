// File: alert.controller.ts
// Path: src/controller/alert.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { createAuditLog } from "@/services/auditLogs.service";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import type { ListAlertsQuery } from "@/validators/alert.validators";

const ALERT_SELECT = {
  id: true,
  key: true,
  severity: true,
  source: true,
  title: true,
  body: true,
  link: true,
  meta: true,
  count: true,
  firstSeenAt: true,
  lastSeenAt: true,
  resolvedAt: true,
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
} as const satisfies Prisma.SystemAlertSelect;

// ── GET /system-alerts?status=open — open: newest problem first
export const listAlerts = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListAlertsQuery;
  const where: Prisma.SystemAlertWhereInput = {
    ...(q.status === "open" && { resolvedAt: null }),
    ...(q.status === "resolved" && { resolvedAt: { not: null } }),
    ...(q.severity && { severity: q.severity }),
    ...(q.source && { source: q.source }),
  };

  const [total, rows, open] = await Promise.all([
    prisma.systemAlert.count({ where }),
    prisma.systemAlert.findMany({
      where,
      select: ALERT_SELECT,
      orderBy: q.status === "resolved" ? { resolvedAt: "desc" } : { lastSeenAt: "desc" },
      ...toSkipTake(q),
    }),
    prisma.systemAlert.groupBy({ by: ["severity"], where: { resolvedAt: null }, _count: true }),
  ]);

  res.json({
    success: true,
    data: rows,
    meta: {
      ...pageMeta(total, q.page, q.limit),
      open: Object.fromEntries(open.map((o) => [o.severity, o._count])),
    },
  });
};

// ── POST /system-alerts/resolve { ids }
export const resolveAlerts = async (req: Request, res: Response) => {
  const { ids } = req.validatedBody as { ids: string[] };
  const { count } = await prisma.systemAlert.updateMany({
    where: { id: { in: ids }, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedById: req.user.id },
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "UPDATE",
    module: "system_alerts",
    recordId: ids.length === 1 ? ids[0]! : "bulk",
    newData: { resolved: ids },
    req,
  });

  res.json({ success: true, message: `${count} alert(s) resolved`, data: { resolved: count } });
};
