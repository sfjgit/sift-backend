// File: reconciler.service.ts
// Path: src/services/pipeline/reconciler.service.ts
//
// Safety net for callbacks that never arrive. Every tick:
//   - QUEUED runs never accepted → dispatch again
//   - runs past timeoutMins → TIMED_OUT (engine asked to stop)
//   - runs quiet past nextCheckAt → ask the engine; save results it already has
//   - "Run all" parents whose children all ended → start the next step
//   - every 5 min → service health
// One tick at a time per process; status moves are conditional, so two
// processes cannot finish a run twice.

import prisma from "@/utils/prisma/client";
import { loggers } from "@/utils/logger";
import { svcResultsBody } from "@/validators/svc.validators";
import { raiseAlert, resolveAlert } from "@/services/alert.service";
import { engine } from "./engineClient";
import { applyResults } from "./ingest.service";
import { advanceChain } from "./launch.service";
import { ACTIVE, CHECK_AFTER_MS, dispatchRun, moveRun, recordEvent } from "./run.service";

const HEALTH_EVERY_MS = 5 * 60_000;
const BATCH = 50;

const ENGINE_STATUS = new Set(["QUEUED", "RUNNING", "DONE", "EMPTY", "FAILED", "STOPPED"]);

const checkRun = async (run: {
  id: string;
  status: string;
  externalJobId: string | null;
  startedAt: Date | null;
  createdAt: Date;
  step: { service: { baseUrl: string | null; outboundKeyEnv: string | null; timeoutMins: number } };
}) => {
  const svc = run.step.service;

  if (!run.externalJobId) {
    if (run.status === "QUEUED") await dispatchRun(run.id);
    return;
  }

  const since = (run.startedAt ?? run.createdAt).getTime();
  if (Date.now() - since > svc.timeoutMins * 60_000) {
    await engine.stop(svc, run.externalJobId);
    await moveRun(run.id, "TIMED_OUT", {
      errorCode: "TIMED_OUT",
      errorMessage: `No result after ${svc.timeoutMins} minutes`,
      howToContinue: "Check the pipeline is running (Admin → Integrations), then run the step again.",
    }, `Timed out after ${svc.timeoutMins} min`);
    return;
  }

  const reply = await engine.status(svc, run.externalJobId);
  const next = new Date(Date.now() + CHECK_AFTER_MS);

  if (reply.status === 404) {
    await moveRun(run.id, "FAILED", {
      errorCode: "JOB_LOST",
      errorMessage: "The pipeline no longer knows this job (it may have been reset)",
      howToContinue: "Run the step again.",
    }, "Engine has no such job");
    return;
  }
  if (!reply.ok || !reply.data || !ENGINE_STATUS.has(reply.data.status)) {
    await prisma.stepRun.update({ where: { id: run.id }, data: { nextCheckAt: next } });
    return;
  }

  const s = reply.data;
  if (s.result && ["DONE", "EMPTY", "FAILED", "STOPPED"].includes(s.status)) {
    const parsed = svcResultsBody.safeParse(s.result);
    if (parsed.success) {
      await applyResults(run.id, parsed.data, "status check");
      return;
    }
    await recordEvent(prisma, run.id, "Engine result did not match the contract", {
      payload: parsed.error.issues.slice(0, 10),
    });
    await raiseAlert({
      key: `result-contract:${run.id}`,
      severity: "ERROR",
      source: "engine",
      title: "The pipeline sent a result the CRM cannot read",
      body: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      meta: { runId: run.id },
    });
  }
  if (["FAILED", "STOPPED"].includes(s.status) && !s.result) {
    await moveRun(run.id, s.status as "FAILED" | "STOPPED", {
      note: s.status === "STOPPED" ? "Stopped" : "Failed",
      ...(s.status === "FAILED" && { errorCode: "ENGINE_ERROR", errorMessage: s.note ?? "The pipeline step failed" }),
    }, `Engine reports ${s.status}`);
    return;
  }

  if (s.status === "RUNNING" && run.status === "QUEUED") {
    await moveRun(run.id, "RUNNING", { nextCheckAt: next }, "Engine started the job (status check)");
  }
  await prisma.stepRun.update({
    where: { id: run.id },
    data: {
      nextCheckAt: next,
      ...(typeof s.progress === "number" && { progress: Math.max(0, Math.min(100, Math.round(s.progress))) }),
      ...(s.note && { note: s.note.slice(0, 300) }),
    },
  });
};

