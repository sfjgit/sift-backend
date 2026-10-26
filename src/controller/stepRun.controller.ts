// File: stepRun.controller.ts
// Path: src/controller/stepRun.controller.ts
//
// Read-only view of pipeline steps and their runs. Runs are written by the
// dispatch / callback flow, never from here.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, stepRunScopeWhere } from "@/services/scope.service";
import { startRun, stopRun } from "@/services/pipeline/launch.service";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError, notFound } from "@/utils/httpError";
import type { ListStepRunsQuery, StartStepRunInput } from "@/validators/stepRun.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;
const STEP = { id: true, key: true, label: true, target: true } as const;

const STEP_RUN_LITE_SELECT = {
  id: true,
  status: true,
  progress: true,
  note: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  step: { select: STEP },
} as const satisfies Prisma.StepRunSelect;

const STEP_RUN_SELECT = {
  ...STEP_RUN_LITE_SELECT,
  howToContinue: true,
  costUsd: true,
  parentRunId: true,
  client: { select: { id: true, name: true } },
  spoc: { select: { id: true, firstName: true, lastName: true } },
  requestedBy: { select: PERSON },
  _count: { select: { childRuns: true, events: true } },
} as const satisfies Prisma.StepRunSelect;

// ── GET /pipeline-steps — active steps in button order
export const listPipelineSteps = async (_req: Request, res: Response) => {
  const steps = await prisma.pipelineStep.findMany({
    where: { isActive: true },
    select: {
      id: true,
      key: true,
      label: true,
      target: true,
      uiOrder: true,
      userClientLimit: true,
      service: { select: { code: true, name: true, isActive: true, lastHealthOk: true } },
    },
    orderBy: [{ uiOrder: { sort: "asc", nulls: "last" } }, { label: "asc" }],
  });

  res.json({ success: true, data: steps });
};

// ── GET /step-runs
export const listStepRuns = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListStepRunsQuery;

  const where: Prisma.StepRunWhereInput = {
    AND: [
      await stepRunScopeWhere(req.user, req.scope!),
      {
        ...(q.clientId && { clientId: q.clientId }),
        ...(q.spocId && { spocId: q.spocId }),
        ...(q.status && { status: q.status }),
        ...(q.stepId && { stepId: q.stepId }),
        ...(q.requestedById && { requestedById: q.requestedById }),
      },
    ],
  };

  const [total, runs] = await Promise.all([
    prisma.stepRun.count({ where }),
    prisma.stepRun.findMany({
      where,
      select: STEP_RUN_SELECT,
      orderBy: { createdAt: "desc" },
      ...toSkipTake(q),
    }),
  ]);

  res.json({ success: true, data: runs, meta: pageMeta(total, q.page, q.limit) });
};

// ── GET /step-runs/:id — out of scope = 404; event payloads stay server-side
export const getStepRunById = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const run = await prisma.stepRun.findFirst({
    where: { id, ...(await stepRunScopeWhere(req.user, req.scope!)) },
    select: {
      ...STEP_RUN_SELECT,
      options: true,
      viewData: true,
      resultSummary: true,
      credits: true,
      events: {
        select: { id: true, fromStatus: true, toStatus: true, message: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      childRuns: { select: STEP_RUN_LITE_SELECT, orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) throw notFound("Step run");

  res.json({ success: true, data: run });
};

// client must be visible to the caller under clients.read — out of scope = 404
const assertClientVisible = async (req: Request, clientId: string) => {
  const grant = req.permissions!["clients.read"];
  if (!grant) throw notFound("Client");
  const where = grant === true ? {} : await clientScopeWhere(req.user, grant);
  const found = await prisma.client.count({ where: { id: clientId, deletedAt: null, ...where } });
  if (!found) throw notFound("Client");
};

// ── POST /step-runs — start a step (or "Run all steps") for one client
export const createStepRun = async (req: Request, res: Response) => {
  const body = req.validatedBody as StartStepRunInput;
  await assertClientVisible(req, body.clientId);

  const writesOutreach = body.stepKey === "emails" ||
    (body.stepKey === "run_all" && Array.isArray(body.options?.steps) && (body.options!.steps as string[]).includes("emails"));
  if (writesOutreach && !req.permissions!["outreach.generate"]) {
    throw ApiError(403, "Missing permission: outreach.generate", "FORBIDDEN");
  }

  const { run, duplicate } = await startRun(req.user, body);
  res.status(duplicate ? 200 : 201).json({
    success: true,
    message: duplicate ? "Already running — showing the existing run" : "Run started",
    data: { ...run, duplicate },
  });
};

// ── POST /step-runs/:id/stop
export const stopStepRun = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const visible = await prisma.stepRun.count({
    where: { id, ...(await stepRunScopeWhere(req.user, req.scope!)) },
  });
  if (!visible) throw notFound("Step run");
  await stopRun(id, req.user);
  res.json({ success: true, message: "Stop requested" });
};

// ── GET /step-runs/overview?clientId= — per step: latest run + what the client has
export const getStepOverview = async (req: Request, res: Response) => {
  const { clientId } = req.validatedQuery as { clientId: string };
  await assertClientVisible(req, clientId);

  const [steps, latest, spocs, approved, documents, financials, programs, packs] = await Promise.all([
    prisma.pipelineStep.findMany({
      where: { isActive: true },
      select: { id: true, key: true, label: true, uiOrder: true, userClientLimit: true,
        service: { select: { isActive: true, lastHealthOk: true } } },
      orderBy: [{ uiOrder: { sort: "asc", nulls: "last" } }],
    }),
    prisma.stepRun.findMany({
      // children of "Run all steps" count as that step's latest run too
      where: { clientId },
      distinct: ["stepId"],
      orderBy: { createdAt: "desc" },
      select: STEP_RUN_LITE_SELECT,
    }),
    prisma.clientSpoc.count({ where: { clientId, isActive: true } }),
    prisma.clientSpoc.count({ where: { clientId, isActive: true, approvalStatus: "APPROVED" } }),
    prisma.clientDocument.count({ where: { clientId } }),
    prisma.clientFinancial.count({ where: { clientId } }),
    prisma.clientProgram.count({ where: { clientId } }),
    prisma.outreachPack.count({ where: { clientId } }),
  ]);

  const byStep = new Map(latest.map((r) => [r.step.id, r]));
  res.json({
    success: true,
    data: {
      counts: { spocs, approvedSpocs: approved, documents, financials, programs, outreachPacks: packs },
      steps: steps.map((s) => ({ ...s, lastRun: byStep.get(s.id) ?? null })),
    },
  });
};
