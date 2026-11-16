// File: recycle.controller.ts
// Path: src/controller/recycle.controller.ts
//
// Recycle bin & undo.
//   GET  /recycle-bin                      deleted / changed / added, by category, newest first
//   GET  /recycle-bin/categories           counts per category (for the tabs)
//   POST /recycle-bin/:id/restore          put one thing back
//   POST /recycle-bin/batches/:id/undo     put back everything one action did ("Undo")
// Scope (recycle_bin.read / .restore): OWN = what I did, wider scopes = what my people did.

import type { Request, Response } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { resolveScopeUserIds } from "@/services/scope.service";
import { restoreEntries } from "@/services/recycle.service";
import { notFound } from "@/utils/httpError";

const actorScope = async (req: Request): Promise<Prisma.ChangeLogWhereInput> => {
  const ids = req.scope ? await resolveScopeUserIds(req.user, req.scope) : null;
  return ids ? { actorId: { in: ids } } : {};
};

const listQuery = z.object({
  op: z.enum(["CREATE", "UPDATE", "DELETE"]).optional(),
  category: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  showRestored: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const listBin = async (req: Request, res: Response) => {
  const q = listQuery.parse(req.query);
  const where: Prisma.ChangeLogWhereInput = {
    AND: [
      await actorScope(req),
      q.op ? { op: q.op } : { op: { in: ["DELETE", "UPDATE"] } },
      q.category ? { category: q.category } : {},
      q.q ? { label: { contains: q.q, mode: "insensitive" } } : {},
      q.showRestored === "true" ? {} : { restoredAt: null },
      { source: { not: "restore" } },
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.changeLog.count({ where }),
    prisma.changeLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
  ]);
  const actors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const who = new Map(actors.map((u) => [u.id, `${u.firstName} ${u.lastName ?? ""}`.trim()]));
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, actor: r.actorId ? (who.get(r.actorId) ?? null) : "System" })),
    meta: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
  });
};

export const binCategories = async (req: Request, res: Response) => {
  const rows = await prisma.changeLog.groupBy({
    by: ["category", "op"],
    where: { AND: [await actorScope(req), { restoredAt: null, source: { not: "restore" } }] },
    _count: true,
  });
  res.json({ success: true, data: rows.map((r) => ({ category: r.category, op: r.op, count: r._count })) });
};

export const restoreOneEntry = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const entry = await prisma.changeLog.findFirst({ where: { id, ...(await actorScope(req)) } });
  if (!entry) throw notFound("Entry");
  const r = await restoreEntries([entry], req.user.id);
  res.json({ success: r.failed.length === 0, data: r, message: r.failed[0]?.reason ?? "Restored" });
};

export const undoBatch = async (req: Request, res: Response) => {
  const batchId = String(req.params.id);
  const entries = await prisma.changeLog.findMany({ where: { batchId, ...(await actorScope(req)) } });
  if (!entries.length) throw notFound("Action");
  const r = await restoreEntries(entries, req.user.id);
  res.json({ success: r.failed.length === 0, data: r, message: r.failed.length ? `${r.restored} undone, ${r.failed.length} could not be` : "Undone" });
};
