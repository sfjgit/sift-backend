// File: ingest.service.ts
// Path: src/services/pipeline/ingest.service.ts
//
// Saves an engine's results into CRM tables under CRM rules (contract §6):
// fill blanks, never overwrite a different value (→ viewData.conflicts),
// never touch locked financials, always a new outreach pack. Each row is its
// own small transaction, so one bad row never loses the rest.

import { EmailStatus, Prisma, StepRunStatus, ValidationBand } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { loggers } from "@/utils/logger";
import { logClientActivity } from "@/services/clientActivity.service";
import { notifyUsers, usersWithPermission } from "@/services/notification.service";
import { raiseAlert } from "@/services/alert.service";
import { spocWhereForUserId } from "@/services/scope.service";
import { resultNote } from "./resultNote";
import { toNameKey } from "@/utils/names";
import { ResultKind, stepDef } from "@/config/pipeline";
import type { ResultsBody, ResultSpoc } from "@/validators/svc.validators";
import { isTerminal, moveRun, recordEvent } from "./run.service";

// claim marker: one delivery saves at a time; a second one waits for the retry
const SAVING = "Saving results…";
const CLAIM_TTL_MS = 5 * 60_000;

type Ctx = {
  runId: string;
  clientId: string;
  clientName: string;
  requestedById: string;
  businessUnitId: string | null;
  serviceLineId: string | null;
  canCreateSpocs: boolean;
  mine: Prisma.ClientSpocWhereInput; // SPOCs the requester may see
  lookups: Map<string, Map<string, string>>; // type → code/label (lowercased) → id
  conflicts: Record<string, unknown>[];
  skipped: Record<string, unknown>[];
};

const loadLookups = async () => {
  const rows = await prisma.lookup.findMany({
    where: { type: { in: ["SPOC_SOURCE", "EMAIL_SOURCE", "DOCUMENT_TYPE", "PROGRAM_SECTOR"] }, isActive: true },
    select: { id: true, type: true, code: true, label: true },
  });
  const map = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const m = map.get(r.type) ?? new Map<string, string>();
    m.set(r.code.toLowerCase(), r.id);
    m.set(r.label.toLowerCase(), r.id);
    map.set(r.type, m);
  }
  return map;
};

const lookupId = (ctx: Ctx, type: string, v?: string | null) =>
  v ? (ctx.lookups.get(type)?.get(v.trim().toLowerCase()) ?? null) : null;

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const same = (a: unknown, b: unknown) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const nameOf = (s: { firstName: string; lastName?: string | null | undefined }) => `${s.firstName} ${s.lastName ?? ""}`.trim();

// ── SPOCs ────────────────────────────────────────────────────────────────────

const CONTACT_FIELDS = [
  "lastName",
  "designation",
  "department",
  "email",
  "phone",
  "linkedinUrl",
  "seniority",
  "totalExpYears",
  "currentOrgExpYears",
] as const;

type SpocOutcome = "created" | "updated" | "unchanged" | "skipped";

