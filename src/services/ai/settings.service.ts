// File: settings.service.ts
// Path: src/services/ai/settings.service.ts
//
// Mode control (spec §2) — four levels, top-down, any one can switch the AI off:
//   1. AI_ENABLED=false (env kill switch, no deploy)
//   2. AiModeSetting — org (tenant) switches for COMMAND / CANVAS
//   3. role grants — ai_assistant.command_use / canvas_use
//   4. the user's own toggle (AiUserPreference)
// Settings change only through the admin settings API, never through the AI.

import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import type { AiMode } from "@prisma/client";

export const aiKillSwitchOn = () => (process.env.AI_ENABLED ?? "").toLowerCase() === "false";

export const llmConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** the tenant's row, or defaults (both modes off) when none exists yet */
export const getModeSetting = async () => {
  const row = await prisma.aiModeSetting.findFirst({});
  return (
    row ?? {
      id: null as string | null,
      tenantId: tenantIdOrThrow(),
      commandEnabled: false,
      canvasEnabled: false,
      monthlyBudgetInr: AI_DEFAULTS.monthlyBudgetInr as unknown as number,
      alertThresholds: AI_DEFAULTS.alertThresholds as unknown as number[],
      alertsSent: {} as Record<string, number[]>,
      updatedById: null as string | null,
      updatedAt: null as Date | null,
    }
  );
};

export interface AiAccess {
  /** AI visible at all for this user */
  enabled: boolean;
  /** what the org + role allow */
  allowed: { command: boolean; canvas: boolean };
  /** what the user has switched on (within allowed) */
  active: { command: boolean; canvas: boolean };
  preference: AiMode;
  /** why it's off, for the UI */
  reason?: "kill_switch" | "org_off" | "no_permission" | "user_off" | undefined;
}

export const getUserPreference = async (userId: string): Promise<AiMode> =>
  (await prisma.aiUserPreference.findFirst({ where: { userId }, select: { mode: true } }))?.mode ?? "OFF";

export const resolveAccess = async (user: AuthUser, perms: PermissionMap): Promise<AiAccess> => {
  const off = (reason: AiAccess["reason"], preference: AiMode = "OFF"): AiAccess => ({
    enabled: false,
    allowed: { command: false, canvas: false },
    active: { command: false, canvas: false },
    preference,
    reason,
  });
  if (aiKillSwitchOn()) return off("kill_switch");
  const [setting, preference] = await Promise.all([getModeSetting(), getUserPreference(user.id)]);
  const allowed = {
    command: setting.commandEnabled && Boolean(perms["ai_assistant.command_use"]),
    canvas: setting.canvasEnabled && Boolean(perms["ai_assistant.canvas_use"]),
  };
  if (!setting.commandEnabled && !setting.canvasEnabled) return off("org_off", preference);
  if (!allowed.command && !allowed.canvas) return off("no_permission", preference);
  // OFF hides the assistant; COMMAND = command bar; CANVAS = command bar + canvas
  const active = {
    command: allowed.command && preference !== "OFF",
    canvas: allowed.canvas && preference === "CANVAS",
  };
  return {
    enabled: true,
    allowed,
    active,
    preference,
    ...(!active.command && !active.canvas ? { reason: "user_off" as const } : {}),
  };
};
