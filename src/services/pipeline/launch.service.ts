// File: launch.service.ts
// Path: src/services/pipeline/launch.service.ts
//
// Starting and stopping step runs, and "Run all steps": a parent run whose
// children are dispatched one at a time — each after the previous child's
// results are saved, so every step works on CRM data.

import crypto from "crypto";
import { Prisma, StepRunStatus } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError, notFound } from "@/utils/httpError";
import { logClientActivity } from "@/services/clientActivity.service";
import { RUN_ALL_DEFAULT, stepDef } from "@/config/pipeline";
import type { AuthUser } from "@/types/express";
import { engine } from "./engineClient";
import { ACTIVE, dispatchRun, isTerminal, moveRun, onChildEnded, recordEvent } from "./run.service";

type StepRow = Prisma.PipelineStepGetPayload<{
  include: { service: { select: { isActive: true } } };
}>;

export type StartRunInput = {
  stepKey: string;
  clientId: string;
  spocIds?: string[] | undefined;
  options?: Record<string, unknown> | undefined;
  businessUnitId?: string | undefined;
  serviceLineId?: string | undefined;
};

// stable JSON — key order must not change the fingerprint
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);

const fingerprint = (parts: unknown) => crypto.createHash("sha256").update(stable(parts)).digest("hex");

export const findStep = async (key: string): Promise<StepRow> => {
  const step = await prisma.pipelineStep.findFirst({
    where: { key, isActive: true },
    include: { service: { select: { isActive: true } } },
  });
  if (!step) throw ApiError(404, `Step "${key}" is not available`, "STEP_NOT_FOUND");
  if (!step.service.isActive) throw ApiError(503, "The pipeline service is switched off", "SERVICE_OFF");
  return step;
};

// clients per user per step; EMPTY / failed runs use no slot
const assertWithinLimit = async (user: AuthUser, step: StepRow, clientId: string) => {
  const limit = step.userClientLimit;
  if (user.isSuperAdmin || limit === null) return;
  const used = await prisma.stepRun.findMany({
    where: { stepId: step.id, requestedById: user.id, status: { in: ["QUEUED", "RUNNING", "DONE"] } },
    distinct: ["clientId"],
    select: { clientId: true },
  });
  if (used.some((u) => u.clientId === clientId)) return;
  if (used.length >= limit) {
    throw ApiError(429, `You can run "${step.label}" for at most ${limit} clients`, "STEP_LIMIT");
  }
};

// new SPOCs need a BU + SL; a user with exactly one of each needs to pick nothing
const resolveBuSl = async (userId: string, buId?: string, slId?: string) => {
  const [bus, sls] = await Promise.all([
    buId ? null : prisma.userBusinessUnit.findMany({ where: { userId }, select: { businessUnitId: true } }),
    slId ? null : prisma.userServiceLine.findMany({ where: { userId }, select: { serviceLineId: true } }),
  ]);
  const businessUnitId = buId ?? (bus?.length === 1 ? bus[0]!.businessUnitId : undefined);
  const serviceLineId = slId ?? (sls?.length === 1 ? sls[0]!.serviceLineId : undefined);
  if (!businessUnitId || !serviceLineId) {
    throw ApiError(400, "Pick the business unit and service line for new SPOCs", "BU_SL_REQUIRED");
  }
  const [bu, sl] = await Promise.all([
    prisma.businessUnit.count({ where: { id: businessUnitId, isActive: true } }),
    prisma.serviceLine.count({ where: { id: serviceLineId, isActive: true } }),
  ]);
  if (!bu || !sl) throw ApiError(400, "Business unit or service line not found", "INVALID_BU_SL");
  return { businessUnitId, serviceLineId };
};

const RUN_OUT = {
  id: true,
  status: true,
  note: true,
  createdAt: true,
  parentRunId: true,
  step: { select: { id: true, key: true, label: true } },
} as const satisfies Prisma.StepRunSelect;

