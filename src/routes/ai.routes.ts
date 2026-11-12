// File: ai.routes.ts
// Path: src/routes/ai.routes.ts
//
// AI assistant layer (docs: CRM_AI_Assistant_Layer_Spec_v1). Guards run in the
// spec's order: auth → G1 mode/permission → G2 input + rate → G2.5 quota → resolver.
// Everything here is read-only for business data.

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { idParams, validate } from "@/validators/validator";
import { aiAccess, aiInputLimit, aiQuota, aiRateLimit } from "@/middleware/aiAccess";
import { getAiMe, getInsights, logLocalCommand, runCommand, setAiPreference } from "@/controller/aiCommand.controller";
import { deleteTemplate, exportCanvas, generate, listTemplates, run, saveTemplate } from "@/controller/aiCanvas.controller";
import {
  addPricing,
  deleteOverride,
  getSettings,
  listCommandTemplates,
  patchCommandTemplate,
  updateSettings,
  upsertOverride,
  upsertQuotas,
} from "@/controller/aiSettings.controller";
import { exportUsage, getUsage } from "@/controller/aiUsage.controller";

const router = Router();
router.use(authenticateUser);

// me
router.get("/me", getAiMe);
router.put("/me/preference", setAiPreference);

// COMMAND
router.get("/insights", aiAccess("COMMAND"), aiRateLimit("COMMAND"), getInsights);
router.post("/command/local", aiAccess("COMMAND"), aiRateLimit("COMMAND"), logLocalCommand);
router.post("/command", aiAccess("COMMAND"), aiInputLimit("input"), aiRateLimit("COMMAND"), aiQuota("COMMAND"), runCommand);

// CANVAS
router.post("/canvas/generate", aiAccess("CANVAS"), aiInputLimit("prompt"), aiRateLimit("CANVAS"), aiQuota("CANVAS"), generate);
router.post("/canvas/run", aiAccess("CANVAS"), aiRateLimit("CANVAS"), run);
router.get("/canvas/templates", aiAccess("CANVAS"), listTemplates);
router.post("/canvas/templates", aiAccess("CANVAS", "ai_assistant.canvas_save_template"), saveTemplate);
router.delete("/canvas/templates/:id", aiAccess("CANVAS"), validate.params(idParams), deleteTemplate);
router.post("/canvas/export", aiAccess("CANVAS", "ai_assistant.canvas_export"), aiQuota("EXPORT"), exportCanvas);

// settings (never reachable through the AI itself)
const manage = authorize("ai_assistant.settings_manage");
router.get("/settings", manage, getSettings);
router.put("/settings", manage, updateSettings);
router.put("/settings/quotas", manage, upsertQuotas);
router.post("/settings/overrides", manage, upsertOverride);
router.delete("/settings/overrides/:id", manage, validate.params(idParams), deleteOverride);
router.post("/settings/pricing", manage, addPricing);
router.get("/settings/templates", manage, listCommandTemplates);
router.patch("/settings/templates/:id", manage, validate.params(idParams), patchCommandTemplate);

// usage & cost
const usage = authorize("ai_assistant.usage_view");
router.get("/usage", usage, getUsage);
router.get("/usage/export", usage, exportUsage);

export default router;
