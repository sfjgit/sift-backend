// File: auditLog.controller.ts
// Path: src/controller/auditLog.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import type { ListAuditLogsQuery } from "@/validators/authLogs.validators";

// ── GET /audit-logs
export const listAuditLogs = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListAuditLogsQuery;

  const where: Prisma.AuditLogWhereInput = {
    ...(q.actorId && { actorId: q.actorId }),
    ...(q.module && { module: q.module }),
    ...(q.action && { action: q.action }),
    ...(q.recordId && { recordId: q.recordId }),
    ...((q.startDate || q.endDate) && {
      createdAt: {
        ...(q.startDate && { gte: new Date(q.startDate) }),
        ...(q.endDate && { lte: new Date(q.endDate) }),
      },
    }),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: q.sortDir },
      ...toSkipTake(q),
    }),
  ]);

  res.json({ success: true, data: logs, meta: pageMeta(total, q.page, q.limit) });
};
