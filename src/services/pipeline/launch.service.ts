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
import { spocWhereForUserId } from "@/services/scope.service";
import { assertSlots, canForceRerun, rerunBlock, slotBlock, type RuleUser } from "./runRules.service";

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
  rerun?: boolean | undefined; // run a step again although it was done recently
};

// engine stages that redo finished work only when told to
const ENGINE_FORCE = new Set(["figures", "apollo", "validate", "emails"]);

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

// New SPOCs need a BU + SL. The BU is the client's; the SL must be one of the
// client's service lines and is picked for the user when there is only one choice.
// Clients without BU / SLs fall back to the user's own (exactly one of each).
const resolveBuSl = async (
  userId: string,
  client: { businessUnitId: string | null; serviceLines: { serviceLineId: string }[] },
  buId?: string,
  slId?: string,
) => {
  const clientSls = client.serviceLines.map((s) => s.serviceLineId);
  if (buId && client.businessUnitId && buId !== client.businessUnitId) {
    throw ApiError(400, "New SPOCs go under the client's own business unit", "BU_NOT_CLIENTS");
  }
  if (slId && clientSls.length && !clientSls.includes(slId)) {
    throw ApiError(400, "Pick one of this client's service lines", "SL_NOT_CLIENTS");
  }

  const [bus, sls] = await Promise.all([
    buId || client.businessUnitId
      ? null
      : prisma.userBusinessUnit.findMany({ where: { userId }, select: { businessUnitId: true } }),
    slId || clientSls.length === 1
      ? null
      : prisma.userServiceLine.findMany({ where: { userId }, select: { serviceLineId: true } }),
  ]);
  const mySls = (sls ?? []).map((s) => s.serviceLineId).filter((id) => !clientSls.length || clientSls.includes(id));

  const businessUnitId = buId ?? client.businessUnitId ?? (bus?.length === 1 ? bus[0]!.businessUnitId : undefined);
  const serviceLineId = slId ?? (clientSls.length === 1 ? clientSls[0] : mySls.length === 1 ? mySls[0] : undefined);
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

// What a step needs from the CRM before it can do anything for this client.
// null = ready; otherwise the reason + what to do. Used to refuse a single run
// and to skip a step inside "Run all" without sending it to the engine.
const missingInput = async (
  stepKey: string,
  clientId: string,
  options: Record<string, unknown>,
  userId: string,
): Promise<{ message: string; howToContinue: string } | null> => {
  if (stepKey === "report_spocs" || stepKey === "figures") {
    const docs = await prisma.clientDocument.count({ where: { clientId } });
    if (!docs) {
      return {
        message: "No reports for this client yet",
        howToContinue: "Run \u201cFind CSR reports\u201d first. If it finds none, check the client's website.",
      };
    }
  }
  const needsSpocs = stepKey === "enrich" || stepKey === "validate" || (stepKey === "apollo" && options.mode !== "find");
  if (needsSpocs) {
    // the run only works on the requester's own SPOCs
    const spocs = await prisma.clientSpoc.count({
      where: { clientId, isActive: true, ...(await spocWhereForUserId(userId)) },
    });
    if (!spocs) {
      return {
        message: "You have no SPOCs at this client yet",
        howToContinue:
          stepKey === "apollo"
            ? "Turn on \u201cFind new decision-makers\u201d, run \u201cSPOCs from reports\u201d, or add a SPOC by hand."
            : "Find them with \u201cSPOCs from reports\u201d or Apollo, or add a SPOC by hand.",
      };
    }
  }
  return null;
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
    select: { id: true, businessUnitId: true, serviceLines: { select: { serviceLineId: true } } },
  });
  if (!client) throw notFound("Client");

  const spocIds = input.spocIds?.length ? [...new Set(input.spocIds)].sort() : undefined;
  if (spocIds) {
    if (def.spocInput === "none") throw ApiError(400, `"${step.label}" does not take SPOCs`, "NO_SPOC_INPUT");
    const found = await prisma.clientSpoc.findMany({
      where: { id: { in: spocIds }, clientId: client.id, isActive: true, ...(await spocWhereForUserId(user.id)) },
      select: { approvalStatus: true },
    });
    if (found.length !== spocIds.length) {
      throw ApiError(400, "Some SPOCs are not active SPOCs of yours at this client", "INVALID_SPOCS");
    }
    if (def.spocInput === "approved" && found.some((s) => s.approvalStatus !== "APPROVED")) {
      throw ApiError(400, "Only approved SPOCs can get outreach emails", "SPOCS_NOT_APPROVED");
    }
  } else if (def.spocInput === "approved") {
    const approved = await prisma.clientSpoc.count({
      where: { clientId: client.id, isActive: true, approvalStatus: "APPROVED", ...(await spocWhereForUserId(user.id)) },
    });
    if (!approved) throw ApiError(400, "You have no approved SPOCs at this client yet", "NO_APPROVED_SPOCS");
  }

  if (def.engineStage !== null) {
    const missing = await missingInput(step.key, client.id, input.options ?? {}, user.id);
    if (missing) throw ApiError(400, `${missing.message}. ${missing.howToContinue}`, "NO_INPUT");
  }

  const forced = !!input.rerun;
  if (forced && !(await canForceRerun(user))) {
    throw ApiError(403, "Only an admin can run a step again before its re-run date", "FORBIDDEN");
  }
  if (def.engineStage !== null && !forced) {
    const done = await rerunBlock(step, client.id, user.id);
    if (done) {
      const can = await canForceRerun(user);
      throw ApiError(409, `${done.message}.${can ? "" : " Ask an admin if it must run again now."}`, "ALREADY_DONE");
    }
  }
  await assertSlots(user, step);

  // run_all: every step of the chain must be runnable by this user now
  const chainKeys = def.engineStage === null ? chainSteps(input.options) : [];
  for (const key of chainKeys) await assertWithinLimit(user, await findStep(key), client.id);
  if (def.engineStage !== null) await assertWithinLimit(user, step, client.id);

  const needsBuSl = def.engineStage !== null ? def.createsSpocs : chainKeys.some((k) => stepDef(k)?.createsSpocs);
  const buSl = needsBuSl
    ? await resolveBuSl(user.id, client, input.businessUnitId, input.serviceLineId)
    : {};

  const options = {
    ...(input.options ?? {}),
    ...(forced && def.engineStage !== null && ENGINE_FORCE.has(step.key) && { force: true }),
    ...(forced && { rerun: true }),
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

// "2 done · 1 found nothing · 3 skipped (no reports)" — what the chain actually did
const chainNote = (children: { status: StepRunStatus; note: string | null }[]) => {
  const skipped = children.filter((c) => c.note?.startsWith("Skipped"));
  const count = (st: StepRunStatus) => children.filter((c) => c.status === st && !skipped.includes(c)).length;
  const why = [...new Set(skipped.map((c) => c.note!.replace(/^Skipped: (.)/, (_m, a: string) => a.toLowerCase())))];
  return [
    count("DONE") && `${count("DONE")} done`,
    count("EMPTY") && `${count("EMPTY")} found nothing`,
    count("FAILED") + count("TIMED_OUT") + count("DISPATCH_FAILED") &&
      `${count("FAILED") + count("TIMED_OUT") + count("DISPATCH_FAILED")} failed`,
    skipped.length && `${skipped.length} skipped (${why.join("; ")})`,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 300);
};

const chainSkip = async (
  step: StepRow,
  parent: { clientId: string; requestedById: string; options: unknown },
  options: Record<string, unknown>,
) => {
  const missing = await missingInput(step.key, parent.clientId, options, parent.requestedById);
  if (missing) return missing;

  const user: RuleUser | null = await prisma.user.findUnique({
    where: { id: parent.requestedById },
    select: { id: true, roleId: true, isSuperAdmin: true },
  });
  if (!user) return { message: "The person who started this run no longer exists", howToContinue: "Start it again." };
  if (!(parent.options as Record<string, unknown> | null)?.rerun) {
    const done = await rerunBlock(step, parent.clientId, user.id);
    if (done) {
      return {
        message: `Already done by ${done.byMe ? "you" : done.by}`,
        howToContinue: `${done.message}.`,
      };
    }
  }
  const slots = await slotBlock(user, step, false);
  if (slots) return { message: "No run slots left", howToContinue: `${slots}.` };
  return null;
};

export const advanceChain = async (parentId: string) => {
  const parent = await prisma.stepRun.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      status: true,
      clientId: true,
      requestedById: true,
      options: true,
      childRuns: { select: { status: true, note: true, step: { select: { key: true, label: true } } }, orderBy: { createdAt: "asc" } },
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
      note: chainNote(parent.childRuns),
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
      options: {
        ...shared,
        ...(stepOptions?.[key] ?? {}),
        ...(shared.rerun && ENGINE_FORCE.has(key) && { force: true }),
      },
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
  // nothing to work on (an earlier step found nothing), done recently, or no
  // run slots left → skipped, not sent
  const missing = await chainSkip(step, parent, { ...shared, ...(stepOptions?.[key] ?? {}) });
  if (missing) {
    await recordEvent(prisma, parent.id, `Skipped step ${i + 1}: ${step.label} — ${missing.message}`);
    await moveRun(child.id, "EMPTY", {
      progress: 100,
      note: `Skipped: ${missing.message}`,
      howToContinue: missing.howToContinue,
    }, `Skipped: ${missing.message}`);
    return;
  }
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