const checkHealth = async () => {
  const services = await prisma.externalService.findMany({
    where: { isActive: true, baseUrl: { not: null } },
    select: { id: true, code: true, name: true, baseUrl: true, outboundKeyEnv: true },
  });
  for (const svc of services) {
    const reply = await engine.health(svc);
    const ok = reply.ok && (reply.data as any)?.ok !== false;
    const workerDown = ok && (reply.data as any)?.worker?.online === false;
    await prisma.externalService.update({
      where: { id: svc.id },
      data: { lastHealthAt: new Date(), lastHealthOk: ok },
    });

    if (ok) await resolveAlert(`engine-down:${svc.code}`);
    else {
      await raiseAlert({
        key: `engine-down:${svc.code}`,
        severity: "ERROR",
        source: "engine",
        title: `${svc.name} is not responding`,
        body: reply.error ?? `HTTP ${reply.status}`,
        link: "/admin/integrations",
      });
    }
    if (workerDown) {
      await raiseAlert({
        key: `worker-down:${svc.code}`,
        severity: "ERROR",
        source: "engine",
        title: `${svc.name}: the worker is offline — runs will wait in the queue`,
        link: "/admin/integrations",
      });
    } else if (ok) await resolveAlert(`worker-down:${svc.code}`);
  }
};

let running = false;
let lastHealth = 0;

export const reconcileOnce = async () => {
  if (running) return;
  running = true;
  try {
    const due = await prisma.stepRun.findMany({
      where: {
        status: { in: ACTIVE },
        step: { key: { not: "run_all" } },
        OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: new Date() } }],
      },
      select: {
        id: true,
        status: true,
        externalJobId: true,
        startedAt: true,
        createdAt: true,
        step: { select: { service: { select: { baseUrl: true, outboundKeyEnv: true, timeoutMins: true } } } },
      },
      orderBy: { nextCheckAt: "asc" },
      take: BATCH,
    });
    for (const run of due) {
      await checkRun(run).catch(async (e) => {
        loggers.error(`Reconcile run ${run.id} failed`, e);
        await raiseAlert({
          key: `reconcile:${run.id}`,
          severity: "WARNING",
          source: "pipeline",
          title: "A pipeline run could not be checked",
          body: String((e as Error)?.message ?? e).slice(0, 500),
          meta: { runId: run.id },
        });
      });
    }

    const parents = await prisma.stepRun.findMany({
      where: { status: "RUNNING", step: { key: "run_all" }, childRuns: { none: { status: { in: ACTIVE } } } },
      select: { id: true },
      take: BATCH,
    });
    for (const p of parents) await advanceChain(p.id).catch((e) => loggers.error(`Advance run all ${p.id} failed`, e));

    if (Date.now() - lastHealth > HEALTH_EVERY_MS) {
      lastHealth = Date.now();
      await checkHealth().catch((e) => loggers.error("Service health check failed", e));
    }
  } catch (e) {
    // the DB dropped the connection (Neon idles out) — try again next tick
    loggers.error("Pipeline reconcile tick failed", e);
  } finally {
    running = false;
  }
};

export const startReconciler = () => {
  const seconds = Number(process.env.PIPELINE_RECONCILE_SECONDS ?? 30);
  if (!seconds) {
    loggers.info("Pipeline reconciler disabled (PIPELINE_RECONCILE_SECONDS=0)");
    return;
  }
  const timer = setInterval(() => void reconcileOnce(), seconds * 1000);
  timer.unref();
  loggers.info(`Pipeline reconciler every ${seconds}s`);
};
