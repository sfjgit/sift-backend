// File: cost.service.ts
// Path: src/services/ai/cost.service.ts
//
// Cost tracking & budget (spec §15). Cost is computed AT WRITE TIME from the
// active pricing row and stored in USD and INR — a later price change never
// rewrites history. Template hits and guard rejects cost ₹0.
//
// At 100% of the monthly budget the LLM tier is blocked; templates keep working
// ("basic mode"). Alerts at 50 / 80 / 100 % go once per month to holders of
// ai_assistant.usage_view.

import prisma from "@/utils/prisma/client";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { getModeSetting } from "@/services/ai/settings.service";
import { notifyPermission } from "@/services/notification.service";
import { loggers } from "@/utils/logger";
import { periodStart } from "@/services/ai/quota.service";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Price {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  cacheReadPerMTokUsd: number;
  cacheWritePerMTokUsd: number;
  usdToInr: number;
}

const priceCache = new Map<string, { at: number; price: Price }>();

export const activePrice = async (model: string): Promise<Price> => {
  const hit = priceCache.get(model);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.price;
  const row = await prisma.aiModelPricing.findFirst({
    where: { model, isActive: true, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
  });
  const d = AI_DEFAULTS.pricing;
  const price: Price = row
    ? {
        inputPerMTokUsd: Number(row.inputPerMTokUsd),
        outputPerMTokUsd: Number(row.outputPerMTokUsd),
        cacheReadPerMTokUsd: Number(row.cacheReadPerMTokUsd),
        cacheWritePerMTokUsd: Number(row.cacheWritePerMTokUsd),
        usdToInr: Number(row.usdToInr),
      }
    : {
        inputPerMTokUsd: d.inputPerMTokUsd,
        outputPerMTokUsd: d.outputPerMTokUsd,
        cacheReadPerMTokUsd: d.cacheReadPerMTokUsd,
        cacheWritePerMTokUsd: d.cacheWritePerMTokUsd,
        usdToInr: d.usdToInr,
      };
  priceCache.set(model, { at: Date.now(), price });
  return price;
};

export const forgetPriceCache = () => priceCache.clear();

/** pure: tokens × price */
export const costOf = (u: TokenUsage, p: Price) => {
  const usd =
    (u.inputTokens * p.inputPerMTokUsd +
      u.outputTokens * p.outputPerMTokUsd +
      u.cacheReadTokens * p.cacheReadPerMTokUsd +
      u.cacheWriteTokens * p.cacheWritePerMTokUsd) /
    1_000_000;
  return { usd: Math.round(usd * 1e6) / 1e6, inr: Math.round(usd * p.usdToInr * 1e4) / 1e4 };
};

/** this month's spend for the current tenant (₹) */
export const monthSpendInr = async () => {
  const agg = await prisma.aiAuditLog.aggregate({ where: { createdAt: { gte: periodStart("MONTH") } }, _sum: { costInr: true } });
  return Number(agg._sum.costInr ?? 0);
};

export interface BudgetState {
  budgetInr: number;
  spentInr: number;
  usedPct: number;
  /** true at ≥ 100%: LLM blocked, templates only */
  exhausted: boolean;
}

export const budgetState = async (): Promise<BudgetState> => {
  const [setting, spent] = await Promise.all([getModeSetting(), monthSpendInr()]);
  const budget = Number(setting.monthlyBudgetInr);
  const usedPct = budget > 0 ? (spent / budget) * 100 : 100;
  return { budgetInr: budget, spentInr: Math.round(spent * 100) / 100, usedPct: Math.round(usedPct * 10) / 10, exhausted: usedPct >= 100 };
};

export const BASIC_MODE_MESSAGE = "AI is in basic mode for the rest of the month. Common commands still work.";

/** after a paid call: alert once per threshold per month */
export const checkBudgetAlerts = async () => {
  try {
    const setting = await getModeSetting();
    if (!setting.id) return;
    const { usedPct, spentInr, budgetInr } = await budgetState();
    const month = new Date().toISOString().slice(0, 7);
    const sent = ((setting.alertsSent ?? {}) as Record<string, number[]>)[month] ?? [];
    const thresholds = ((setting.alertThresholds ?? []) as number[]).filter((t) => usedPct >= t && !sent.includes(t));
    if (!thresholds.length) return;
    const top = Math.max(...thresholds);
    await prisma.aiModeSetting.update({
      where: { id: setting.id },
      data: { alertsSent: { ...((setting.alertsSent ?? {}) as object), [month]: [...sent, ...thresholds] } },
    });
    const fmt = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}`;
    await notifyPermission("ai_assistant.usage_view", null, {
      type: "SYSTEM_ALERT",
      severity: top >= 100 ? "ERROR" : "WARNING",
      title: top >= 100 ? "AI budget used up — assistant is in basic mode" : `AI budget ${top}% used this month`,
      body: `${fmt(spentInr)} of ${fmt(budgetInr)} spent this month.`,
      link: "/admin/ai-usage",
      referenceId: setting.id,
      referenceType: "SYSTEM_ALERT",
    });
  } catch (e) {
    loggers.error(`[ai] budget alert failed: ${(e as Error).message}`);
  }
};
