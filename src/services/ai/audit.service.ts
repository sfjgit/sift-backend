// File: audit.service.ts
// Path: src/services/ai/audit.service.ts
//
// L8 — every AI request is logged, including rejected ones (spec §4 L8).
// Writes only to AiAuditLog (an AI-owned table) through the main client.
// A failed audit write never breaks the user's request, but is logged loudly.

import prisma from "@/utils/prisma/client";
import { Prisma, type AiMode, type AiUsageMode } from "@prisma/client";
import type { AuthUser } from "@/types/express";
import { loggers } from "@/utils/logger";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import { activePrice, costOf, type TokenUsage } from "@/services/ai/cost.service";

export type AiOutcome =
  | "success"
  | "rejected_destructive"
  | "rejected_permission"
  | "rejected_scope"
  | "rejected_quota"
  | "budget_exhausted"
  | "invalid"
  /** answered, but every block came back empty — usually a misunderstanding */
  | "empty"
  | "error";

/** local = answered in the browser (page names, repeats) — free, logged for the maturity curve */
export type AiTier = "guard" | "template" | "llm" | "fallback" | "local" | "none";

export interface AuditEntry {
  user: AuthUser;
  mode: AiMode;
  usageMode: AiUsageMode | null;
  input: string;
  tier: AiTier;
  outcome: AiOutcome;
  template?: string | null;
  action?: string | null;
  params?: unknown;
  countsToQuota?: boolean;
  model?: string | null;
  usage?: TokenUsage | null;
  startedAt: number;
}

const buCache = new Map<string, { at: number; buId: string | null }>();
const primaryBu = async (userId: string) => {
  const hit = buCache.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.buId;
  const row = await prisma.userBusinessUnit.findFirst({ where: { userId }, select: { businessUnitId: true } });
  const buId = row?.businessUnitId ?? null;
  buCache.set(userId, { at: Date.now(), buId });
  return buId;
};

export const logAi = async (e: AuditEntry) => {
  try {
    const cost = e.usage && e.model ? costOf(e.usage, await activePrice(e.model)) : { usd: 0, inr: 0 };
    await prisma.aiAuditLog.create({
      data: {
        tenantId: tenantIdOrThrow(),
        userId: e.user.id,
        roleId: e.user.roleId,
        buId: await primaryBu(e.user.id),
        mode: e.mode,
        usageMode: e.usageMode,
        input: e.input.slice(0, 2000),
        template: e.template ?? null,
        tier: e.tier,
        action: e.action ?? null,
        params: e.params === undefined || e.params === null ? Prisma.JsonNull : (e.params as Prisma.InputJsonValue),
        outcome: e.outcome,
        countsToQuota: e.countsToQuota ?? false,
        model: e.model ?? null,
        inputTokens: e.usage?.inputTokens ?? 0,
        outputTokens: e.usage?.outputTokens ?? 0,
        cacheReadTokens: e.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: e.usage?.cacheWriteTokens ?? 0,
        costUsd: cost.usd,
        costInr: cost.inr,
        latencyMs: Date.now() - e.startedAt,
      },
    });
  } catch (err) {
    loggers.error(`[ai] audit write failed (${e.outcome}): ${(err as Error).message}`);
  }
};
