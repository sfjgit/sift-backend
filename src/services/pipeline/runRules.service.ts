// File: runRules.service.ts
// Path: src/services/pipeline/runRules.service.ts
//
// Two checks before a step is started (alone or inside "Run all steps"):
//
// 1. Run slots — RunQuota rules: at most N started runs per day / week / month
//    (Asia/Kolkata). Per step, or all steps together (top-level runs only).
//    Most specific rule wins per step + period: user > role > everyone.
//    Runs that failed or found nothing use no slot. Super admin and
//    step_runs.unlimited have no slots.
//
// 2. Already done — a step that finished for the client is not run again within
//    PipelineStep.rerunAfterDays unless its input changed since. Client-level
//    steps (reports, figures, SPOCs from reports) look at anyone's run, so two
//    people on one client don't redo the same work; SPOC steps look at the
//    requester's own run, since each person works their own SPOCs.
//    Super admin and step_runs.rerun may run it again anyway.

import { QuotaPeriod, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError } from "@/utils/httpError";
import { getUserPermissionMap } from "@/services/permission.service";
import { spocWhereForUserId } from "@/services/scope.service";

export type RuleUser = { id: string; roleId: string; isSuperAdmin: boolean };
type StepRef = { id: string; key: string; label: string; rerunAfterDays: number | null };

const COUNTED = ["QUEUED", "RUNNING", "DONE"] as const;

// ── periods (IST has no DST: a fixed +5:30) ──────────────────────────────────

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export const periodStart = (period: QuotaPeriod, now = new Date()): Date => {
  const ist = new Date(now.getTime() + IST_MS);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  let start = day;
  if (period === "WEEK") start = day - ((ist.getUTCDay() + 6) % 7) * DAY_MS; // Monday
  if (period === "MONTH") start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);
  return new Date(start - IST_MS);
};

export const periodEnd = (period: QuotaPeriod, now = new Date()): Date => {
  const start = periodStart(period, now);
  if (period === "DAY") return new Date(start.getTime() + DAY_MS);
  if (period === "WEEK") return new Date(start.getTime() + 7 * DAY_MS);
  const ist = new Date(start.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - IST_MS);
};

const PERIOD_WORD: Record<QuotaPeriod, string> = { DAY: "today", WEEK: "this week", MONTH: "this month" };

const fmtWhen = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// ── run slots ────────────────────────────────────────────────────────────────

export type Slot = {
  ruleId: string;
  stepId: string | null; // null = all steps together
  stepLabel: string | null;
  appliesTo: "USER" | "ROLE" | "EVERYONE";
  period: QuotaPeriod;
  max: number;
  used: number;
  left: number;
  resetsAt: Date;
};

const specificity = (q: { userId: string | null; roleId: string | null }) => (q.userId ? 2 : q.roleId ? 1 : 0);

export const hasNoSlots = async (user: RuleUser) =>
  user.isSuperAdmin || !!(await getUserPermissionMap(user))["step_runs.unlimited"];