const createRunRow = async (data: {
  stepId: string;
  stepLabel: string;
  clientId: string;
  spocId: string | null;
  requestedById: string;
  idempotencyKey: string;
  options: Prisma.InputJsonValue;
  parentRunId?: string;
  status?: StepRunStatus;
}) =>
  prisma.$transaction(async (tx) => {
    const run = await tx.stepRun.create({
      data: {
        stepId: data.stepId,
        clientId: data.clientId,
        spocId: data.spocId,
        requestedById: data.requestedById,
        idempotencyKey: data.idempotencyKey,
        options: data.options,
        status: data.status ?? "QUEUED",
        nextCheckAt: new Date(), // the reconciler dispatches it if the first try is lost
        note: "Queued",
        ...(data.parentRunId && { parentRunId: data.parentRunId }),
      },
      select: RUN_OUT,
    });
    await recordEvent(tx, run.id, "Run requested", { to: run.status, payload: data.options });
    if (!data.parentRunId) {
      await logClientActivity(tx, {
        clientId: data.clientId,
        actorId: data.requestedById,
        type: "STEP_RUN_STARTED",
        summary: `${data.stepLabel} started`,
        meta: { runId: run.id },
      });
    }
    return run;
  });

// ── POST /step-runs ──────────────────────────────────────────────────────────

export const startRun = async (user: AuthUser, input: StartRunInput) => {
  const step = await findStep(input.stepKey);
  const def = stepDef(step.key);
  if (!def) throw ApiError(400, `Step "${step.key}" has no definition`, "STEP_NOT_FOUND");

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw notFound("Client");

  const spocIds = input.spocIds?.length ? [...new Set(input.spocIds)].sort() : undefined;
  if (spocIds) {
    if (def.spocInput === "none") throw ApiError(400, `"${step.label}" does not take SPOCs`, "NO_SPOC_INPUT");
    const found = await prisma.clientSpoc.findMany({
      where: { id: { in: spocIds }, clientId: client.id, isActive: true },
      select: { approvalStatus: true },
    });
    if (found.length !== spocIds.length) {
      throw ApiError(400, "Some SPOCs are not active SPOCs of this client", "INVALID_SPOCS");
    }
    if (def.spocInput === "approved" && found.some((s) => s.approvalStatus !== "APPROVED")) {
      throw ApiError(400, "Only approved SPOCs can get outreach emails", "SPOCS_NOT_APPROVED");
    }
  } else if (def.spocInput === "approved") {
    const approved = await prisma.clientSpoc.count({
      where: { clientId: client.id, isActive: true, approvalStatus: "APPROVED" },
    });
    if (!approved) throw ApiError(400, "This client has no approved SPOCs yet", "NO_APPROVED_SPOCS");
  }

  // run_all: every step of the chain must be runnable by this user now
  const chainKeys = def.engineStage === null ? chainSteps(input.options) : [];
  for (const key of chainKeys) await assertWithinLimit(user, await findStep(key), client.id);
  if (def.engineStage !== null) await assertWithinLimit(user, step, client.id);

  const needsBuSl = def.createsSpocs && (def.engineStage !== null || chainKeys.some((k) => stepDef(k)?.createsSpocs));
  const buSl = needsBuSl ? await resolveBuSl(user.id, input.businessUnitId, input.serviceLineId) : {};

  const options = {
    ...(input.options ?? {}),
    ...(chainKeys.length && { steps: chainKeys }),
    ...(spocIds && { spocIds }),
    ...buSl,
  } as Prisma.InputJsonObject;

  const idempotencyKey = fingerprint({ step: step.id, client: client.id, options });
  const existing = await prisma.stepRun.findUnique({ where: { idempotencyKey }, select: RUN_OUT });
  if (existing) return { run: existing, duplicate: true };

  let run;
  try {
    run = await createRunRow({
      stepId: step.id,
      stepLabel: step.label,
      clientId: client.id,
      spocId: spocIds?.length === 1 ? spocIds[0]! : null,
      requestedById: user.id,
      idempotencyKey,
      options,
    });
  } catch (e) {
    // a double click that raced past the check above
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.stepRun.findUnique({ where: { idempotencyKey }, select: RUN_OUT });
      if (again) return { run: again, duplicate: true };
    }
    throw e;
  }

  if (def.engineStage === null) {
    await moveRun(run.id, "RUNNING", { note: "Starting" }, "Run all steps started");
    await advanceChain(run.id);
  } else {
    void dispatchRun(run.id);
  }
  return { run, duplicate: false };
};

const chainSteps = (options?: Record<string, unknown>) => {
  const asked = Array.isArray(options?.steps) ? (options!.steps as string[]) : RUN_ALL_DEFAULT;
  const keys = asked.filter((k) => stepDef(k)?.engineStage);
  if (!keys.length) throw ApiError(400, "Pick at least one step to run", "NO_STEPS");
  // keep catalog order — later steps need earlier results
  return [...new Set(keys)].sort((a, b) => stepDef(a)!.uiOrder - stepDef(b)!.uiOrder);
};

