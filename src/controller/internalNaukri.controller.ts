// File: internalNaukri.controller.ts
// Path: candidate-service/src/modules/naukri/internalNaukri.controller.ts

// import { PrismaClient } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import type { Request, Response } from "express";
// const prisma = new PrismaClient();

// POST /internal/naukri/reconciliation  { recruiterIds: string[], from, to }
export async function getReconciliation(req: Request, res: Response) {
  const { recruiterIds, from, to } = req.body ?? {};
  if (!Array.isArray(recruiterIds) || !from || !to)
    return res.status(400).json({ error: "recruiterIds[], from, to required" });

  const rows = await prisma.naukriReconciliationDaily.findMany({
    where: {
      recruiterId: { in: recruiterIds },
      reportDate: { gte: new Date(from), lte: new Date(to) },
      isFrozen: true,
    },
    select: {
      recruiterId: true,
      reportDate: true,
      recruiterName: true,
      bu: true,
      rm: true,
      naukriCvConsumed: true,
      atsCaptured: true,
      difference: true,
      flags: true,
      fillStatus: true,
      atsBySource: true,
    },
  });
  res.json(rows);
}
