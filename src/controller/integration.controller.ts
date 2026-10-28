// File: integration.controller.ts
// Path: src/controller/integration.controller.ts
//
// Admin → Integrations: external services, their steps, live health.
// API keys stay on the engine; we only show set / not set and run key tests.

import crypto from "crypto";
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { notFound } from "@/utils/httpError";
import { definedOnly } from "@/utils/pagination";
import { createAuditLog } from "@/services/auditLogs.service";
import { hashServiceKey } from "@/middleware/serviceAuth";
import { engine } from "@/services/pipeline/engineClient";
import type { UpdatePipelineStepInput, UpdateServiceInput } from "@/validators/integration.validators";

const SERVICE_SELECT = {
  id: true,
  code: true,
  name: true,
  baseUrl: true,
  outboundKeyEnv: true,
  scopes: true,
  timeoutMins: true,
  maxDispatchTries: true,
  isActive: true,
  lastUsedAt: true,
  lastHealthAt: true,
  lastHealthOk: true,
  inboundKeyHash: true,
  steps: {
    select: { id: true, key: true, label: true, target: true, uiOrder: true, userClientLimit: true, rerunAfterDays: true, isActive: true, config: true },
    orderBy: [{ uiOrder: { sort: "asc" } }],
  },
} as const satisfies Prisma.ExternalServiceSelect;

const toServiceResponse = ({ inboundKeyHash, outboundKeyEnv, ...s }: Prisma.ExternalServiceGetPayload<{ select: typeof SERVICE_SELECT }>) => ({
  ...s,
  outboundKeyEnv,
  outboundKeySet: !!(outboundKeyEnv && process.env[outboundKeyEnv]),
  inboundKeySet: !!inboundKeyHash,
});

// ── GET /integrations
export const listIntegrations = async (_req: Request, res: Response) => {
  const services = await prisma.externalService.findMany({ select: SERVICE_SELECT, orderBy: { name: "asc" } });
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const runs = await prisma.stepRun.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  res.json({
    success: true,
    data: {
      services: services.map(toServiceResponse),
      last24h: Object.fromEntries(runs.map((r) => [r.status, r._count._all])),
    },
  });
};

const findService = async (id: string) => {
  const svc = await prisma.externalService.findUnique({ where: { id }, select: SERVICE_SELECT });
  if (!svc) throw notFound("Service");
  return svc;
};

// ── GET /integrations/:id/health — live: worker, keys set, limits (from the engine)
export const getServiceHealth = async (req: Request, res: Response) => {
  const svc = await findService(req.validatedParams.id);
  const reply = await engine.health(svc);
  const ok = reply.ok && (reply.data as any)?.ok !== false;
  await prisma.externalService.update({ where: { id: svc.id }, data: { lastHealthAt: new Date(), lastHealthOk: ok } });
  res.json({ success: true, data: { ok, reachable: reply.status !== null, error: reply.error, engine: reply.data } });
};

// ── POST /integrations/:id/test-key { provider }
export const testServiceKey = async (req: Request, res: Response) => {
  const svc = await findService(req.validatedParams.id);
  const reply = await engine.testKey(svc, req.validatedBody.provider);
  res.json({
    success: true,
    data: { ok: reply.ok && !!reply.data?.ok, detail: reply.data?.detail ?? reply.error },
  });
};

// ── PATCH /integrations/:id
export const updateService = async (req: Request, res: Response) => {
  const before = await findService(req.validatedParams.id);
  const body = req.validatedBody as UpdateServiceInput;
  const after = await prisma.externalService.update({
    where: { id: before.id },
    data: definedOnly(body),
    select: SERVICE_SELECT,
  });
  await createAuditLog({ actorId: req.user.id, action: "UPDATE", module: "integrations", recordId: before.id,
    oldData: { baseUrl: before.baseUrl, isActive: before.isActive }, newData: body, req });
  res.json({ success: true, message: "Service updated", data: toServiceResponse(after) });
};

// ── POST /integrations/:id/rotate-key — new inbound key, shown once
export const rotateInboundKey = async (req: Request, res: Response) => {
  const svc = await findService(req.validatedParams.id);
  const key = `svc_${crypto.randomBytes(32).toString("base64url")}`;
  await prisma.externalService.update({ where: { id: svc.id }, data: { inboundKeyHash: hashServiceKey(key) } });
  await createAuditLog({ actorId: req.user.id, action: "ROTATE_KEY", module: "integrations", recordId: svc.id, req });
  res.json({
    success: true,
    message: "New key created. Put it in the engine's CRM_CALLBACK_KEY — it is not shown again.",
    data: { key },
  });
};

// ── PATCH /integrations/steps/:id
export const updatePipelineStep = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdatePipelineStepInput;
  const before = await prisma.pipelineStep.findUnique({ where: { id } });
  if (!before) throw notFound("Step");
  const { config, ...rest } = body;
  const step = await prisma.pipelineStep.update({
    where: { id },
    data: {
      ...definedOnly(rest),
      ...(config !== undefined && { config: config === null ? Prisma.DbNull : (config as Prisma.InputJsonObject) }),
    },
  });
  await createAuditLog({ actorId: req.user.id, action: "UPDATE", module: "pipeline_steps", recordId: id,
    oldData: { label: before.label, isActive: before.isActive, userClientLimit: before.userClientLimit,
      rerunAfterDays: before.rerunAfterDays }, newData: body, req });
  res.json({ success: true, message: "Step updated", data: step });
};