// ── Run all steps ────────────────────────────────────────────────────────────

export const advanceChain = async (parentId: string) => {
  const parent = await prisma.stepRun.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      status: true,
      clientId: true,
      requestedById: true,
      options: true,
      childRuns: { select: { status: true, step: { select: { key: true, label: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!parent || isTerminal(parent.status)) return;
  if (parent.childRuns.some((c) => ACTIVE.includes(c.status))) return;

  const opts = (parent.options ?? {}) as Record<string, any>;
  const steps: string[] = opts.steps ?? [];
  const i = parent.childRuns.length;

  if (i >= steps.length) {
    const statuses = parent.childRuns.map((c) => c.status);
    const final: StepRunStatus = statuses.includes("DONE") ? "DONE" : statuses.every((s) => s === "EMPTY") ? "EMPTY" : "FAILED";
    await moveRun(parent.id, final, {
      progress: 100,
      note: `${statuses.filter((s) => s === "DONE" || s === "EMPTY").length} of ${steps.length} steps finished`,
      resultSummary: { steps: parent.childRuns.map((c) => ({ key: c.step.key, label: c.step.label, status: c.status })) },
      ...(final === "FAILED" && {
        errorCode: "ALL_STEPS_FAILED",
        errorMessage: "No step finished",
        howToContinue: "Open each step below to see why, fix it, then run again.",
      }),
    }, "All steps done");
    return;
  }

  const key = steps[i]!;
  let step: StepRow;
  try {
    step = await findStep(key);
  } catch {
    await moveRun(parent.id, "FAILED", {
      errorCode: "STEP_NOT_FOUND",
      errorMessage: `Step "${key}" is switched off`,
      howToContinue: "Ask an admin to switch it on (Admin → Integrations), or run without it.",
    }, `Step ${key} unavailable`);
    return;
  }

  const { steps: _s, stepOptions, ...shared } = opts;
  let child;
  try {
    child = await createRunRow({
      stepId: step.id,
      stepLabel: step.label,
      clientId: parent.clientId,
      spocId: null,
      requestedById: parent.requestedById,
      idempotencyKey: `chain:${parent.id}:${i}`,
      options: { ...shared, ...(stepOptions?.[key] ?? {}) },
      parentRunId: parent.id,
    });
  } catch (e) {
    // another tick already started this step
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }

  await prisma.stepRun.update({
    where: { id: parent.id },
    data: { progress: Math.round((i / steps.length) * 100), note: `Step ${i + 1} of ${steps.length}: ${step.label}` },
  });
  await recordEvent(prisma, parent.id, `Started step ${i + 1}: ${step.label}`, { payload: { childRunId: child.id } });
  void dispatchRun(child.id);
};

onChildEnded(advanceChain);

// ── POST /step-runs/:id/stop ─────────────────────────────────────────────────

export const stopRun = async (runId: string, user: AuthUser): Promise<void> => {
  const run = await prisma.stepRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      externalJobId: true,
      step: { select: { key: true, service: { select: { baseUrl: true, outboundKeyEnv: true } } } },
      childRuns: { where: { status: { in: ACTIVE } }, select: { id: true } },
    },
  });
  if (!run) throw notFound("Step run");
  if (isTerminal(run.status)) throw ApiError(409, "This run has already finished", "ALREADY_FINISHED");

  const by = `${user.firstName} ${user.lastName}`.trim();

  if (stepDef(run.step.key)?.engineStage === null) {
    // parent first, so the child's end does not start the next step
    await moveRun(run.id, "STOPPED", { note: `Stopped by ${by}` }, `Stopped by ${by}`);
    for (const c of run.childRuns) await stopRun(c.id, user).catch(() => undefined);
    return;
  }

  if (!run.externalJobId) {
    await moveRun(run.id, "STOPPED", { note: `Stopped by ${by}` }, `Stopped by ${by} before it reached the pipeline`);
    return;
  }

  const reply = await engine.stop(run.step.service, run.externalJobId);
  if (!reply.ok) {
    await moveRun(run.id, "STOPPED", { note: `Stopped by ${by}` },
      `Stopped by ${by}; the pipeline could not be told (${reply.error})`);
    return;
  }
  // only while still active — a fast engine may already have reported the end
  await prisma.stepRun.updateMany({
    where: { id: run.id, status: { in: ACTIVE } },
    data: { note: "Stopping…", nextCheckAt: new Date(Date.now() + 60_000) },
  });
  await recordEvent(prisma, run.id, `Stop requested by ${by}`);
};
