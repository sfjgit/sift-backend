// File: website.service.ts
// Path: src/services/website.service.ts
//
// A client's website that no longer opens.
//   1. A website-dependent step (find offices, find CSR reports) ends because the
//      website does not open → the "website" step runs by itself (the finder
//      re-checks it strictly and looks for the current one).
//   2. The person who ran the step gets a pop-up with what was found and replaces
//      the website in one click (or dismisses it). No approval — they override.
//   3. Every change of a website — from the pop-up or the client form — is in the
//      client's activity (who, when, old → new, how), which is its website history.
//   4. After a replace, the steps that failed for the website run again.

import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError, notFound } from "@/utils/httpError";
import { loggers } from "@/utils/logger";
import { runInTenant } from "@/utils/prisma/tenant";
import { logClientActivity } from "@/services/clientActivity.service";
import { afterRunEnded } from "@/services/pipeline/run.service";
import { startRun } from "@/services/pipeline/launch.service";
import type { ResultWebsite } from "@/validators/svc.validators";
import { engine, type WebsiteCheckResult } from "@/services/pipeline/engineClient";
import { notifyUsers } from "@/services/notification.service";
import type { AuthUser } from "@/types/express";

type Db = Prisma.TransactionClient | typeof prisma;

export const WEBSITE_STEP = "website";
// steps that need the website to open; they run again after a replace
const NEEDS_WEBSITE = ["branches", "reports"];
// how a step says the website does not open (the finder's code, or the engine's words)
const DEAD_CODES = new Set(["WEBSITE_UNREACHABLE", "WEBSITE_DOWN", "SITE_UNREACHABLE"]);
const DEAD_WORDS = /could not be (opened|reached)|does not open|unreachable|dns|no connection/i;
const SUGGEST_FOR_DAYS = 7;
const CHECK_AGAIN_AFTER_MS = 6 * 60 * 60 * 1000;

export type WebsiteVia = "website_check" | "edit" | "suggestion_manual";

/** one website change in the client's activity — the website history */
export const logWebsiteChange = (
  db: Db,
  c: {
    clientId: string;
    actorId: string | null;
    old: string | null;
    new: string | null;
    via: WebsiteVia;
    runId?: string | null | undefined;
    check?: { belongs: string; evidence: string[] } | undefined;
  },
) =>
  logClientActivity(db, {
    clientId: c.clientId,
    actorId: c.actorId,
    type: "CLIENT_UPDATED",
    summary: `Website changed: ${c.old || "—"} → ${c.new || "—"}${c.via === "website_check" ? " (found by the website check)" : ""}`,
    meta: { field: "website", website: { old: c.old, new: c.new, via: c.via, runId: c.runId ?? null, ...(c.check && { check: c.check }) } },
  });

const authUser = async (id: string): Promise<AuthUser | null> => {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, firstName: true, lastName: true, roleId: true, isSuperAdmin: true, departmentId: true, tenantId: true, isActive: true },
  });
  if (!u || !u.isActive) return null;
  const { isActive: _a, ...rest } = u;
  return rest as AuthUser;
};

// ── 1. a step ended because the website does not open → check it ────────────

afterRunEnded(async (runId) => {
  const run = await prisma.stepRun.findUnique({
    where: { id: runId },
    select: {
      id: true, tenantId: true, status: true, clientId: true, requestedById: true, parentRunId: true,
      errorCode: true, errorMessage: true, note: true, step: { select: { key: true } },
      client: { select: { website: true } },
    },
  });
  if (!run || !NEEDS_WEBSITE.includes(run.step.key) || !["FAILED", "EMPTY"].includes(run.status)) return;
  const dead = (run.errorCode && DEAD_CODES.has(run.errorCode)) || DEAD_WORDS.test(`${run.errorMessage ?? ""} ${run.note ?? ""}`);
  if (!dead || !run.client.website) return;

  // checked a moment ago (another step hit the same dead website) → once is enough
  const recent = await prisma.stepRun.findFirst({
    where: {
      clientId: run.clientId,
      step: { key: WEBSITE_STEP },
      createdAt: { gt: new Date(Date.now() - CHECK_AGAIN_AFTER_MS) },
      status: { in: ["QUEUED", "RUNNING", "DONE"] },
    },
    select: { id: true },
  });
  if (recent) return;

  const user = await authUser(run.requestedById);
  if (!user) return;
  await runInTenant(run.tenantId, () =>
    startRun(user, {
      stepKey: WEBSITE_STEP,
      clientId: run.clientId,
      options: { triggerRunId: run.id, triggerStep: run.step.key, website: run.client.website },
    }),
  ).catch((e) => loggers.error(`Website check for client ${run.clientId} not started`, e));
});

