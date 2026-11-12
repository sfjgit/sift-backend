// File: aiCanvas.controller.ts
// Path: src/controller/aiCanvas.controller.ts
//
// AI Canvas (beta) — read-only report pages.
//   POST   /ai/canvas/generate        prompt → spec → blocks with data (LLM, counts quota)
//   POST   /ai/canvas/run             re-run a spec with fresh data (no LLM, no quota)
//   GET    /ai/canvas/templates       my saved canvases + shared ones
//   POST   /ai/canvas/templates       save (ai_assistant.canvas_save_template)
//   DELETE /ai/canvas/templates/:id   my own (or AI settings managers)
//   POST   /ai/canvas/export          xlsx | pptx | pdf (ai_assistant.canvas_export, EXPORT quota)
// Specs coming from the browser are always re-validated (G4) and re-run with
// fresh, scoped data — the browser's numbers are never trusted.

import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { AI_MAX_INPUT_CHARS } from "@/config/aiGuardrails";
import { generateCanvas, runSpec, SpecInvalid, validateSpec } from "@/services/ai/canvas.service";
import { logAi } from "@/services/ai/audit.service";
import { quotaState } from "@/services/ai/quota.service";
import { toExcel, toPptx, generatedBy } from "@/services/ai/export.service";

export const generateBody = z.object({ prompt: z.string().min(1).max(AI_MAX_INPUT_CHARS) }).strict();

export const generate = async (req: Request, res: Response) => {
  const { prompt } = generateBody.parse(req.body);
  const result = await generateCanvas(req.user, req.permissions!, prompt);
  res.json({ success: true, data: { ...result, quota: await quotaState(req.user, "CANVAS") } });
};

const specBody = z.object({ spec: z.unknown(), templateId: z.string().uuid().optional() }).strict();

const invalid = (res: Response, e: unknown) => {
  if (e instanceof SpecInvalid) {
    res.status(400).json({ success: false, code: "AI_SPEC_INVALID", message: e.message });
    return true;
  }
  return false;
};

export const run = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const { spec, templateId } = specBody.parse(req.body);
  try {
    const valid = validateSpec(spec, req.permissions!);
    const blocks = await runSpec(req.user, req.permissions!, valid, AI_DEFAULTS.canvasTableRows);
    await logAi({ user: req.user, mode: "CANVAS", usageMode: "CANVAS", input: `[rerun] ${valid.title}`, tier: "template", outcome: "success", action: "run_spec", params: { templateId: templateId ?? null }, startedAt });
    res.json({ success: true, data: { type: "canvas", spec: valid, blocks } });
  } catch (e) {
    await logAi({ user: req.user, mode: "CANVAS", usageMode: "CANVAS", input: "[rerun]", tier: "template", outcome: "invalid", action: "run_spec", startedAt });
    if (!invalid(res, e)) throw e;
  }
};

// ── templates ────────────────────────────────────────────────────────────────

export const listTemplates = async (req: Request, res: Response) => {
  const rows = await prisma.reportTemplate.findMany({
    where: { OR: [{ createdById: req.user.id }, { isShared: true }] },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const owners = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, firstName: true, lastName: true } })).map(
      (u) => [u.id, `${u.firstName} ${u.lastName}`.trim()],
    ),
  );
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, mine: r.createdById === req.user.id, createdBy: owners.get(r.createdById) ?? null })),
  });
};

export const saveTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    prompt: z.string().max(AI_MAX_INPUT_CHARS).optional(),
    spec: z.unknown(),
    isShared: z.boolean().optional(),
  })
  .strict();

export const saveTemplate = async (req: Request, res: Response) => {
  const body = saveTemplateBody.parse(req.body);
  try {
    const valid = validateSpec(body.spec, req.permissions!);
    const shared = Boolean(body.isShared && req.permissions!["views.share"]);
    const row = await prisma.reportTemplate.create({
      data: { tenantId: tenantIdOrThrow(), name: body.name, prompt: body.prompt ?? null, spec: valid as object, createdById: req.user.id, isShared: shared },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (!invalid(res, e)) throw e;
  }
};

export const deleteTemplate = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const row = await prisma.reportTemplate.findFirst({ where: { id } });
  if (!row) {
    res.status(404).json({ success: false, code: "NOT_FOUND", message: "Template not found" });
    return;
  }
  if (row.createdById !== req.user.id && !req.permissions!["ai_assistant.settings_manage"]) {
    res.status(403).json({ success: false, code: "FORBIDDEN", message: "Only the owner can delete this template" });
    return;
  }
  await prisma.reportTemplate.delete({ where: { id } });
  res.json({ success: true });
};

// ── export ───────────────────────────────────────────────────────────────────

export const exportBody = z.object({ spec: z.unknown(), format: z.enum(["xlsx", "pptx", "pdf"]) }).strict();

const fileName = (title: string, ext: string) =>
  `${title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "canvas"}-${new Date().toISOString().slice(0, 10)}.${ext}`;

export const exportCanvas = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const { spec, format } = exportBody.parse(req.body);
  let valid;
  try {
    valid = validateSpec(spec, req.permissions!);
  } catch (e) {
    await logAi({ user: req.user, mode: "CANVAS", usageMode: "EXPORT", input: `[export ${format}]`, tier: "none", outcome: "invalid", startedAt });
    if (!invalid(res, e)) throw e;
    return;
  }
  const log = (extra: { outcome: "success" | "error"; rows?: number }) =>
    logAi({
      user: req.user,
      mode: "CANVAS",
      usageMode: "EXPORT",
      input: `[export ${format}] ${valid.title}`,
      tier: "none",
      outcome: extra.outcome,
      action: `export_${format}`,
      params: { blocks: valid.blocks.map((b) => b.query), rows: extra.rows ?? 0 },
      countsToQuota: extra.outcome === "success",
      startedAt,
    });

  // PDF is printed by the browser from the canvas on screen; this call checks the
  // permission + quota and writes the audit line first, and returns the footer.
  if (format === "pdf") {
    await log({ outcome: "success" });
    res.json({ success: true, data: { footer: generatedBy(req.user) } });
    return;
  }

  try {
    const blocks = await runSpec(req.user, req.permissions!, valid, AI_DEFAULTS.exportRowCap);
    const rows = blocks.reduce((s, b) => s + (b.result?.kind === "rows" ? b.result.rows.length : 0), 0);
    const buf = format === "xlsx" ? await toExcel(valid.title, blocks, req.user) : await toPptx(valid.title, blocks, req.user);
    await log({ outcome: "success", rows });
    res.setHeader(
      "Content-Type",
      format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName(valid.title, format)}"`);
    res.send(buf);
  } catch (e) {
    await log({ outcome: "error" });
    throw e;
  }
};
