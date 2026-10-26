// File: outreach.controller.ts
// Path: src/controller/outreach.controller.ts
//
// Generated outreach packs (read-only). Visible when the pack's client is in
// the caller's outreach.read scope (same client visibility rule).

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere } from "@/services/scope.service";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import type { ListOutreachQuery } from "@/validators/stepRun.validators";

const PACK_SELECT = {
  id: true,
  model: true,
  fileKey: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
  spoc: { select: { id: true, firstName: true, lastName: true, designation: true, email: true } },
  sourceRun: { select: { id: true, step: { select: { label: true } } } },
  messages: {
    select: { id: true, sequenceNo: true, subject: true, body: true },
    orderBy: { sequenceNo: "asc" },
  },
} as const satisfies Prisma.OutreachPackSelect;

// ── GET /outreach
export const listOutreach = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListOutreachQuery;
  const canSeeContact = !!req.permissions!["spocs.view_contact"];

  const where: Prisma.OutreachPackWhereInput = {
    client: { deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.spocId && { spocId: q.spocId }),
  };

  const [total, packs] = await Promise.all([
    prisma.outreachPack.count({ where }),
    prisma.outreachPack.findMany({
      where,
      select: PACK_SELECT,
      orderBy: { createdAt: "desc" },
      ...toSkipTake(q),
    }),
  ]);

  res.json({
    success: true,
    // same mask rule as toSpocResponse
    data: canSeeContact ? packs : packs.map((p) => ({ ...p, spoc: { ...p.spoc, email: null } })),
    meta: pageMeta(total, q.page, q.limit),
  });
};
