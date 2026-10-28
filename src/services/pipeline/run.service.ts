// File: run.service.ts
// Path: src/services/pipeline/run.service.ts
//
// StepRun lifecycle: status moves (with an event row each), the job payload
// sent to the engine, dispatch with retry, and what happens when a run ends.
// Contract: docs/PIPELINE_INTEGRATION.md

import { Prisma, StepRunStatus } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { getSignedUrl } from "@/lib/s3";
import { loggers } from "@/utils/logger";
import { logClientActivity } from "@/services/clientActivity.service";
import { raiseAlert } from "@/services/alert.service";
import { notifyUsers } from "@/services/notification.service";
import { stepDef } from "@/config/pipeline";
import { spocWhereForUserId } from "@/services/scope.service";
import { engine } from "./engineClient";

type Db = Prisma.TransactionClient | typeof prisma;

export const ACTIVE: StepRunStatus[] = ["QUEUED", "RUNNING"];
const TERMINAL: StepRunStatus[] = ["DONE", "EMPTY", "FAILED", "STOPPED", "DISPATCH_FAILED", "TIMED_OUT"];
export const isTerminal = (s: StepRunStatus) => TERMINAL.includes(s);

export const CHECK_AFTER_MS = 2 * 60_000; // no callback for this long → ask the engine
const DOC_URL_TTL = 12 * 60 * 60; // presigned report links in the job payload

const after = (ms: number) => new Date(Date.now() + ms);

// ── events ───────────────────────────────────────────────────────────────────

// keys that must never be stored in event payloads
const SECRET = /key|token|secret|password|authorization/i;

export const maskPayload = (v: unknown, depth = 0): Prisma.InputJsonValue | undefined => {
  if (v === undefined || v === null) return undefined;
  if (depth > 4) return "[…]";
  if (Array.isArray(v)) {
    const head = v.slice(0, 20).map((x) => maskPayload(x, depth + 1) ?? null);
    return v.length > 20 ? [...head, `… ${v.length - 20} more`] : head;
  }
  if (typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        SECRET.test(k) ? "***" : (maskPayload(x, depth + 1) ?? null),
      ]),
    );
  }
  if (typeof v === "string" && v.length > 2000) return `${v.slice(0, 2000)}…`;
  return v as Prisma.InputJsonValue;
};

export const recordEvent = (
  db: Db,
  runId: string,
  message: string,
  opts: { from?: StepRunStatus | null; to?: StepRunStatus | null; payload?: unknown } = {},
) => {
  const payload = maskPayload(opts.payload);
  return db.stepRunEvent.create({
    data: {
      runId,
      message: message.slice(0, 1000),
      fromStatus: opts.from ?? null,
      toStatus: opts.to ?? null,
      ...(payload !== undefined && { payload }),
    },
  });
};

// ── status moves ─────────────────────────────────────────────────────────────

// Moves an active run. Returns false when the run already ended (lost race),
// so a late callback can never reopen a finished run.
export const moveRun = async (
  runId: string,
  to: StepRunStatus,
  data: Prisma.StepRunUpdateManyMutationInput,
  message: string,
  payload?: unknown,
): Promise<boolean> => {
  // a progress callback may move QUEUED → RUNNING in between: re-read and retry
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await prisma.stepRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!cur || isTerminal(cur.status)) return false;

    const res = await prisma.stepRun.updateMany({
      where: { id: runId, status: cur.status },
      data: {
        ...data,
        status: to,
        ...(to === "RUNNING" && cur.status !== "RUNNING" && { startedAt: new Date() }),
        ...(isTerminal(to) && { finishedAt: new Date(), nextCheckAt: null }),
      },
    });
    if (!res.count) continue;

    await recordEvent(prisma, runId, message, { from: cur.status, to, payload });
    if (isTerminal(to)) await onRunEnded(runId);
    return true;
  }
  return false;
};

// ── job payload ──────────────────────────────────────────────────────────────

