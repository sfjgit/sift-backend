// File: aiAccess.ts
// Path: src/middleware/aiAccess.ts
//
// AI request guards that run before any AI work (spec §3):
//   G1   mode + permission — kill switch, org setting, role grant, user toggle
//   G2   input limits      — 1..500 characters; per-user rate limit per mode
//   G2.5 quota             — user override > role policy > org default
// Every rejection is audited (L8). Rejections here cost ₹0 and never count
// against the quota.

import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import type { AiUsageMode } from "@prisma/client";
import { getUserPermissionMap } from "@/services/permission.service";
import type { PermissionKey } from "@/config/permissions.registry";
import { AI_MAX_INPUT_CHARS } from "@/config/aiGuardrails";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { resolveAccess } from "@/services/ai/settings.service";
import { logAi, type AiOutcome } from "@/services/ai/audit.service";
import { quotaMessage, quotaState } from "@/services/ai/quota.service";
import { tag } from "@/docs/meta";

type Mode = "COMMAND" | "CANVAS";

const inputOf = (req: Request) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const v = b.input ?? b.prompt ?? (b.spec ? `[${req.path}]` : "");
  return typeof v === "string" ? v : "";
};

const reject = async (req: Request, res: Response, status: number, code: string, message: string, outcome: AiOutcome, mode: Mode, usageMode: AiUsageMode | null) => {
  await logAi({ user: req.user, mode, usageMode, input: inputOf(req).slice(0, AI_MAX_INPUT_CHARS * 2), tier: "none", outcome, startedAt: Date.now() });
  res.status(status).json({ success: false, code, message });
};

/** G1 — the mode must be on for the org, granted to the role, and switched on by the user */
export const aiAccess = (mode: Mode, extra?: PermissionKey) =>
  tag(async (req: Request, res: Response, next: NextFunction) => {
    const perms = await getUserPermissionMap(req.user);
    req.permissions = perms;
    const access = await resolveAccess(req.user, perms);
    const on = mode === "COMMAND" ? access.active.command : access.active.canvas;
    const usageMode: AiUsageMode = mode;
    if (!on) {
      const msg =
        access.reason === "kill_switch"
          ? "The AI assistant is switched off."
          : access.reason === "org_off"
            ? "The AI assistant isn't enabled for your organisation."
            : access.reason === "user_off"
              ? "Turn the AI assistant on from the AI menu first."
              : "Your role doesn't include the AI assistant.";
      return reject(req, res, 403, "AI_OFF", msg, "rejected_permission", mode, usageMode);
    }
    if (extra && !perms[extra]) return reject(req, res, 403, "FORBIDDEN", `Missing permission: ${extra}`, "rejected_permission", mode, usageMode);
    next();
  }, { ai: mode, ...(extra && { perm: extra }) });

/** G2 — text input present and ≤ 500 characters */
export const aiInputLimit = (field: "input" | "prompt") => async (req: Request, res: Response, next: NextFunction) => {
  const v = (req.body ?? {})[field];
  const mode: Mode = field === "input" ? "COMMAND" : "CANVAS";
  if (typeof v !== "string" || !v.trim()) return reject(req, res, 400, "AI_EMPTY", "Type what you want to see.", "invalid", mode, mode);
  if (v.length > AI_MAX_INPUT_CHARS) {
    return reject(req, res, 400, "AI_TOO_LONG", `Keep it under ${AI_MAX_INPUT_CHARS} characters.`, "invalid", mode, mode);
  }
  req.body[field] = v.trim();
  next();
};

/** G2 — per-user rate limit (in memory; one process) */
export const aiRateLimit = (mode: Mode) =>
  rateLimit({
    windowMs: 60_000,
    limit: AI_DEFAULTS.ratePerMin[mode],
    keyGenerator: (req) => `ai:${mode}:${req.user.id}`, // AI routes always run after authenticateUser
    skip: (req) => !!req.user?.isSuperAdmin, // the super admin is never limited
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      void reject(req, res, 429, "AI_RATE_LIMIT", "Too many requests — wait a minute and try again.", "rejected_quota", mode, mode);
    },
  });

/** G2.5 — quota for this mode (spec §14) */
export const aiQuota = (usageMode: AiUsageMode) => async (req: Request, res: Response, next: NextFunction) => {
  const s = await quotaState(req.user, usageMode);
  if (!s.ok) {
    const mode: Mode = usageMode === "COMMAND" ? "COMMAND" : "CANVAS";
    return reject(req, res, 429, "AI_QUOTA", quotaMessage(usageMode, s), "rejected_quota", mode, usageMode);
  }
  next();
};
