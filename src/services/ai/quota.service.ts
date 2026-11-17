// File: quota.service.ts
// Path: src/services/ai/quota.service.ts
//
// Usage quotas (spec §14). Most specific wins:
//   user override  >  role policy  >  tenant default (roleId null)  >  aiDefaults
// The super admin is never limited (17 Nov 2026, owner's call: they test the AI
// all day) — no quota, no per-minute limit, no "monthly budget used up" mode.
// Everyone else: "unlimited" (null) is an explicit setting, not a bypass.
//
// Counting: AiAuditLog is the source of truth (countsToQuota = true rows in the
// period). No Redis in this stack, so a short in-memory cache keeps it cheap;
// counters can always be rebuilt from the log.
// Periods start at 00:00 Asia/Kolkata (day), Monday (week), the 1st (month).

import prisma from "@/utils/prisma/client";
import type { AiQuotaPeriod, AiUsageMode } from "@prisma/client";
import type { AuthUser } from "@/types/express";
import { AI_DEFAULTS } from "@/config/aiDefaults";

const IST_MS = 330 * 60_000;

/** start of the current period, as a real instant */
export const periodStart = (period: AiQuotaPeriod, now = new Date()): Date => {
  const ist = new Date(now.getTime() + IST_MS); // wall clock in IST, read with getUTC*
  let y = ist.getUTCFullYear();
  let m = ist.getUTCMonth();
  let d = ist.getUTCDate();
  if (period === "WEEK") d -= (ist.getUTCDay() + 6) % 7;
  if (period === "MONTH") d = 1;
  return new Date(Date.UTC(y, m, d) - IST_MS);
};

export const periodEnd = (period: AiQuotaPeriod, now = new Date()): Date => {
  const s = new Date(periodStart(period, now).getTime() + IST_MS);
  if (period === "DAY") s.setUTCDate(s.getUTCDate() + 1);
  if (period === "WEEK") s.setUTCDate(s.getUTCDate() + 7);
  if (period === "MONTH") s.setUTCMonth(s.getUTCMonth() + 1);
  return new Date(s.getTime() - IST_MS);
};

export interface Limit {
  period: AiQuotaPeriod;
  maxCount: number | null;
  source: "user" | "role" | "default" | "built_in";
}

/** the limits that apply to a user for one mode (one per period that has a rule) */
export const effectiveLimits = async (user: Pick<AuthUser, "id" | "roleId">, mode: AiUsageMode): Promise<Limit[]> => {
  const [overrides, policies] = await Promise.all([
    prisma.aiUserQuotaOverride.findMany({ where: { userId: user.id, mode } }),
    prisma.aiQuotaPolicy.findMany({ where: { mode, isActive: true, OR: [{ roleId: user.roleId }, { roleId: null }] } }),
  ]);
  const periods: AiQuotaPeriod[] = ["DAY", "WEEK", "MONTH"];
  const out: Limit[] = [];
  for (const period of periods) {
    const o = overrides.find((x) => x.period === period);
    if (o) {
      out.push({ period, maxCount: o.maxCount, source: "user" });
      continue;
    }
    const r = policies.find((x) => x.period === period && x.roleId === user.roleId);
    if (r) {
      out.push({ period, maxCount: r.maxCount, source: "role" });
      continue;
    }
    const t = policies.find((x) => x.period === period && x.roleId === null);
    if (t) out.push({ period, maxCount: t.maxCount, source: "default" });
  }
  // nothing configured at all → built-in defaults (covers a tenant before the seed)
  if (!out.length && !policies.length && !overrides.length) {
    for (const q of AI_DEFAULTS.quotas.filter((x) => x.mode === mode)) out.push({ period: q.period, maxCount: q.maxCount, source: "built_in" });
  }
  return out;
};

export const usedSince = (userId: string, mode: AiUsageMode, since: Date) =>
  prisma.aiAuditLog.count({ where: { userId, usageMode: mode, countsToQuota: true, createdAt: { gte: since } } });

export interface QuotaState {
  ok: boolean;
  /** the tightest limit (what the UI shows: "42 / 100 today") */
  used: number;
  max: number | null;
  period: AiQuotaPeriod | null;
  resetsAt: Date | null;
}

export const quotaState = async (user: Pick<AuthUser, "id" | "roleId"> & { isSuperAdmin?: boolean }, mode: AiUsageMode): Promise<QuotaState> => {
  // super admin: counted (for the usage page) but never stopped
  if (user.isSuperAdmin) return { ok: true, used: await usedSince(user.id, mode, periodStart("DAY")), max: null, period: "DAY", resetsAt: null };
  const limits = await effectiveLimits(user, mode);
  let tightest: QuotaState = { ok: true, used: 0, max: null, period: null, resetsAt: null };
  let bestLeft = Infinity;
  for (const l of limits) {
    const used = await usedSince(user.id, mode, periodStart(l.period));
    if (l.maxCount === null) {
      if (tightest.period === null) tightest = { ok: true, used, max: null, period: l.period, resetsAt: null };
      continue;
    }
    const left = l.maxCount - used;
    if (left < bestLeft) {
      bestLeft = left;
      tightest = { ok: left > 0, used, max: l.maxCount, period: l.period, resetsAt: periodEnd(l.period) };
    }
  }
  return tightest;
};

const PERIOD_WORD: Record<AiQuotaPeriod, string> = { DAY: "today", WEEK: "this week", MONTH: "this month" };
const MODE_WORD: Record<AiUsageMode, string> = { COMMAND: "command", CANVAS: "canvas", EXPORT: "export" };

/** fixed message at the limit (spec §14.5) */
export const quotaMessage = (mode: AiUsageMode, s: QuotaState) => {
  const when = s.resetsAt
    ? s.period === "DAY"
      ? "12:00 AM"
      : s.resetsAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";
  return `You've reached your AI ${MODE_WORD[mode]} limit for ${s.period ? PERIOD_WORD[s.period] : "now"}.${when ? ` It resets at ${when}.` : ""}`;
};