// ── 2. the pop-up: what the website check found for me ──────────────────────

type Decision = { action: "replaced" | "dismissed"; byId: string; byName: string; at: string; url?: string };
// "ask an admin": open until a super admin saves a website (DONE)
type AdminRequest = { status: "OPEN" | "DONE"; byId: string; byName: string; at: string; doneBy?: string; doneAt?: string; url?: string };
type View = { website?: ResultWebsite; websiteDecision?: Decision; websiteRequest?: AdminRequest } & Record<string, unknown>;

const nameOf = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/** website checks I started that found a working website, not yet acted on */
export const mySuggestions = async (userId: string) => {
  const runs = await prisma.stepRun.findMany({
    where: {
      requestedById: userId,
      status: { in: ["DONE", "EMPTY"] }, // EMPTY = dead, nothing found
      step: { key: WEBSITE_STEP },
      finishedAt: { gt: new Date(Date.now() - SUGGEST_FOR_DAYS * 86_400_000) },
    },
    orderBy: { finishedAt: "desc" },
    take: 20,
    select: {
      id: true, finishedAt: true, options: true, viewData: true,
      client: { select: { id: true, name: true, website: true } },
    },
  });
  return runs
    .map((r) => {
      const v = (r.viewData ?? {}) as View;
      const w = v.website;
      const opts = (r.options ?? {}) as Record<string, unknown>;
      // acted on, the website opens, or it was changed since — no pop-up
      // (dead with nothing found still pops up: the person types the right one)
      if (v.websiteDecision || v.websiteRequest || !w?.dead) return null;
      if ((r.client.website ?? "").trim() !== (w.oldUrl ?? "").trim()) return null;
      return {
        runId: r.id,
        finishedAt: r.finishedAt,
        client: { id: r.client.id, name: r.client.name },
        oldUrl: w.oldUrl ?? null,
        tried: w.tried,
        candidates: w.candidates,
        triggerStep: (opts.triggerStep as string) ?? null,
      };
    })
    .filter(Boolean);
};

