// File: stepRun.controller.ts
// Path: src/controller/stepRun.controller.ts
//
// Read-only view of pipeline steps and their runs. Runs are written by the
// dispatch / callback flow, never from here.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocWhereForUserId, stepRunScopeWhere } from "@/services/scope.service";
import { canForceRerun, doneInfo, hasNoSlots, rerunBlock, slotsFor } from "@/services/pipeline/runRules.service";
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
        ...(q.status?.length && { status: { in: q.status } }),
        ...(q.stepId?.length && { stepId: { in: q.stepId } }),
        ...(q.requestedById?.length && { requestedById: { in: q.requestedById } }),
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

// What a run put into the CRM, found through the records that point back at it
// (sourceRunId, activity meta.runId) — so older runs show their results too.
// Each part only with its own read permission.
const runProduced = async (runId: string, clientId: string, perms: Record<string, unknown>) => {
  const [activities, documents, packs, programs, financials] = await Promise.all([
    perms["spocs.read"]
      ? prisma.clientActivity.findMany({
          where: { clientId, type: { in: ["SPOC_ADDED", "SPOC_UPDATED"] }, meta: { path: ["runId"], equals: runId } },
          select: {
            type: true,
            summary: true,
            spoc: {
              select: {
                id: true, firstName: true, lastName: true, designation: true, approvalStatus: true,
                validationScore: true, validationBand: true, emailStatus: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 200,
        })
      : [],
    perms["client_documents.read"]
      ? prisma.clientDocument.findMany({
          where: { sourceRunId: runId },
          select: { id: true, fy: true, fileName: true, type: { select: { label: true } } },
        })
      : [],
    perms["outreach.read"]
      ? prisma.outreachPack.findMany({
          where: { sourceRunId: runId },
          select: {
            id: true,
            spoc: { select: { id: true, firstName: true, lastName: true } },
            _count: { select: { messages: true } },
            messages: { select: { subject: true }, orderBy: { sequenceNo: "asc" }, take: 1 },
          },
        })
      : [],
    perms["client_programs.read"] ? prisma.clientProgram.count({ where: { sourceRunId: runId } }) : 0,
    perms["client_financials.read"] ? prisma.clientFinancial.count({ where: { sourceRunId: runId } }) : 0,
  ]);

  return {
    clientId,
    spocs: activities
      .filter((a) => a.spoc)
      .map((a) => ({
        ...a.spoc!,
        change: a.type === "SPOC_ADDED" ? "added" : "updated",
        // "Pipeline updated Asha Rao: phone, score" → ["phone", "score"]
        fields: a.type === "SPOC_UPDATED" ? (a.summary.split(": ")[1] ?? "").split(", ").filter(Boolean) : [],
      })),
    documents: documents.map((d) => ({ id: d.id, type: d.type.label, fy: d.fy, fileName: d.fileName })),
    outreach: packs.map((p) => ({
      id: p.id,
      spoc: p.spoc,
      messages: p._count.messages,
      firstSubject: p.messages[0]?.subject ?? null,
    })),
    programs,
    financials,
  };
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

  const produced = run.step.key === "run_all" ? null : await runProduced(run.id, run.client.id, req.permissions!);
  res.json({ success: true, data: { ...run, produced } });
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
      select: { id: true, key: true, label: true, uiOrder: true, userClientLimit: true, rerunAfterDays: true,
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
  const mine = await spocWhereForUserId(req.user.id);
  const [mySpocs, myApproved, canRerun, unlimited, slots] = await Promise.all([
    prisma.clientSpoc.count({ where: { clientId, isActive: true, ...mine } }),
    prisma.clientSpoc.count({ where: { clientId, isActive: true, approvalStatus: "APPROVED", ...mine } }),
    canForceRerun(req.user),
    hasNoSlots(req.user),
    slotsFor(req.user),
  ]);

  const rows = await Promise.all(
    steps.map(async (s) => {
      const [done, blocked] = await Promise.all([
        doneInfo(s, clientId, req.user.id),
        rerunBlock(s, clientId, req.user.id),
      ]);
      return {
        ...s,
        lastRun: byStep.get(s.id) ?? null,
        done, // last finished run that counts for this user (anyone's for client-level steps)
        rerunBlocked: blocked ? { message: blocked.message, until: blocked.until } : null,
        slots: slots.filter((x) => x.stepId === s.id || x.stepId === null),
      };
    }),
  );

  res.json({
    success: true,
    data: {
      counts: {
        spocs, approvedSpocs: approved, documents, financials, programs, outreachPacks: packs,
        mySpocs, myApprovedSpocs: myApproved, othersSpocs: spocs - mySpocs,
      },
      canRerun,
      unlimitedSlots: unlimited,
      steps: rows,
    },
  });
};