const saveSpoc = async (ctx: Ctx, s: ResultSpoc): Promise<SpocOutcome> => {
  const email = s.email?.trim().toLowerCase() || null;
  const nameKey = toNameKey(s.firstName, s.lastName);
  const label = nameOf(s);

  // match: CRM id → email (global) → (client, name)
  let existing =
    (s.id && (await prisma.clientSpoc.findFirst({ where: { id: s.id, clientId: ctx.clientId } }))) || null;
  if (!existing && email) {
    const byEmail = await prisma.clientSpoc.findUnique({ where: { email } });
    if (byEmail && byEmail.clientId !== ctx.clientId) {
      ctx.skipped.push({ kind: "spocs", name: label, email, reason: "Email belongs to a SPOC of another client" });
      return "skipped";
    }
    existing = byEmail;
  }
  existing ??= await prisma.clientSpoc.findFirst({
    where: { clientId: ctx.clientId, nameKey, isActive: true },
  });

  // someone else's SPOC stays theirs: not changed by this run, not shown to the runner
  if (existing && !(await prisma.clientSpoc.count({ where: { id: existing.id, ...ctx.mine } }))) {
    const handler = await prisma.user.findUnique({
      where: { id: existing.handlerId },
      select: { firstName: true, lastName: true },
    });
    ctx.skipped.push({
      kind: "spocs",
      name: label,
      reason: `Already a SPOC of ${handler ? `${handler.firstName} ${handler.lastName}`.trim() : "another person"}`,
      handledByOther: true,
    });
    return "skipped";
  }

  const incoming: Record<(typeof CONTACT_FIELDS)[number], unknown> = {
    lastName: s.lastName,
    designation: s.designation,
    department: s.department,
    email,
    phone: s.phone,
    linkedinUrl: s.linkedinUrl,
    seniority: s.seniority,
    totalExpYears: s.totalExpYears,
    currentOrgExpYears: s.currentOrgExpYears,
  };

  const validation: Prisma.ClientSpocUpdateInput = s.validation
    ? {
        ...(s.validation.score !== undefined && { validationScore: s.validation.score }),
        ...(s.validation.band && { validationBand: s.validation.band as ValidationBand }),
        ...(s.validation.emailStatus && { emailStatus: s.validation.emailStatus as EmailStatus }),
        ...(s.validation.checks && { validationChecks: s.validation.checks as Prisma.InputJsonObject }),
        validatedAt: new Date(),
      }
    : {};
  const review: Prisma.ClientSpocUpdateInput =
    s.reviewFlag === undefined ? {} : { reviewFlag: s.reviewFlag, reviewReason: s.reviewReason ?? null };

  if (existing) {
    const fill: Record<string, unknown> = {};
    for (const f of CONTACT_FIELDS) {
      const v = incoming[f];
      if (blank(v)) continue;
      const cur = (existing as Record<string, unknown>)[f];
      if (blank(cur)) fill[f] = v;
      else if (!same(cur, v)) {
        ctx.conflicts.push({ spocId: existing.id, name: label, field: f, current: String(cur), proposed: v,
          source: s.fieldSources?.[f] ?? null });
      }
    }
    // the unique email may already be someone else's
    if (fill.email && (await prisma.clientSpoc.count({ where: { email: fill.email as string } }))) {
      ctx.conflicts.push({ spocId: existing.id, name: label, field: "email", proposed: fill.email,
        reason: "Email already used by another SPOC" });
      delete fill.email;
    }
    const emailSourceId = fill.email ? lookupId(ctx, "EMAIL_SOURCE", s.emailSource) : null;
    const filled = Object.keys(fill);
    const sources = filled.length && s.fieldSources
      ? { ...((existing.fieldSources as Record<string, unknown>) ?? {}),
          ...Object.fromEntries(filled.filter((f) => s.fieldSources![f]).map((f) => [f, s.fieldSources![f]])) }
      : undefined;

    const data: Prisma.ClientSpocUpdateInput = {
      ...fill,
      ...(emailSourceId && { emailSource: { connect: { id: emailSourceId } } }),
      ...(sources && { fieldSources: sources as Prisma.InputJsonObject }),
      ...validation,
      ...review,
    };
    if (!Object.keys(data).length) return "unchanged";

    await prisma.$transaction(async (tx) => {
      await tx.clientSpoc.update({ where: { id: existing!.id }, data });
      const what = [...filled, ...(s.validation ? ["score"] : [])];
      if (what.length) {
        await logClientActivity(tx, {
          clientId: ctx.clientId,
          spocId: existing!.id,
          actorId: null,
          type: "SPOC_UPDATED",
          summary: `Pipeline updated ${label}: ${what.join(", ")}`,
          meta: { runId: ctx.runId },
        });
      }
    });
    return filled.length || s.validation ? "updated" : "unchanged";
  }

  if (!ctx.canCreateSpocs) {
    ctx.skipped.push({ kind: "spocs", name: label, reason: "This step does not add new SPOCs" });
    return "skipped";
  }
  if (!ctx.businessUnitId || !ctx.serviceLineId) {
    ctx.skipped.push({ kind: "spocs", name: label, reason: "Run has no business unit / service line" });
    return "skipped";
  }

  const sourceId = lookupId(ctx, "SPOC_SOURCE", s.source);
  const emailSourceId = email ? lookupId(ctx, "EMAIL_SOURCE", s.emailSource) : null;
  await prisma.$transaction(async (tx) => {
    const created = await tx.clientSpoc.create({
      data: {
        clientId: ctx.clientId,
        firstName: s.firstName,
        lastName: s.lastName ?? null,
        nameKey,
        email,
        phone: s.phone ?? null,
        designation: s.designation ?? null,
        department: s.department ?? null,
        linkedinUrl: s.linkedinUrl ?? null,
        seniority: s.seniority ?? null,
        totalExpYears: s.totalExpYears ?? null,
        currentOrgExpYears: s.currentOrgExpYears ?? null,
        handlerId: ctx.requestedById,
        businessUnitId: ctx.businessUnitId!,
        serviceLineId: ctx.serviceLineId!,
        sourceId,
        emailSourceId,
        ...(s.fieldSources && { fieldSources: s.fieldSources as Prisma.InputJsonObject }),
        ...(validation as object),
        ...(review as object),
        ...(s.sourceUrl && { notes: `Evidence: ${s.sourceUrl}` }),
        approvalStatus: "PENDING",
        sourceRunId: ctx.runId,
        addedById: ctx.requestedById,
        assignments: { create: { assignedToId: ctx.requestedById, assignedById: ctx.requestedById, reason: "Found by the pipeline" } },
      } as Prisma.ClientSpocUncheckedCreateInput,
      select: { id: true },
    });
    await logClientActivity(tx, {
      clientId: ctx.clientId,
      spocId: created.id,
      actorId: null,
      type: "SPOC_ADDED",
      summary: `Pipeline found ${label}${s.designation ? ` (${s.designation})` : ""}`,
      meta: { runId: ctx.runId, source: s.source ?? null },
    });
  });
  return "created";
};