/** one website check, for the dialog opened from a run: what it found and whether it was acted on */
export const oneSuggestion = async (runId: string) => {
  const r = await prisma.stepRun.findFirst({
    where: { id: runId, step: { key: WEBSITE_STEP } },
    select: {
      id: true, status: true, finishedAt: true, options: true, viewData: true,
      client: { select: { id: true, name: true, website: true, cin: true, industry: { select: { label: true } } } },
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!r) throw notFound("Website check");
  const v = (r.viewData ?? {}) as View;
  const w = v.website;
  return {
    runId: r.id,
    status: r.status,
    finishedAt: r.finishedAt,
    client: {
      id: r.client.id,
      name: r.client.name,
      website: r.client.website,
      cin: r.client.cin,
      industry: r.client.industry?.label ?? null,
    },
    requestedBy: r.requestedBy,
    request: v.websiteRequest ?? null,
    oldUrl: w?.oldUrl ?? ((r.options ?? {}) as Record<string, unknown>).website ?? null,
    dead: w?.dead ?? null,
    opensAt: w?.opensAt ?? null,
    tried: w?.tried ?? [],
    candidates: w?.candidates ?? [],
    triggerStep: (((r.options ?? {}) as Record<string, unknown>).triggerStep as string) ?? null,
    decision: v.websiteDecision ?? null,
  };
};

const markDecision = async (db: Db, runId: string, decision: Decision) => {
  const run = await db.stepRun.findUnique({ where: { id: runId }, select: { viewData: true } });
  const view = (run?.viewData ?? {}) as Record<string, unknown>;
  await db.stepRun.update({
    where: { id: runId },
    data: { viewData: { ...view, websiteDecision: decision } as unknown as Prisma.InputJsonObject },
  });
};

/** nothing usable was found: ask the super admins to put in the right website */
export const requestAdmin = async (user: AuthUser, runId: string) => {
  const run = await prisma.stepRun.findFirst({
    where: { id: runId, step: { key: WEBSITE_STEP } },
    select: { id: true, viewData: true, client: { select: { id: true, name: true } } },
  });
  if (!run) throw notFound("Website check");
  const view = (run.viewData ?? {}) as View;
  if (view.websiteRequest?.status === "OPEN") return { alreadyAsked: true };
  const request: AdminRequest = { status: "OPEN", byId: user.id, byName: nameOf(user), at: new Date().toISOString() };
  await prisma.stepRun.update({
    where: { id: run.id },
    data: { viewData: { ...view, websiteRequest: request } as unknown as Prisma.InputJsonObject },
  });
  const admins = await prisma.user.findMany({ where: { isActive: true, isSuperAdmin: true }, select: { id: true } });
  await notifyUsers(prisma, admins.map((a) => a.id), user.id, {
    type: "SYSTEM_ALERT",
    severity: "WARNING",
    title: `Update the website of ${run.client.name}`,
    body: `${nameOf(user)} asks: its website does not open and the system could not find the current one.`,
    link: `/clients/${run.client.id}?fixWebsite=${run.id}`,
    referenceId: run.id,
    referenceType: "STEP_RUN",
  });
  return { alreadyAsked: false };
};

/** an admin checks a website they typed, before saving it */
export const checkTyped = async (clientId: string, url: string): Promise<WebsiteCheckResult> => {
  const [client, svc] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { name: true, cin: true } }),
    prisma.externalService.findUnique({ where: { code: "BRANCH_FINDER" }, select: { baseUrl: true, outboundKeyEnv: true } }),
  ]);
  if (!client) throw notFound("Client");
  if (!svc) throw ApiError(503, "The website checker is not set up", "SERVICE_OFF");
  const reply = await engine.checkWebsite(svc, { name: client.name, cin: client.cin, url });
  if (!reply.ok || !reply.data) throw ApiError(502, `The website could not be checked: ${reply.error ?? "no answer"}`, "CHECK_FAILED");
  return reply.data;
};

export const dismissSuggestion = async (user: AuthUser, runId: string) => {
  const run = await prisma.stepRun.findFirst({ where: { id: runId, step: { key: WEBSITE_STEP } }, select: { id: true } });
  if (!run) throw notFound("Website check");
  await markDecision(prisma, run.id, {
    action: "dismissed",
    byId: user.id,
    byName: `${user.firstName} ${user.lastName}`.trim(),
    at: new Date().toISOString(),
  });
};

// ── 3 + 4. replace the website, keep the history, run the failed steps again ──

const cleanUrl = (raw: string) => {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const p = new URL(u);
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(p.hostname)) throw new Error("host");
    return `${p.protocol}//${p.hostname.toLowerCase()}${p.pathname === "/" ? "" : p.pathname}`;
  } catch {
    throw ApiError(400, "That is not a website address", "INVALID_WEBSITE");
  }
};

