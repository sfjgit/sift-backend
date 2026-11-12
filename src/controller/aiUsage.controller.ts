// File: aiUsage.controller.ts
// Path: src/controller/aiUsage.controller.ts
//
// AI usage & cost dashboard (spec §17, ai_assistant.usage_view). Built WITH the
// canvas engine: a hand-written spec runs through the same validator + query
// registry + renderer, so the dashboard doubles as a real test of the engine.
//
//   GET  /ai/usage?from&to&roleId&buId&mode   blocks + per-user quota table + health
//   POST /ai/usage/export                     the same dashboard as Excel

import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import type { AiUsageMode } from "@prisma/client";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { runSpec, validateSpec, type RenderedBlock } from "@/services/ai/canvas.service";
import { effectiveLimits, periodStart } from "@/services/ai/quota.service";
import { budgetState, monthSpendInr } from "@/services/ai/cost.service";
import { getModeSetting } from "@/services/ai/settings.service";
import { notifyPermission } from "@/services/notification.service";
import { toExcel } from "@/services/ai/export.service";
import { logAi } from "@/services/ai/audit.service";

export const usageQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    roleId: z.string().uuid().optional(),
    buId: z.string().uuid().optional(),
    mode: z.enum(["COMMAND", "CANVAS", "EXPORT"]).optional(),
  })
  .strict();

const dashboardSpec = (f: z.infer<typeof usageQuery>) => {
  const params = {
    ...(f.from && f.to ? { period: { from: f.from, to: f.to } } : {}),
    ...(f.roleId ? { roleId: f.roleId } : {}),
    ...(f.buId ? { buId: f.buId } : {}),
    ...(f.mode ? { mode: f.mode } : {}),
  };
  const kpi = (query: string) => ({ component: "kpi" as const, query, params, width: "third" as const });
  return {
    title: "AI usage & cost",
    blocks: [
      kpi("ai_total_commands"),
      kpi("ai_llm_calls"),
      kpi("ai_template_hit_rate"),
      kpi("ai_cost"),
      kpi("ai_projected_month_end"),
      kpi("ai_avg_cost_per_command"),
      { component: "line" as const, query: "ai_cost_by_day", params, width: "full" as const },
      { component: "bar" as const, query: "ai_tier_split", params, width: "full" as const },
      { component: "bar" as const, query: "ai_cost_by_role", params, width: "half" as const },
      { component: "bar" as const, query: "ai_top_users", params, width: "half" as const },
      { component: "pie" as const, query: "ai_usage_by_mode", params, width: "half" as const },
      { component: "table" as const, query: "ai_rejected", params, width: "full" as const },
    ],
  };
};