// ── per kind ─────────────────────────────────────────────────────────────────

const saveFinancials = async (ctx: Ctx, rows: NonNullable<ResultsBody["data"]>["financials"], flagged: unknown[]) => {
  let saved = 0;
  let locked = 0;
  for (const f of rows ?? []) {
    if (f.flagged) {
      flagged.push(f);
      continue;
    }
    const cur = await prisma.clientFinancial.findUnique({ where: { clientId_fy: { clientId: ctx.clientId, fy: f.fy } } });
    if (cur?.isLocked) {
      locked++;
      ctx.skipped.push({ kind: "financials", fy: f.fy, reason: "Figures are locked by a person" });
      continue;
    }
    const values = {
      ...(f.obligationRs !== undefined && { obligationRs: f.obligationRs }),
      ...(f.budgetRs !== undefined && { budgetRs: f.budgetRs }),
      ...(f.spentRs !== undefined && { spentRs: f.spentRs }),
      ...(f.unspentRs !== undefined && { unspentRs: f.unspentRs }),
      evidence: f.evidence ?? null,
      confidence: f.confidence === undefined || f.confidence === null ? null : Math.min(1, Math.max(0, f.confidence)),
      sourceRunId: ctx.runId,
    };
    await prisma.clientFinancial.upsert({
      where: { clientId_fy: { clientId: ctx.clientId, fy: f.fy } },
      create: { clientId: ctx.clientId, fy: f.fy, ...values },
      update: values,
    });
    saved++;
  }
  if (saved) {
    await logClientActivity(prisma, {
      clientId: ctx.clientId,
      actorId: null,
      type: "FINANCIALS_UPDATED",
      summary: `Pipeline saved CSR figures for ${saved} year(s)`,
      meta: { runId: ctx.runId },
    });
  }
  return { saved, locked, flagged: flagged.length };
};

const savePrograms = async (ctx: Ctx, rows: NonNullable<ResultsBody["data"]>["programs"]) => {
  let saved = 0;
  for (const p of rows ?? []) {
    const values = {
      sectorId: lookupId(ctx, "PROGRAM_SECTOR", p.sector),
      budgetRs: p.budgetRs ?? null,
      locations: p.locations ?? null,
      beneficiaries: p.beneficiaries ?? null,
      implementor: p.implementor ?? null,
      sourceUrl: p.sourceUrl ?? null,
      sourceRunId: ctx.runId,
    };
    await prisma.clientProgram.upsert({
      where: { clientId_fy_name: { clientId: ctx.clientId, fy: p.fy, name: p.name } },
      create: { clientId: ctx.clientId, fy: p.fy, name: p.name, ...values },
      update: values,
    });
    saved++;
  }
  if (saved) {
    await logClientActivity(prisma, {
      clientId: ctx.clientId,
      actorId: null,
      type: "PROGRAMS_ADDED",
      summary: `Pipeline saved ${saved} CSR program(s)`,
      meta: { runId: ctx.runId },
    });
  }
  return { saved };
};