export const replaceWebsite = async (
  user: AuthUser,
  clientId: string,
  input: { website: string; runId?: string | undefined; force?: boolean | undefined },
) => {
  const url = cleanUrl(input.website);
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true, website: true } });
  if (!client) throw notFound("Client");
  const run = input.runId
    ? await prisma.stepRun.findFirst({
        where: { id: input.runId, clientId, step: { key: WEBSITE_STEP } },
        select: { id: true, viewData: true },
      })
    : null;
  if (input.runId && !run) throw notFound("Website check");
  const view = (run?.viewData ?? {}) as View;
  const found = !!view.website?.candidates.some((c) => c.url === url);

  if ((client.website ?? "").trim() === url) throw ApiError(409, "That is already the client's website", "SAME_WEBSITE");

  // a website the check found was verified already (opens + the client's CIN / name on it).
  // Anything typed: super admins only, and checked first.
  let check: WebsiteCheckResult | null = null;
  if (!found) {
    if (!user.isSuperAdmin) {
      throw ApiError(403, "Only an admin can type a website — use “Ask admin to update”", "ADMIN_ONLY");
    }
    check = await checkTyped(clientId, url);
    if (!check.opens) throw ApiError(400, `That website does not open (${check.why})`, "WEBSITE_DOES_NOT_OPEN");
    if ((check.belongs === "OTHER_CIN" || check.belongs === "UNKNOWN") && !input.force) {
      throw ApiError(409, `Check it first: ${check.evidence.join("; ")}`, "WEBSITE_NOT_VERIFIED");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { website: url } });
    await logWebsiteChange(tx, {
      clientId,
      actorId: user.id,
      old: client.website,
      new: url,
      via: run ? (found ? "website_check" : "suggestion_manual") : "edit",
      runId: run?.id ?? null,
      ...(check && { check: { belongs: check.belongs, evidence: check.evidence } }),
    });
    if (run && view.websiteRequest?.status === "OPEN") {
      // the admin answered the request
      const v2 = { ...view, websiteRequest: { ...view.websiteRequest, status: "DONE", doneBy: nameOf(user), doneAt: new Date().toISOString(), url } };
      await tx.stepRun.update({ where: { id: run.id }, data: { viewData: v2 as unknown as Prisma.InputJsonObject } });
    }
    if (run) {
      await markDecision(tx, run.id, {
        action: "replaced",
        byId: user.id,
        byName: `${user.firstName} ${user.lastName}`.trim(),
        at: new Date().toISOString(),
        url,
      });
    }
  });

  // the person who asked hears back; the failed steps run again as them (they show in their runs)
  const asker = view.websiteRequest?.status === "OPEN" ? await authUser(view.websiteRequest.byId) : null;
  if (asker && asker.id !== user.id) {
    await notifyUsers(prisma, [asker.id], user.id, {
      type: "SYSTEM_ALERT",
      severity: "INFO",
      title: `${nameOf(user)} updated the website of the client`,
      body: `New website: ${url}. The failed steps are running again.`,
      link: `/clients/${clientId}`,
      referenceId: clientId,
      referenceType: "CLIENT",
    });
  }
  const runAs = asker ?? user;
  const rerun: string[] = [];
  for (const key of NEEDS_WEBSITE) {
    const last = await prisma.stepRun.findFirst({
      where: { clientId, parentRunId: null, step: { key } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (!last || last.status === "DONE" || last.status === "QUEUED" || last.status === "RUNNING") continue;
    try {
      await startRun(runAs, { stepKey: key, clientId });
      rerun.push(key);
    } catch (e) {
      loggers.warn(`Re-run of ${key} after the website change was not started: ${(e as Error).message}`);
    }
  }
  return { website: url, rerun };
};

/** every website change of a client, newest first */
export const websiteHistory = async (clientId: string) => {
  const rows = await prisma.clientActivity.findMany({
    where: { clientId, meta: { path: ["field"], equals: "website" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, createdAt: true, meta: true, actor: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((r) => {
    const w = ((r.meta ?? {}) as { website?: { old: string | null; new: string | null; via: WebsiteVia; runId: string | null } }).website;
    return { id: r.id, at: r.createdAt, by: r.actor, old: w?.old ?? null, new: w?.new ?? null, via: w?.via ?? "edit", runId: w?.runId ?? null };
  });
};


/** per client of a list page: a website request waiting for an admin, or the last website change (14 days) */
export const websiteStates = async (clientIds: string[]) => {
  if (!clientIds.length) return new Map<string, { waiting?: { since: string; by: string }; changed?: { at: Date; by: string | null } }>();
  const [open, changes] = await Promise.all([
    prisma.stepRun.findMany({
      where: { clientId: { in: clientIds }, step: { key: WEBSITE_STEP }, viewData: { path: ["websiteRequest", "status"], equals: "OPEN" } },
      select: { clientId: true, viewData: true },
    }),
    prisma.clientActivity.findMany({
      where: { clientId: { in: clientIds }, meta: { path: ["field"], equals: "website" }, createdAt: { gt: new Date(Date.now() - 14 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      distinct: ["clientId"],
      select: { clientId: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const out = new Map<string, { waiting?: { since: string; by: string }; changed?: { at: Date; by: string | null } }>();
  for (const r of open) {
    const req = ((r.viewData ?? {}) as View).websiteRequest;
    if (req) out.set(r.clientId, { waiting: { since: req.at, by: req.byName } });
  }
  for (const c of changes) {
    out.set(c.clientId, { ...out.get(c.clientId), changed: { at: c.createdAt, by: c.actor ? nameOf(c.actor) : null } });
  }
  return out;
};
