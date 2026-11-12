// File: aiSettings.controller.ts
// Path: src/controller/aiSettings.controller.ts
//
// AI settings (ai_assistant.settings_manage — Super Admin by default). The ONLY
// way to change modes, quotas, budget, pricing and learned templates: through
// this admin UI, never through the AI. Writes touch AI-owned tables only.
//
//   GET    /ai/settings                      everything below in one call
//   PUT    /ai/settings                      org switches, monthly budget, alert thresholds
//   PUT    /ai/settings/quotas               upsert policies (roleId null = org default)
//   POST   /ai/settings/overrides            per-user limit
//   DELETE /ai/settings/overrides/:id
//   POST   /ai/settings/pricing              new price row (old audit rows keep their cost)
//   GET    /ai/settings/templates            learned / seeded command templates
//   PATCH  /ai/settings/templates/:id        activate / deactivate

import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import { getModeSetting } from "@/services/ai/settings.service";
import { budgetState, forgetPriceCache } from "@/services/ai/cost.service";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { aiDbHasReadOnlyRole } from "@/config/aiDb";
import { aiKillSwitchOn, llmConfigured } from "@/services/ai/settings.service";

const MODES = ["COMMAND", "CANVAS", "EXPORT"] as const;
const PERIODS = ["DAY", "WEEK", "MONTH"] as const;

export const getSettings = async (req: Request, res: Response) => {
  const [setting, roles, policies, overrides, pricing, budget] = await Promise.all([
    getModeSetting(),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.aiQuotaPolicy.findMany({ orderBy: [{ mode: "asc" }, { period: "asc" }] }),
    prisma.aiUserQuotaOverride.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.aiModelPricing.findMany({ orderBy: { effectiveFrom: "desc" }, take: 20 }),
    budgetState(),
  ]);
  const users = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: overrides.map((o) => o.userId) } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    ).map((u) => [u.id, u]),
  );
  res.json({
    success: true,
    data: {
      setting: { ...setting, monthlyBudgetInr: Number(setting.monthlyBudgetInr) },
      budget,
      roles,
      policies,
      overrides: overrides.map((o) => ({ ...o, user: users.get(o.userId) ?? null })),
      pricing: pricing.map((p) => ({
        ...p,
        inputPerMTokUsd: Number(p.inputPerMTokUsd),
        outputPerMTokUsd: Number(p.outputPerMTokUsd),
        cacheReadPerMTokUsd: Number(p.cacheReadPerMTokUsd),
        cacheWritePerMTokUsd: Number(p.cacheWritePerMTokUsd),
        usdToInr: Number(p.usdToInr),
      })),
      defaults: { quotas: AI_DEFAULTS.quotas, model: AI_DEFAULTS.model, pricing: AI_DEFAULTS.pricing, exportRowCap: AI_DEFAULTS.exportRowCap },
      system: { killSwitch: aiKillSwitchOn(), llmReady: llmConfigured(), readOnlyRole: aiDbHasReadOnlyRole() },
    },
  });
};

export const settingsBody = z
  .object({
    commandEnabled: z.boolean().optional(),
    canvasEnabled: z.boolean().optional(),
    monthlyBudgetInr: z.number().min(0).max(100_000_000).optional(),
    alertThresholds: z.array(z.number().int().min(1).max(100)).max(6).optional(),
  })
  .strict();

export const updateSettings = async (req: Request, res: Response) => {
  const b = settingsBody.parse(req.body);
  const data = {
    ...(b.commandEnabled !== undefined && { commandEnabled: b.commandEnabled }),
    ...(b.canvasEnabled !== undefined && { canvasEnabled: b.canvasEnabled }),
    ...(b.monthlyBudgetInr !== undefined && { monthlyBudgetInr: b.monthlyBudgetInr }),
    ...(b.alertThresholds && { alertThresholds: [...new Set(b.alertThresholds)].sort((x, y) => x - y) }),
    updatedById: req.user.id,
  };
  const tenantId = tenantIdOrThrow();
  const row = await prisma.aiModeSetting.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  res.json({ success: true, data: { ...row, monthlyBudgetInr: Number(row.monthlyBudgetInr) } });
};