/** per-user usage today vs their limit, "near limit" at ≥ 80 % */
const quotaTable = async () => {
  const since = periodStart("DAY");
  const used = await prisma.aiAuditLog.groupBy({
    by: ["userId", "usageMode"],
    where: { countsToQuota: true, createdAt: { gte: periodStart("MONTH") } },
    _count: { _all: true },
  });
  const today = await prisma.aiAuditLog.groupBy({
    by: ["userId", "usageMode"],
    where: { countsToQuota: true, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const userIds = [...new Set(used.map((u) => u.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, roleId: true, role: { select: { name: true } } },
  });
  const rows = [];
  for (const u of users) {
    for (const mode of ["COMMAND", "CANVAS", "EXPORT"] as AiUsageMode[]) {
      const month = used.find((x) => x.userId === u.id && x.usageMode === mode)?._count._all ?? 0;
      if (!month) continue;
      const day = today.find((x) => x.userId === u.id && x.usageMode === mode)?._count._all ?? 0;
      const limit = (await effectiveLimits(u, mode)).find((l) => l.period === "DAY");
      const max = limit?.maxCount ?? null;
      rows.push({
        user: `${u.firstName} ${u.lastName}`.trim(),
        role: u.role?.name ?? null,
        mode,
        today: day,
        dailyLimit: max,
        thisMonth: month,
        nearLimit: max !== null && max > 0 && day / max >= 0.8,
      });
    }
  }
  return rows.sort((a, b) => Number(b.nearLimit) - Number(a.nearLimit) || b.today - a.today);
};

/** maturity health: template hit rate below 50 % after 30 days → alert once a month */
const health = async () => {
  const first = await prisma.aiAuditLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  if (!first) return { ageDays: 0, hitRatePct: null as number | null, alert: false };
  const ageDays = Math.floor((Date.now() - first.createdAt.getTime()) / 86_400_000);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.aiAuditLog.groupBy({
    by: ["tier"],
    where: { usageMode: "COMMAND", createdAt: { gte: since }, tier: { in: ["local", "template", "llm", "fallback"] }, NOT: { outcome: { startsWith: "rejected" } } },
    _count: { _all: true },
  });
  const total = rows.reduce((s, r) => s + r._count._all, 0);
  const hits = rows.filter((r) => r.tier === "template" || r.tier === "local").reduce((n, r) => n + r._count._all, 0);
  const hitRatePct = total ? Math.round((hits / total) * 1000) / 10 : null;
  const alert = ageDays >= AI_DEFAULTS.maturityAlert.afterDays && hitRatePct !== null && hitRatePct < AI_DEFAULTS.maturityAlert.minHitRatePct;
  if (alert) {
    const setting = await getModeSetting();
    const key = `maturity-${new Date().toISOString().slice(0, 7)}`;
    const sent = (setting.alertsSent ?? {}) as Record<string, unknown>;
    if (setting.id && !sent[key]) {
      await prisma.aiModeSetting.update({ where: { id: setting.id }, data: { alertsSent: { ...sent, [key]: [1] } as object } });
      await notifyPermission("ai_assistant.settings_manage", null, {
        type: "SYSTEM_ALERT",
        severity: "WARNING",
        title: "AI templates are not learning enough",
        body: `Only ${hitRatePct}% of commands were answered from templates in the last 30 days (target ${AI_DEFAULTS.maturityAlert.minHitRatePct}%). Review entity extraction and templates.`,
        link: "/admin/ai",
        referenceId: setting.id,
        referenceType: "SYSTEM_ALERT",
      });
    }
  }
  return { ageDays, hitRatePct, alert };
};

const build = async (req: Request, rowCap: number) => {
  const f = usageQuery.parse(req.query);
  const spec = validateSpec(dashboardSpec(f), req.permissions!);
  const blocks: RenderedBlock[] = await runSpec(req.user, req.permissions!, spec, rowCap);
  return { spec, blocks };
};

export const getUsage = async (req: Request, res: Response) => {
  const [{ spec, blocks }, quotas, budget, spent, h] = await Promise.all([build(req, 500), quotaTable(), budgetState(), monthSpendInr(), health()]);
  res.json({ success: true, data: { spec, blocks, quotas, budget: { ...budget, spentInr: Math.round(spent * 100) / 100 }, health: h } });
};

export const exportUsage = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const { spec, blocks } = await build(req, AI_DEFAULTS.exportRowCap);
  const quotas = await quotaTable();
  blocks.push({
    id: "quotas",
    component: "table",
    query: "quota_table",
    params: {},
    title: "Usage vs quota",
    width: "full",
    result: {
      kind: "rows",
      total: quotas.length,
      columns: [
        { key: "user", label: "User", type: "text" },
        { key: "role", label: "Role", type: "text" },
        { key: "mode", label: "Mode", type: "text" },
        { key: "today", label: "Today", type: "number" },
        { key: "dailyLimit", label: "Daily limit", type: "number" },
        { key: "thisMonth", label: "This month", type: "number" },
        { key: "near", label: "Near limit", type: "text" },
      ],
      rows: quotas.map(({ nearLimit, ...q }) => ({ ...q, near: nearLimit ? "Yes" : "" })),
    },
  });
  const buf = await toExcel(spec.title, blocks, req.user);
  await logAi({ user: req.user, mode: "CANVAS", usageMode: "EXPORT", input: "[export xlsx] AI usage", tier: "none", outcome: "success", action: "export_usage", startedAt });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="ai-usage-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
};