const callbackBase = () =>
  (process.env.CRM_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 5005}`).replace(/\/+$/, "");

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export const buildJobPayload = async (runId: string) => {
  const run = await prisma.stepRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      requestedById: true,
      options: true,
      step: { select: { key: true, config: true } },
    },
  });
  const def = stepDef(run.step.key);
  const opts = (run.options ?? {}) as Record<string, any>;
  const spocIds: string[] | undefined = Array.isArray(opts.spocIds) ? opts.spocIds : undefined;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: run.clientId },
    select: {
      id: true,
      name: true,
      shortName: true,
      cin: true,
      website: true,
      linkedinUrl: true,
      legacyCaspaId: true,
      industry: { select: { label: true } },
      category: { select: { label: true } },
      locations: {
        where: { isActive: true },
        orderBy: { isPrimary: "desc" },
        take: 1,
        select: { state: true, district: true },
      },
      documents: {
        select: { fileKey: true, fileName: true, fy: true, type: { select: { code: true } } },
      },
      financials: { orderBy: { fy: "desc" } },
      programs: { include: { sector: { select: { label: true } } }, orderBy: { fy: "desc" } },
    },
  });

  const spocInput = def?.spocInput ?? "none";
  // a run works on the requester's own SPOCs only; "SPOCs from reports" gets
  // everyone's so the engine knows who already exists (no duplicates)
  const mine = run.step.key === "report_spocs" ? {} : await spocWhereForUserId(run.requestedById);
  const spocs =
    spocInput === "none"
      ? []
      : await prisma.clientSpoc.findMany({
          where: {
            clientId: run.clientId,
            isActive: true,
            ...(spocIds && { id: { in: spocIds } }),
            ...(spocInput === "approved" && { approvalStatus: "APPROVED" }),
            ...mine,
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            department: true,
            email: true,
            phone: true,
            linkedinUrl: true,
            seniority: true,
            approvalStatus: true,
            validationScore: true,
            validationBand: true,
            emailStatus: true,
            source: { select: { code: true } },
          },
        });

  const documents = await Promise.all(
    client.documents.map(async (d) => ({
      type: d.type.code,
      fy: d.fy,
      fileName: d.fileName,
      url: await getSignedUrl(d.fileKey, DOC_URL_TTL),
    })),
  );

  const loc = client.locations[0];
  const { spocIds: _ids, businessUnitId: _bu, serviceLineId: _sl, rerun: _r, ...stepOptions } = opts;

  return {
    runId: run.id,
    step: def?.engineStage ?? run.step.key,
    callbackUrl: `${callbackBase()}/api/svc/step-runs/${run.id}`,
    client: {
      id: client.id,
      name: client.name,
      shortName: client.shortName,
      cin: client.cin,
      website: client.website,
      linkedinUrl: client.linkedinUrl,
      category: client.category?.label ?? null,
      industry: client.industry?.label ?? null,
      state: loc?.state ?? null,
      district: loc?.district ?? null,
      legacyCaspaId: client.legacyCaspaId,
    },
    spocs: spocs.map(({ source, ...s }) => ({ ...s, source: source?.code ?? null })),
    context: {
      documents: documents.filter((d) => d.url),
      financials: client.financials.map((f) => ({
        fy: f.fy,
        obligationRs: num(f.obligationRs),
        budgetRs: num(f.budgetRs),
        spentRs: num(f.spentRs),
        unspentRs: num(f.unspentRs),
        isLocked: f.isLocked,
      })),
      programs: client.programs.map((p) => ({
        fy: p.fy,
        name: p.name,
        sector: p.sector?.label ?? null,
        budgetRs: num(p.budgetRs),
        locations: p.locations,
        beneficiaries: p.beneficiaries,
        implementor: p.implementor,
      })),
    },
    options: { ...((run.step.config as Record<string, unknown>) ?? {}), ...stepOptions },
  };
};

// ── dispatch ─────────────────────────────────────────────────────────────────

const RUN_SERVICE = {
  id: true,
  status: true,
  externalJobId: true,
  dispatchTries: true,
  step: {
    select: {
      key: true,
      service: { select: { baseUrl: true, outboundKeyEnv: true, maxDispatchTries: true, isActive: true } },
    },
  },
} as const satisfies Prisma.StepRunSelect;

// Sends a QUEUED run to the engine. Safe to call twice: the engine dedupes on runId.
export const dispatchRun = async (runId: string) => {
  const run = await prisma.stepRun.findUnique({ where: { id: runId }, select: RUN_SERVICE });
  if (!run || run.status !== "QUEUED" || run.externalJobId) return;
  const svc = run.step.service;

  let payload: Awaited<ReturnType<typeof buildJobPayload>>;
  try {
    payload = await buildJobPayload(runId);
  } catch (e) {
    await moveRun(runId, "DISPATCH_FAILED", {
      note: "Could not start",
      errorCode: "PAYLOAD",
      errorMessage: "Could not prepare the job from CRM data",
      howToContinue: "Check the client still exists, then run the step again.",
    }, `Payload failed: ${(e as Error).message}`);
    return;
  }

  const tries = run.dispatchTries + 1;
  const reply = svc.isActive
    ? await engine.dispatch(svc, payload)
    : { ok: false, status: null, data: null, error: "Service is switched off" };

  if (reply.ok && reply.data?.jobId !== undefined) {
    try {
      await prisma.stepRun.update({
        where: { id: runId },
        data: {
          externalJobId: String(reply.data.jobId),
          dispatchTries: tries,
          nextCheckAt: after(CHECK_AFTER_MS),
          note: "Waiting for the pipeline",
        },
      });
    } catch (e) {
      // another run already holds this job id: retrying would loop forever
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      await engine.stop(svc, String(reply.data.jobId));
      await moveRun(runId, "DISPATCH_FAILED", {
        note: "Could not start",
        errorCode: "DUPLICATE_JOB",
        errorMessage: `The pipeline gave job id ${reply.data.jobId}, which another run already has`,
        howToContinue: "The pipeline was probably reset. Run the step again.",
      }, `Duplicate job id ${reply.data.jobId}`);
      return;
    }
    await recordEvent(prisma, runId, `Accepted by the pipeline as job ${reply.data.jobId}`, {
      payload: { step: payload.step, spocs: payload.spocs.length, options: payload.options },
    });
    return;
  }

  // 4xx = the engine refused this job; retrying will not help
  const refused = reply.status !== null && reply.status >= 400 && reply.status < 500;
  if (refused || tries >= svc.maxDispatchTries) {
    await prisma.stepRun.update({ where: { id: runId }, data: { dispatchTries: tries } });
    await moveRun(runId, "DISPATCH_FAILED", {
      note: "Could not start",
      errorCode: refused ? "REFUSED" : "UNREACHABLE",
      errorMessage: refused
        ? `The pipeline refused the job: ${reply.error}`
        : `The pipeline could not be reached after ${tries} tries (${reply.error})`,
      howToContinue: refused
        ? "Fix what the message says, then run the step again."
        : "Check the pipeline is running (Admin → Integrations), then run the step again.",
    }, `Dispatch failed for good: ${reply.error}`);
    return;
  }

  const wait = Math.min(30_000 * 2 ** (tries - 1), 15 * 60_000);
  await prisma.stepRun.update({
    where: { id: runId },
    data: { dispatchTries: tries, nextCheckAt: after(wait), note: "Pipeline not reachable — retrying" },
  });
  await recordEvent(prisma, runId, `Dispatch try ${tries} failed (${reply.error}); next try in ${Math.round(wait / 1000)}s`);
};

// ── end of a run ─────────────────────────────────────────────────────────────

let chainHook: ((parentRunId: string) => Promise<void>) | null = null;
// chain.service registers itself here — avoids a circular import
export const onChildEnded = (fn: (parentRunId: string) => Promise<void>) => {
  chainHook = fn;
};

const onRunEnded = async (runId: string) => {
  const run = await prisma.stepRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      idempotencyKey: true,
      clientId: true,
      requestedById: true,
      parentRunId: true,
      errorCode: true,
      errorMessage: true,
      step: { select: { key: true, label: true } },
      client: { select: { name: true } },
    },
  });
  if (!run) return;
  const link = `/clients/${run.clientId}?tab=pipeline&run=${run.id}`;

  try {
    // free the double-click guard so the step can be run again
    if (!run.idempotencyKey.endsWith(`:${run.id}`)) {
      await prisma.stepRun.update({
        where: { id: run.id },
        data: { idempotencyKey: `${run.idempotencyKey}:${run.id}` },
      });
    }

    const ok = run.status === "DONE" || run.status === "EMPTY";
    const verb = { DONE: "finished", EMPTY: "found nothing new", STOPPED: "was stopped" }[run.status as string] ??
      `failed (${run.status.toLowerCase().replace("_", " ")})`;

    await logClientActivity(prisma, {
      clientId: run.clientId,
      actorId: null,
      type: ok || run.status === "STOPPED" ? "STEP_RUN_FINISHED" : "STEP_RUN_FAILED",
      summary: `${run.step.label} ${verb}`,
      meta: { runId: run.id, status: run.status },
    });

    // children of "Run all steps" report through their parent
    if (!run.parentRunId) {
      await notifyUsers(prisma, [run.requestedById], null, {
        type: ok || run.status === "STOPPED" ? "STEP_RUN_FINISHED" : "STEP_RUN_FAILED",
        severity: ok ? "SUCCESS" : run.status === "STOPPED" ? "INFO" : "ERROR",
        title: `${run.step.label} ${verb}`,
        body: ok ? run.client.name : `${run.client.name}: ${run.errorMessage ?? ""}`.trim(),
        link,
        referenceId: run.id,
        referenceType: "STEP_RUN",
      });
    }

    // failures are a system problem too: one alert per step + reason, counted
    if (!ok && run.status !== "STOPPED") {
      const code = run.errorCode ?? run.status;
      await raiseAlert({
        key: `run-failed:${run.step.key}:${code}`,
        severity: ["UNREACHABLE", "DUPLICATE_JOB", "JOB_LOST", "PAYLOAD"].includes(code) ? "ERROR" : "WARNING",
        source: "pipeline",
        title: `${run.step.label} runs are failing (${code})`,
        body: `Latest: ${run.client.name} — ${run.errorMessage ?? run.status}`,
        link,
        meta: { runId: run.id, clientId: run.clientId },
      });
    }
  } catch (e) {
    loggers.error(`Step run ${runId}: end-of-run bookkeeping failed`, e);
  }

  if (run.parentRunId && chainHook) {
    await chainHook(run.parentRunId).catch((e) =>
      loggers.error(`Run all ${run.parentRunId}: could not start the next step`, e),
    );
  }
};
