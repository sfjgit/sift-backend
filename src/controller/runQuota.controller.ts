// File: runQuota.controller.ts
// Path: src/controller/runQuota.controller.ts
//
// Run slots: admins set how many pipeline runs people may start per
// day / week / month. Enforced in runRules.service.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { createAuditLog } from "@/services/auditLogs.service";
import { ApiError, notFound } from "@/utils/httpError";
import { hasNoSlots, slotsFor } from "@/services/pipeline/runRules.service";
import type { CreateRunQuotaInput, UpdateRunQuotaInput } from "@/validators/runQuota.validators";

const QUOTA_SELECT = {
  id: true,
  period: true,
  maxRuns: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  step: { select: { id: true, key: true, label: true } },
  role: { select: { id: true, name: true } },
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const satisfies Prisma.RunQuotaSelect;

const assertRefs = async (b: CreateRunQuotaInput) => {
  const [step, role, user] = await Promise.all([
    b.stepId ? prisma.pipelineStep.count({ where: { id: b.stepId } }) : 1,
    b.roleId ? prisma.role.count({ where: { id: b.roleId } }) : 1,
    b.userId ? prisma.user.count({ where: { id: b.userId } }) : 1,
  ]);
  if (!step) throw notFound("Step");
  if (!role) throw notFound("Role");
  if (!user) throw notFound("User");
};

// ── GET /run-quotas — every rule, broadest first
export const listRunQuotas = async (_req: Request, res: Response) => {
  const rows = await prisma.runQuota.findMany({
    select: QUOTA_SELECT,
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  res.json({ success: true, data: rows });
};

// ── POST /run-quotas
export const createRunQuota = async (req: Request, res: Response) => {
  const b = req.validatedBody as CreateRunQuotaInput;
  await assertRefs(b);
  const dup = await prisma.runQuota.count({
    where: { stepId: b.stepId ?? null, roleId: b.roleId ?? null, userId: b.userId ?? null, period: b.period },
  });
  if (dup) throw ApiError(409, "A rule for this step, period and person / role already exists — edit it instead", "DUPLICATE");

  const row = await prisma.runQuota.create({
    data: {
      stepId: b.stepId ?? null,
      roleId: b.roleId ?? null,
      userId: b.userId ?? null,
      period: b.period,
      maxRuns: b.maxRuns,
      isActive: b.isActive ?? true,
      createdById: req.user.id,
    },
    select: QUOTA_SELECT,
  });
  await createAuditLog({ actorId: req.user.id, action: "CREATE", module: "run_slots", recordId: row.id, newData: b, req });
  res.status(201).json({ success: true, message: "Run slot rule added", data: row });
};

// ── PATCH /run-quotas/:id
export const updateRunQuota = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const b = req.validatedBody as UpdateRunQuotaInput;
  const before = await prisma.runQuota.findUnique({ where: { id } });
  if (!before) throw notFound("Run slot rule");
  const data: Prisma.RunQuotaUpdateInput = {
    ...(b.period && { period: b.period }),
    ...(b.maxRuns !== undefined && { maxRuns: b.maxRuns }),
    ...(b.isActive !== undefined && { isActive: b.isActive }),
  };
  const row = await prisma.runQuota.update({ where: { id }, data, select: QUOTA_SELECT });
  await createAuditLog({ actorId: req.user.id, action: "UPDATE", module: "run_slots", recordId: id,
    oldData: { period: before.period, maxRuns: before.maxRuns, isActive: before.isActive }, newData: b, req });
  res.json({ success: true, message: "Run slot rule updated", data: row });
};

// ── DELETE /run-quotas/:id
export const deleteRunQuota = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const before = await prisma.runQuota.findUnique({ where: { id } });
  if (!before) throw notFound("Run slot rule");
  await prisma.runQuota.delete({ where: { id } });
  await createAuditLog({ actorId: req.user.id, action: "DELETE", module: "run_slots", recordId: id, oldData: before, req });
  res.json({ success: true, message: "Run slot rule removed" });
};

// ── GET /me/run-slots?stepId= — what the caller has left
export const getMyRunSlots = async (req: Request, res: Response) => {
  const { stepId } = req.validatedQuery as { stepId?: string };
  const [unlimited, slots] = await Promise.all([hasNoSlots(req.user), slotsFor(req.user, stepId)]);
  res.json({ success: true, data: { unlimited, slots } });
};
