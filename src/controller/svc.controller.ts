// File: svc.controller.ts
// Path: src/controller/svc.controller.ts
//
// /api/svc/* — called by external services (CSR pipeline engine), never by
// the browser. A run is reachable only through the service that owns its step.

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { notFound } from "@/utils/httpError";
import type { ResultsBody, SvcEventInput } from "@/validators/svc.validators";
import { applyResults } from "@/services/pipeline/ingest.service";
import { buildJobPayload, CHECK_AFTER_MS, isTerminal, moveRun, recordEvent } from "@/services/pipeline/run.service";

const SAVING = "Saving results…";

const runOfService = async (req: Request) => {
  const run = await prisma.stepRun.findFirst({
    where: { id: req.validatedParams.id, step: { serviceId: req.service!.id } },
    select: { id: true, status: true, note: true },
  });
  if (!run) throw notFound("Step run");
  return run;
};

// ── GET /svc/step-runs/:id — the job payload again (engine restarted, lost it)
export const getRunInput = async (req: Request, res: Response) => {
  const run = await runOfService(req);
  res.json({ success: true, data: { status: run.status, job: await buildJobPayload(run.id) } });
};

// ── POST /svc/step-runs/:id/events — progress
export const postRunEvent = async (req: Request, res: Response) => {
  const run = await runOfService(req);
  const body = req.validatedBody as SvcEventInput;
  if (isTerminal(run.status)) {
    res.json({ success: true, data: { ignored: true, status: run.status } });
    return;
  }

  if (body.status === "RUNNING" && run.status === "QUEUED") {
    await moveRun(run.id, "RUNNING", {}, body.message ?? "Pipeline started the job");
  } else if (body.message) {
    await recordEvent(prisma, run.id, body.message);
  }

  await prisma.stepRun.updateMany({
    where: { id: run.id, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      lastCallbackAt: new Date(),
      nextCheckAt: new Date(Date.now() + CHECK_AFTER_MS),
      ...(body.progress !== undefined && { progress: body.progress }),
      // a late progress line must not hide "saving results"
      ...(body.note && run.note !== SAVING && { note: body.note }),
    },
  });
  res.json({ success: true, data: { ignored: false } });
};

// ── POST /svc/step-runs/:id/results — final, idempotent
export const postRunResults = async (req: Request, res: Response) => {
  const run = await runOfService(req);
  const out = await applyResults(run.id, req.validatedBody as ResultsBody, "callback");
  if (out.busy) {
    // another delivery is saving right now — engine retries later
    res.status(409).json({ success: false, code: "BUSY", message: "Results are being saved; retry later" });
    return;
  }
  res.json({ success: true, data: out });
};
