// File: stepRun.controller.ts
// Path: src/controller/stepRun.controller.ts
//
// Read-only view of pipeline steps and their runs. Runs are written by the
// dispatch / callback flow, never from here.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { stepRunScopeWhere } from "@/services/scope.service";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import { notFound } from "@/utils/httpError";
import type { ListStepRunsQuery } from "@/validators/stepRun.validators";

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