export const quotasBody = z
  .object({
    policies: z
      .array(
        z
          .object({
            roleId: z.string().uuid().nullable(),
            mode: z.enum(MODES),
            period: z.enum(PERIODS),
            maxCount: z.number().int().min(0).max(1_000_000).nullable(),
            isActive: z.boolean().optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const upsertQuotas = async (req: Request, res: Response) => {
  const { policies } = quotasBody.parse(req.body);
  const tenantId = tenantIdOrThrow();
  const roleIds = new Set((await prisma.role.findMany({ select: { id: true } })).map((r) => r.id));
  for (const p of policies) {
    if (p.roleId && !roleIds.has(p.roleId)) {
      res.status(400).json({ success: false, code: "BAD_ROLE", message: "Unknown role" });
      return;
    }
  }
  for (const p of policies) {
    // nullable column in a unique key: Postgres treats NULLs as distinct, so find first
    const existing = await prisma.aiQuotaPolicy.findFirst({ where: { roleId: p.roleId, mode: p.mode, period: p.period } });
    const data = { maxCount: p.maxCount, isActive: p.isActive ?? true, updatedById: req.user.id };
    if (existing) await prisma.aiQuotaPolicy.update({ where: { id: existing.id }, data });
    else await prisma.aiQuotaPolicy.create({ data: { tenantId, roleId: p.roleId, mode: p.mode, period: p.period, ...data } });
  }
  res.json({ success: true, data: await prisma.aiQuotaPolicy.findMany({}) });
};

export const overrideBody = z
  .object({
    userId: z.string().uuid(),
    mode: z.enum(MODES),
    period: z.enum(PERIODS),
    maxCount: z.number().int().min(0).max(1_000_000).nullable(),
    reason: z.string().max(200).optional(),
  })
  .strict();

export const upsertOverride = async (req: Request, res: Response) => {
  const b = overrideBody.parse(req.body);
  const user = await prisma.user.findFirst({ where: { id: b.userId }, select: { id: true } });
  if (!user) {
    res.status(404).json({ success: false, code: "NOT_FOUND", message: "User not found" });
    return;
  }
  const data = { maxCount: b.maxCount, reason: b.reason ?? null, updatedById: req.user.id };
  const row = await prisma.aiUserQuotaOverride.upsert({
    where: { userId_mode_period: { userId: b.userId, mode: b.mode, period: b.period } },
    create: { tenantId: tenantIdOrThrow(), userId: b.userId, mode: b.mode, period: b.period, ...data },
    update: data,
  });
  res.json({ success: true, data: row });
};

export const deleteOverride = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const row = await prisma.aiUserQuotaOverride.findFirst({ where: { id } });
  if (!row) {
    res.status(404).json({ success: false, code: "NOT_FOUND", message: "Override not found" });
    return;
  }
  await prisma.aiUserQuotaOverride.delete({ where: { id } });
  res.json({ success: true });
};

export const pricingBody = z
  .object({
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(80),
    inputPerMTokUsd: z.number().min(0),
    outputPerMTokUsd: z.number().min(0),
    cacheReadPerMTokUsd: z.number().min(0),
    cacheWritePerMTokUsd: z.number().min(0),
    usdToInr: z.number().positive(),
    effectiveFrom: z.string().datetime().optional(),
  })
  .strict();

/** pricing is platform-wide: only a platform admin or super admin may add a row */
export const addPricing = async (req: Request, res: Response) => {
  if (!req.user.isSuperAdmin) {
    res.status(403).json({ success: false, code: "FORBIDDEN", message: "Only a super admin can change AI pricing" });
    return;
  }
  const b = pricingBody.parse(req.body);
  const row = await prisma.aiModelPricing.create({ data: { ...b, effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : new Date() } });
  forgetPriceCache();
  res.status(201).json({ success: true, data: row });
};

export const listCommandTemplates = async (_req: Request, res: Response) => {
  const rows = await prisma.commandTemplate.findMany({ orderBy: [{ hitCount: "desc" }, { createdAt: "desc" }], take: 500 });
  res.json({ success: true, data: rows });
};

export const templatePatchBody = z.object({ isActive: z.boolean() }).strict();

/** platform-wide table (masked phrasings only) — super admin */
export const patchCommandTemplate = async (req: Request, res: Response) => {
  if (!req.user.isSuperAdmin) {
    res.status(403).json({ success: false, code: "FORBIDDEN", message: "Only a super admin can change learned templates" });
    return;
  }
  const { isActive } = templatePatchBody.parse(req.body);
  const row = await prisma.commandTemplate.update({ where: { id: String(req.params.id) }, data: { isActive } });
  res.json({ success: true, data: row });
};
