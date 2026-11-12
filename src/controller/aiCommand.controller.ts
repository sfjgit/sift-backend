// File: aiCommand.controller.ts
// Path: src/controller/aiCommand.controller.ts
//
// GET  /ai/me              what the assistant can do for me + quota left
// PUT  /ai/me/preference   my own OFF / COMMAND / CANVAS toggle (within what my role allows)
// POST /ai/command         COMMAND mode: text → a page to open (read-only)

import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import { getUserPermissionMap } from "@/services/permission.service";
import { llmConfigured, resolveAccess } from "@/services/ai/settings.service";
import { quotaState } from "@/services/ai/quota.service";
import { budgetState, BASIC_MODE_MESSAGE } from "@/services/ai/cost.service";
import { resolveCommand } from "@/services/ai/command.service";
import { AI_MAX_INPUT_CHARS } from "@/config/aiGuardrails";
import { aiDbHasReadOnlyRole } from "@/config/aiDb";
import { logAi } from "@/services/ai/audit.service";
import { pageInsights } from "@/services/ai/insights.service";

export const getAiMe = async (req: Request, res: Response) => {
  const perms = await getUserPermissionMap(req.user);
  const access = await resolveAccess(req.user, perms);
  const [command, canvas, exp, budget] = access.enabled
    ? await Promise.all([quotaState(req.user, "COMMAND"), quotaState(req.user, "CANVAS"), quotaState(req.user, "EXPORT"), budgetState()])
    : [null, null, null, null];
  res.json({
    success: true,
    data: {
      ...access,
      can: {
        export: Boolean(perms["ai_assistant.canvas_export"]),
        saveTemplate: Boolean(perms["ai_assistant.canvas_save_template"]),
        shareTemplate: Boolean(perms["views.share"]),
        manage: Boolean(perms["ai_assistant.settings_manage"]),
        viewUsage: Boolean(perms["ai_assistant.usage_view"]),
      },
      quota: { command, canvas, export: exp },
      basicMode: budget?.exhausted ? BASIC_MODE_MESSAGE : null,
      llmReady: llmConfigured(),
      readOnlyRole: aiDbHasReadOnlyRole(),
      maxInputChars: AI_MAX_INPUT_CHARS,
    },
  });
};

export const preferenceBody = z.object({ mode: z.enum(["OFF", "COMMAND", "CANVAS"]) }).strict();

export const setAiPreference = async (req: Request, res: Response) => {
  const { mode } = preferenceBody.parse(req.body);
  const perms = await getUserPermissionMap(req.user);
  const access = await resolveAccess(req.user, perms);
  if (mode === "COMMAND" && !access.allowed.command) {
    res.status(403).json({ success: false, code: "FORBIDDEN", message: "Command mode isn't available to you." });
    return;
  }
  if (mode === "CANVAS" && !access.allowed.canvas) {
    res.status(403).json({ success: false, code: "FORBIDDEN", message: "AI Canvas isn't available to you." });
    return;
  }
  await prisma.aiUserPreference.upsert({
    where: { userId: req.user.id },
    create: { tenantId: tenantIdOrThrow(), userId: req.user.id, mode },
    update: { mode },
  });
  res.json({ success: true, data: await resolveAccess(req.user, perms) });
};

// POST /ai/command/local — the browser answered by itself (opened a page by name,
// repeated an earlier command). Free; logged so every request stays audited and
// the usage dashboard shows the maturity curve. Never counts against the quota.
export const localBody = z
  .object({
    input: z.string().min(1).max(AI_MAX_INPUT_CHARS),
    url: z.string().max(2000).regex(/^\/[^/]/).nullable(),
    kind: z.enum(["page", "repeat", "control"]),
  })
  .strict();

export const logLocalCommand = async (req: Request, res: Response) => {
  const { input, url, kind } = localBody.parse(req.body);
  await logAi({ user: req.user, mode: "COMMAND", usageMode: "COMMAND", input, tier: "local", outcome: "success", action: `local_${kind}`, params: { url }, startedAt: Date.now() });
  res.json({ success: true });
};

export const commandBody = z.object({ input: z.string().min(1).max(AI_MAX_INPUT_CHARS) }).strict();

export const runCommand = async (req: Request, res: Response) => {
  const { input } = commandBody.parse(req.body);
  const result = await resolveCommand(req.user, req.permissions!, input);
  const quota = await quotaState(req.user, "COMMAND");
  res.json({ success: true, data: { ...result, quota } });
};

// GET /ai/insights?page=clients|spocs|pipeline|overview — "what do you think about
// this page?". Rule-based sentences from scoped read-only queries: no LLM, ₹0,
// audited, not counted against the quota.
export const insightsQuery = z.object({ page: z.enum(["clients", "spocs", "pipeline", "overview"]).catch("overview") });

export const getInsights = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const { page } = insightsQuery.parse(req.query);
  const data = await pageInsights(req.user, req.permissions!, page);
  await logAi({ user: req.user, mode: "COMMAND", usageMode: "COMMAND", input: `[insights] ${page}`, tier: "template", outcome: "success", action: "insights", params: { page }, startedAt });
  res.json({ success: true, data });
};
