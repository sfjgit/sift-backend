// File: aiDefaults.ts
// Path: src/config/aiDefaults.ts
//
// AI assistant defaults. Quotas, budget and pricing live in the DB (editable in
// Settings → AI); these values only seed them or apply when a row is missing.
// Env can override the operational knobs without a code change.

import type { AiQuotaPeriod, AiUsageMode } from "@prisma/client";

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

export const AI_DEFAULTS = {
  /** Claude Haiku tier (spec), provider abstracted in services/ai/llm.service.ts */
  provider: "anthropic",
  model: process.env.AI_MODEL || "claude-haiku-5-5",
  llmTimeoutMs: int(process.env.AI_LLM_TIMEOUT_MS, 15_000),
  maxOutputTokens: 2_000,

  /** requests per minute per user (L7) */
  ratePerMin: {
    COMMAND: int(process.env.AI_RATE_COMMAND_PER_MIN, 30),
    CANVAS: int(process.env.AI_RATE_CANVAS_PER_MIN, 10),
  },

  /** prefilled per role by scripts/ai.seed.ts (spec §14.3) */
  quotas: [
    { mode: "COMMAND", period: "DAY", maxCount: 100 },
    { mode: "CANVAS", period: "DAY", maxCount: 20 },
    { mode: "EXPORT", period: "DAY", maxCount: 10 },
  ] as { mode: AiUsageMode; period: AiQuotaPeriod; maxCount: number | null }[],

  monthlyBudgetInr: 5_000,
  alertThresholds: [50, 80, 100],

  exportRowCap: int(process.env.AI_EXPORT_ROW_CAP, 10_000),
  canvasMaxBlocks: 12,
  /** rows a table block shows on screen (exports go up to exportRowCap) */
  canvasTableRows: 200,

  /** a learned template must be unambiguous: every param from an entity or a catalog constant */
  learnTemplates: true,
  /** maturity alert: template hit rate below this after N days */
  maturityAlert: { minHitRatePct: 50, afterDays: 30 },

  /**
   * Fallback price when no AiModelPricing row is active. Claude Haiku 5.5 list
   * price (prompts ≤ 100K tokens) — verify on Anthropic's pricing page and keep
   * the DB row current; the USD→INR rate is a placeholder to update.
   */
  pricing: {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    inputPerMTokUsd: 0.1,
    outputPerMTokUsd: 0.5,
    cacheReadPerMTokUsd: 0.01,
    cacheWritePerMTokUsd: 0.125,
    usdToInr: 88,
  },
} as const;