const saveDocuments = async (ctx: Ctx, rows: NonNullable<ResultsBody["data"]>["documents"]) => {
  let saved = 0;
  for (const d of rows ?? []) {
    const typeId = lookupId(ctx, "DOCUMENT_TYPE", d.type);
    if (!typeId) {
      ctx.skipped.push({ kind: "documents", type: d.type, fy: d.fy, reason: "Unknown document type" });
      continue;
    }
    const values = {
      fileKey: d.fileKey,
      fileName: d.fileName ?? null,
      sourceUrl: d.sourceUrl ?? null,
      sha256: d.sha256 ?? null,
      sourceRunId: ctx.runId,
    };
    await prisma.clientDocument.upsert({
      where: { clientId_typeId_fy: { clientId: ctx.clientId, typeId, fy: d.fy } },
      create: { clientId: ctx.clientId, typeId, fy: d.fy, ...values },
      update: values,
    });
    saved++;
  }
  if (saved) {
    await logClientActivity(prisma, {
      clientId: ctx.clientId,
      actorId: null,
      type: "DOCUMENT_ADDED",
      summary: `Pipeline saved ${saved} report(s)`,
      meta: { runId: ctx.runId },
    });
  }
  return { saved };
};

const saveOutreach = async (ctx: Ctx, rows: NonNullable<ResultsBody["data"]>["outreach"]) => {
  let packs = 0;
  for (const o of rows ?? []) {
    const spoc = await prisma.clientSpoc.findFirst({
      where: { id: o.spocId, clientId: ctx.clientId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!spoc) {
      ctx.skipped.push({ kind: "outreach", spocId: o.spocId, reason: "SPOC is not on this client" });
      continue;
    }
    // a retried delivery must not add the same pack twice
    if (await prisma.outreachPack.count({ where: { spocId: spoc.id, sourceRunId: ctx.runId } })) continue;
    await prisma.$transaction(async (tx) => {
      await tx.outreachPack.create({
        data: {
          clientId: ctx.clientId,
          spocId: spoc.id,
          fileKey: o.fileKey ?? null,
          model: o.model ?? null,
          sourceRunId: ctx.runId,
          messages: { create: o.messages.map((m) => ({ sequenceNo: m.sequenceNo, subject: m.subject, body: m.body })) },
        },
      });
      await logClientActivity(tx, {
        clientId: ctx.clientId,
        spocId: spoc.id,
        actorId: null,
        type: "OUTREACH_GENERATED",
        summary: `Outreach emails written for ${nameOf(spoc)} (${o.messages.length} mails)`,
        meta: { runId: ctx.runId },
      });
    });
    packs++;
  }
  return { packs };
};

// ── entry point ──────────────────────────────────────────────────────────────

export type IngestResult = { duplicate: boolean; busy?: boolean; status?: StepRunStatus };

export const applyResults = async (runId: string, body: ResultsBody, via: string): Promise<IngestResult> => {
  const run = await prisma.stepRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      clientId: true,
      requestedById: true,
      options: true,
      client: { select: { name: true } },
      step: { select: { key: true, label: true } },
    },
  });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (isTerminal(run.status)) return { duplicate: true, status: run.status };

  // claim: only one delivery saves; note = SAVING marks it
  const claimed = await prisma.stepRun.updateMany({
    where: {
      id: runId,
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [
        { note: null },
        { note: { not: SAVING } },
        // a save that died midway (process restart) frees its claim after a while
        { lastCallbackAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } },
      ],
    },
    data: { note: SAVING, lastCallbackAt: new Date() },
  });
  if (!claimed.count) return { duplicate: false, busy: true };

  const def = stepDef(run.step.key);
  const allowed = new Set<ResultKind>(def?.writes ?? []);
  const opts = (run.options ?? {}) as Record<string, any>;
  const ctx: Ctx = {
    runId,
    clientId: run.clientId,
    clientName: run.client.name,
    requestedById: run.requestedById,
    businessUnitId: opts.businessUnitId ?? null,
    serviceLineId: opts.serviceLineId ?? null,
    canCreateSpocs: !!def?.createsSpocs,
    mine: await spocWhereForUserId(run.requestedById),
    lookups: await loadLookups(),
    conflicts: [],
    skipped: [],
  };
  const data = body.data ?? {};
  const summary: Record<string, unknown> = {};
  const flaggedFigures: unknown[] = [];

  try {
    for (const kind of Object.keys(data) as ResultKind[]) {
      const rows = (data as Record<string, unknown[] | undefined>)[kind];
      if (rows?.length && !allowed.has(kind)) {
        ctx.skipped.push({ kind, count: rows.length, reason: `"${run.step.label}" may not write ${kind}` });
      }
    }

    if (allowed.has("spocs") && data.spocs?.length) {
      const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
      for (const s of data.spocs) {
        try {
          counts[await saveSpoc(ctx, s)]++;
        } catch (e) {
          counts.skipped++;
          ctx.skipped.push({ kind: "spocs", name: nameOf(s), reason: (e as Error).message.slice(0, 300) });
        }
      }
      summary.spocs = counts;
      if (counts.created) {
        // the requester and everyone who can approve; one notification each
        const approvers = await usersWithPermission("spocs.approve");
        await notifyUsers(prisma, [run.requestedById, ...approvers.map((u) => u.id)], null, {
          type: "SPOC_APPROVAL_NEEDED",
          severity: "WARNING",
          title: `${counts.created} new SPOC(s) waiting for approval`,
          body: `${run.client.name} — approve them before outreach`,
          link: "/approvals",
          referenceId: runId,
          referenceType: "STEP_RUN",
        });
      }
    }
    if (allowed.has("financials") && data.financials?.length) {
      summary.financials = await saveFinancials(ctx, data.financials, flaggedFigures);
    }
    if (allowed.has("programs") && data.programs?.length) summary.programs = await savePrograms(ctx, data.programs);
    if (allowed.has("documents") && data.documents?.length) summary.documents = await saveDocuments(ctx, data.documents);
    if (allowed.has("outreach") && data.outreach?.length) summary.outreach = await saveOutreach(ctx, data.outreach);
  } catch (e) {
    // release the claim so the engine's retry (or the reconciler) can try again
    await prisma.stepRun.update({ where: { id: runId }, data: { note: "Saving failed — will retry" } });
    loggers.error(`Step run ${runId}: saving results failed`, e);
    await raiseAlert({
      key: `ingest-failed:${runId}`,
      severity: "ERROR",
      source: "pipeline",
      title: `Saving the results of ${run.step.label} failed`,
      body: `${run.client.name}: ${String((e as Error)?.message ?? e).slice(0, 400)}`,
      link: `/clients/${run.clientId}?tab=pipeline&run=${runId}`,
      meta: { runId },
    });
    throw e;
  }

  summary.engine = body.summary ?? {};
  const viewData = {
    conflicts: ctx.conflicts,
    skipped: ctx.skipped,
    flaggedFigures,
    ...(body.viewData && { engine: body.viewData }),
  };

  const counted = ["DONE", "EMPTY", "FAILED", "STOPPED"] as const;
  const status: StepRunStatus = counted.includes(body.status) ? body.status : "DONE";
  const err = status === "FAILED" ? body.error : undefined;
  // EMPTY may carry why (e.g. "No reports for this client yet") and what to do next
  const why = status === "EMPTY" ? body.error : undefined;

  await moveRun(runId, status, {
    progress: 100,
    note:
      status === "DONE" ? (resultNote(run.step.key, summary) ?? "Finished")
      : status === "EMPTY" ? (why?.message ?? "Nothing new found")
      : status === "STOPPED" ? "Stopped"
      : "Failed",
    ...(why?.howToContinue && { howToContinue: why.howToContinue }),
    resultSummary: summary as Prisma.InputJsonObject,
    viewData: viewData as Prisma.InputJsonObject,
    ...(body.costUsd !== undefined && body.costUsd !== null && { costUsd: body.costUsd }),
    ...(body.credits && { credits: body.credits as Prisma.InputJsonObject }),
    ...(err && {
      errorCode: err.code ?? "ENGINE_ERROR",
      errorMessage: err.message ?? "The pipeline step failed",
      howToContinue: err.howToContinue ?? null,
    }),
    lastCallbackAt: new Date(),
  }, `Results received (${via}): ${status}`, { summary, engine: body.summary });

  if (ctx.conflicts.length) {
    await recordEvent(prisma, runId, `${ctx.conflicts.length} value(s) differ from CRM data — kept the CRM value`);
  }
  return { duplicate: false, status };
};
