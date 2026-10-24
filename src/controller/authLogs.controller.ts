// File: authLogs.controller.ts
// Path: src/controller/authLogs.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import type { ListAuthLogsQuery } from "@/validators/authLogs.validators";

// ── GET /auth-logs
export const listAuthLogs = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListAuthLogsQuery;

  const where: Prisma.AuthLogsWhereInput = {
    ...(q.userId && { userId: q.userId }),
    ...(q.departmentId && { user: { departmentId: q.departmentId } }),
    ...(q.type && { type: q.type }),
    ...((q.startDate || q.endDate) && {
      createdAt: {
        ...(q.startDate && { gte: new Date(q.startDate) }),
        ...(q.endDate && { lte: new Date(q.endDate) }),
      },
    }),
  };

  const [total, logs] = await Promise.all([
    prisma.authLogs.count({ where }),
    prisma.authLogs.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: q.sortDir },
      ...toSkipTake(q),
    }),
  ]);

  res.json({ success: true, data: logs, meta: pageMeta(total, q.page, q.limit) });
};