// the rules that bind this user: per step + period, the most specific one
const rulesFor = async (user: RuleUser) => {
  const rows = await prisma.runQuota.findMany({
    where: {
      isActive: true,
      OR: [{ userId: user.id }, { roleId: user.roleId, userId: null }, { roleId: null, userId: null }],
    },
    select: { id: true, stepId: true, userId: true, roleId: true, period: true, maxRuns: true,
      step: { select: { label: true } } },
  });
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.stepId ?? "*"}:${r.period}`;
    const cur = best.get(k);
    if (!cur || specificity(r) > specificity(cur) || (specificity(r) === specificity(cur) && r.maxRuns < cur.maxRuns)) {
      best.set(k, r);
    }
  }
  return [...best.values()];
};

/** Every slot rule that binds the user (stepId given: only that step's + the all-steps ones). */
export const slotsFor = async (user: RuleUser, stepId?: string): Promise<Slot[]> => {
  if (await hasNoSlots(user)) return [];
  const rules = (await rulesFor(user)).filter((r) => !stepId || r.stepId === null || r.stepId === stepId);
  const now = new Date();
  return Promise.all(
    rules.map(async (r) => {
      const used = await prisma.stepRun.count({
        where: {
          requestedById: user.id,
          status: { in: [...COUNTED] },
          createdAt: { gte: periodStart(r.period, now) },
          // all-steps rules count what the user started (a "Run all" is one run)
          ...(r.stepId ? { stepId: r.stepId } : { parentRunId: null }),
        },
      });
      return {
        ruleId: r.id,
        stepId: r.stepId,
        stepLabel: r.step?.label ?? null,
        appliesTo: r.userId ? "USER" : r.roleId ? "ROLE" : "EVERYONE",
        period: r.period,
        max: r.maxRuns,
        used,
        left: Math.max(0, r.maxRuns - used),
        resetsAt: periodEnd(r.period, now),
      } satisfies Slot;
    }),
  );
};

/** Why the user can't start this run now, or null. topLevel = started by the user (not a "Run all" child). */
export const slotBlock = async (user: RuleUser, step: StepRef, topLevel: boolean): Promise<string | null> => {
  const slots = (await slotsFor(user, step.id)).filter((s) => s.stepId === step.id || topLevel);
  const full = slots.find((s) => s.left <= 0);
  if (!full) return null;
  const what = full.stepId ? `"${full.stepLabel}"` : "pipeline";
  if (full.max === 0) return `${full.stepId ? `"${full.stepLabel}" runs are` : "Pipeline runs are"} switched off for you (0 run slots)`;
  return `All ${full.max} ${what} run slot${full.max === 1 ? "" : "s"} ${PERIOD_WORD[full.period]} are used. Next slot from ${fmtWhen(full.resetsAt)}`;
};

export const assertSlots = async (user: RuleUser, step: StepRef) => {
  const block = await slotBlock(user, step, true);
  if (block) throw ApiError(429, block, "RUN_SLOTS_USED");
};

// ── already done ─────────────────────────────────────────────────────────────

const CLIENT_LEVEL = new Set(["reports", "report_spocs", "figures"]);

export type DoneInfo = {
  runId: string;
  at: Date;
  by: string;
  byMe: boolean;
  note: string | null;
  until: Date; // re-run allowed from then
};

export type RerunBlock = DoneInfo & { message: string };

const lastDone = async (step: StepRef, clientId: string, userId: string) =>
  prisma.stepRun.findFirst({
    where: {
      stepId: step.id,
      clientId,
      status: "DONE",
      ...(CLIENT_LEVEL.has(step.key) ? {} : { requestedById: userId }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, finishedAt: true, note: true, requestedById: true,
      requestedBy: { select: { firstName: true, lastName: true } } },
  });

// did anything the step works on arrive after `since`?
const newInputSince = async (stepKey: string, clientId: string, userId: string, since: Date) => {
  const after = { gt: since };
  switch (stepKey) {
    case "report_spocs":
    case "figures":
      return (await prisma.clientDocument.count({ where: { clientId, createdAt: after } })) > 0;
    case "enrich":
    case "apollo":
    case "validate": {
      const mine = await spocWhereForUserId(userId);
      const or: Prisma.ClientSpocWhereInput[] = [{ createdAt: after }];
      if (stepKey === "validate") or.push({ validatedAt: null });
      return (await prisma.clientSpoc.count({ where: { clientId, isActive: true, ...mine, OR: or } })) > 0;
    }
    case "emails": {
      const mine = await spocWhereForUserId(userId);
      return (
        (await prisma.clientSpoc.count({
          where: { clientId, isActive: true, approvalStatus: "APPROVED", ...mine,
            OR: [{ approvedAt: after }, { outreachPacks: { none: {} } }] },
        })) > 0
      );
    }
    default:
      return false;
  }
};

/** Latest finished run of the step that counts for this user + client (null = never). */
export const doneInfo = async (step: StepRef, clientId: string, userId: string): Promise<DoneInfo | null> => {
  const last = await lastDone(step, clientId, userId);
  if (!last) return null;
  const at = last.finishedAt ?? last.createdAt;
  return {
    runId: last.id,
    at,
    by: `${last.requestedBy.firstName} ${last.requestedBy.lastName}`.trim(),
    byMe: last.requestedById === userId,
    note: last.note,
    until: new Date(at.getTime() + (step.rerunAfterDays ?? 0) * DAY_MS),
  };
};

/** Why this step should not run again for the client yet, or null. */
export const rerunBlock = async (step: StepRef, clientId: string, userId: string): Promise<RerunBlock | null> => {
  if (!step.rerunAfterDays) return null;
  const done = await doneInfo(step, clientId, userId);
  if (!done || done.until <= new Date()) return null;
  if (await newInputSince(step.key, clientId, userId, done.at)) return null;
  const who = done.byMe ? "you" : done.by;
  return {
    ...done,
    message: `Already done by ${who} on ${fmtWhen(done.at)}${done.note ? ` (${done.note})` : ""}. Nothing new to work on since — it can run again from ${fmtWhen(done.until)}`,
  };
};

export const canForceRerun = async (user: RuleUser) =>
  user.isSuperAdmin || !!(await getUserPermissionMap(user))["step_runs.rerun"];
