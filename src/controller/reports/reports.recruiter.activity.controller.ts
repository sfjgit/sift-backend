// File: reports.recruiter.activity.controller.ts
// Path: src/controller/reports/reports.recruiter.activity.controller.ts
//
// GET /reports/recruiters/activity
//
// TRUE ACTIVITY LOG — counts stage ENTRIES from CandidatePipelineStageLog
// within the date window. If a candidate moved L1 → L2 → L3 today, that is
// 3 transitions: L1 +1, L2 +1, L3 +1.
//
// New flow (same as every other report):
//   - scope   = org tree (you + everyone under you); team picker only narrows
//   - buckets = stage flags only: Placed / Pipeline / Dropped / Sourced / Active
//   - joining = LWD, else today + noticePeriodDays (resolveJoining)

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  personName,
  resolveRequirementScope,
  toArr,
} from "./reports.requirements.shared";
import { resolveJoining, JOINING_SOURCE_LABELS } from "./reports.joining";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW
// ─────────────────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

interface DateWindow {
  gte?: Date;
  lte?: Date;
}

function resolveDateWindow(q: Record<string, string | undefined>): DateWindow {
  const now = new Date();
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    if (!Number.isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3600000), lte: now };
  }
  switch (q.range) {
    case "today":
      return { gte: startOfDay(now), lte: now };
    case "yesterday": {
      const y = addDays(now, -1);
      return { gte: startOfDay(y), lte: endOfDay(y) };
    }
    case "last7":
      return { gte: startOfDay(addDays(now, -6)), lte: now };
    case "last30":
      return { gte: startOfDay(addDays(now, -29)), lte: now };
    case "thisMonth":
      return { gte: startOfMonth(now), lte: now };
    default:
      break;
  }
  const w: DateWindow = {};
  if (q.fromDate)
    w.gte = isDateOnly(q.fromDate)
      ? startOfDay(new Date(q.fromDate))
      : new Date(q.fromDate);
  if (q.toDate)
    w.lte = isDateOnly(q.toDate)
      ? endOfDay(new Date(q.toDate))
      : new Date(q.toDate);
  return w;
}

function windowLabel(q: Record<string, string | undefined>): string {
  if (q.hours) return `last-${q.hours}h`;
  if (q.range) return q.range;
  if (q.fromDate || q.toDate)
    return `${q.fromDate ?? "start"}_to_${q.toDate ?? "now"}`;
  return "all-time";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE — org tree, same as the Requirements / Recruiters tabs
// null = unrestricted (super admin, no team picked)
// ─────────────────────────────────────────────────────────────────────────────

async function activityUserIds(
  req: Request,
  q: Record<string, string>
): Promise<string[] | null> {
  const scope = await resolveRequirementScope(req, q);
  return scope.teamUserIds ?? scope.treeUserIds;
}

function parseIds(raw?: string): string[] | null {
  const arr = toArr(raw);
  return arr.length ? arr : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUCKETS — stage flags only
// ─────────────────────────────────────────────────────────────────────────────

type StageFlags = {
  isTerminal: boolean;
  isNearTerminal: boolean;
  pipeline: boolean;
  isSourced: boolean;
};

const BUCKET_LABELS = {
  placed: "Placed",
  pipeline: "Pipeline",
  dropped: "Dropped",
  sourced: "Sourced",
  active: "Active",
} as const;

const bucketOf = (s: StageFlags) =>
  s.isTerminal
    ? BUCKET_LABELS.placed
    : s.isNearTerminal
    ? BUCKET_LABELS.pipeline
    : !s.pipeline
    ? BUCKET_LABELS.dropped
    : s.isSourced
    ? BUCKET_LABELS.sourced
    : BUCKET_LABELS.active;

// ─────────────────────────────────────────────────────────────────────────────
// RAW SQL AGGREGATE — exact counts, no cap
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityCountRow {
  recruiterId: string;
  toStageId: string;
  count: number;
}

async function fetchActivityCounts(
  win: DateWindow,
  userIds: string[] | null,
  q: Record<string, string>
): Promise<ActivityCountRow[]> {
  const conditions: Prisma.Sql[] = [Prisma.sql`r."deletedAt" IS NULL`];

  if (win.gte) conditions.push(Prisma.sql`l."createdAt" >= ${win.gte}`);
  if (win.lte) conditions.push(Prisma.sql`l."createdAt" <= ${win.lte}`);

  if (userIds !== null) {
    if (userIds.length === 0) return [];
    conditions.push(Prisma.sql`p."recruiterId" IN (${Prisma.join(userIds)})`);
  }

  const inList = (col: string, vals: string[]) =>
    Prisma.sql`${Prisma.raw(col)} IN (${Prisma.join(vals)})`;
  const clients = toArr(q.clientId);
  const spocs = toArr(q.clientSpocId);
  const lines = toArr(q.serviceLineId);
  const bus = toArr(q.businessUnitId);
  const statuses = toArr(q.status);
  const reqIds = toArr(q.requirementId);
  if (clients.length) conditions.push(inList(`r."clientId"`, clients));
  if (spocs.length) conditions.push(inList(`r."clientSpocId"`, spocs));
  if (lines.length) conditions.push(inList(`r."serviceLineId"`, lines));
  if (bus.length) conditions.push(inList(`r."businessUnitId"`, bus));
  if (statuses.length)
    conditions.push(Prisma.sql`r."status"::text IN (${Prisma.join(statuses)})`);
  if (reqIds.length) conditions.push(inList(`r."id"`, reqIds));

  const where = Prisma.join(conditions, " AND ");

  return prisma.$queryRaw<ActivityCountRow[]>(Prisma.sql`
    SELECT
      p."recruiterId"  AS "recruiterId",
      l."toStageId"    AS "toStageId",
      COUNT(*)::int    AS "count"
    FROM "CandidatePipelineStageLog" l
    JOIN "RequirementCandidatePipeline" p ON p."id" = l."pipelineId"
    JOIN "Requirement" r ON r."id" = p."requirementId"
    WHERE ${where}
      AND (l."fromStageId" IS NULL OR l."fromStageId" <> l."toStageId")
    GROUP BY p."recruiterId", l."toStageId"
  `);
}

/** Requirement filter for Prisma queries (multi-value) */
function reqWhereOf(q: Record<string, string>): Prisma.RequirementWhereInput {
  const where: Prisma.RequirementWhereInput = { deletedAt: null };
  const clients = toArr(q.clientId);
  const spocs = toArr(q.clientSpocId);
  const lines = toArr(q.serviceLineId);
  const bus = toArr(q.businessUnitId);
  const statuses = toArr(q.status);
  if (clients.length) where.clientId = { in: clients };
  if (spocs.length) where.clientSpocId = { in: spocs };
  if (lines.length) where.serviceLineId = { in: lines };
  if (bus.length) where.businessUnitId = { in: bus };
  if (statuses.length) where.status = { in: statuses as any };
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterActivity = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const standardOnly = q.standardOnly === "true";
    const win = resolveDateWindow(q);
    const effectiveIds = await activityUserIds(req, q);

    const counts = await fetchActivityCounts(win, effectiveIds, q);

    if (!counts.length) {
      return res.json({
        success: true,
        groups: [],
        meta: {
          window: windowLabel(q),
          standardOnly,
          total: 0,
          totalTransitions: 0,
          multiLine: false,
          capped: false,
        },
      });
    }

    const recruiterIds = [...new Set(counts.map((c) => c.recruiterId))];
    const stageIds = [...new Set(counts.map((c) => c.toStageId))];

    const [recruiters, stages] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: recruiterIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          servicelineId: true,
          serviceline: { select: { id: true, name: true } },
        },
      }),
      prisma.pipelineStage.findMany({
        where: { id: { in: stageIds } },
        select: {
          id: true,
          code: true,
          label: true,
          order: true,
          isStandard: true,
          isTerminal: true,
          isNearTerminal: true,
          isSourced: true,
          pipeline: true,
          serviceLineId: true,
          serviceLine: { select: { id: true, name: true } },
        },
        orderBy: { order: "asc" },
      }),
    ]);

    const recruiterById = new Map(recruiters.map((r) => [r.id, r]));
    const activeStages = standardOnly
      ? stages.filter((s) => s.isStandard)
      : stages;
    const stageById = new Map(activeStages.map((s) => [s.id, s]));

    type RecRow = {
      recruiterId: string;
      name: string;
      email: string;
      serviceLine: { id: string; name: string } | null;
      totalTransitions: number;
      terminalCount: number;
      nearTerminalCount: number;
      offPipelineCount: number;
      sourcedCount: number;
      activeCount: number;
      stageCounts: Record<string, number>;
    };

    const rowMap = new Map<string, RecRow>();

    for (const c of counts) {
      const stage = stageById.get(c.toStageId);
      if (!stage) continue;
      const rec = recruiterById.get(c.recruiterId);
      if (!rec) continue;

      if (!rowMap.has(c.recruiterId)) {
        rowMap.set(c.recruiterId, {
          recruiterId: c.recruiterId,
          name: personName(rec),
          email: rec.email,
          serviceLine: rec.serviceline ?? null,
          totalTransitions: 0,
          terminalCount: 0,
          nearTerminalCount: 0,
          offPipelineCount: 0,
          sourcedCount: 0,
          activeCount: 0,
          stageCounts: {},
        });
      }

      const row = rowMap.get(c.recruiterId)!;
      row.stageCounts[c.toStageId] =
        (row.stageCounts[c.toStageId] ?? 0) + c.count;
      row.totalTransitions += c.count;

      if (stage.isTerminal) row.terminalCount += c.count;
      else if (stage.isNearTerminal) row.nearTerminalCount += c.count;
      else if (!stage.pipeline) row.offPipelineCount += c.count;
      else if (stage.isSourced) row.sourcedCount += c.count;
      else row.activeCount += c.count;
    }

    const allRows = [...rowMap.values()];

    const byLine = new Map<string, RecRow[]>();
    const lineMeta = new Map<string, { id: string; name: string } | null>();
    for (const row of allRows) {
      const key = row.serviceLine?.id ?? "__none__";
      if (!byLine.has(key)) {
        byLine.set(key, []);
        lineMeta.set(key, row.serviceLine);
      }
      byLine.get(key)!.push(row);
    }

    const groups = [...byLine.entries()]
      .map(([key, rows]) => {
        const sl = lineMeta.get(key) ?? null;
        const grandStageCounts: Record<string, number> = {};
        for (const row of rows)
          for (const [sid, n] of Object.entries(row.stageCounts))
            grandStageCounts[sid] = (grandStageCounts[sid] ?? 0) + n;

        const groupStages = activeStages
          .filter((s) => (grandStageCounts[s.id] ?? 0) > 0)
          .map((s) => ({
            id: s.id,
            code: s.code,
            label: s.label,
            order: s.order,
            isStandard: s.isStandard,
            isTerminal: s.isTerminal,
            isNearTerminal: s.isNearTerminal,
            isSourced: s.isSourced,
            pipeline: s.pipeline,
            serviceLineId: s.serviceLineId,
            serviceLine: s.serviceLine,
            grandCount: grandStageCounts[s.id] ?? 0,
          }));

        return {
          serviceLine: sl,
          stages: groupStages,
          data: rows.sort((a, b) => b.totalTransitions - a.totalTransitions),
          total: rows.length,
          totalTransitions: rows.reduce((s, r) => s + r.totalTransitions, 0),
        };
      })
      .sort((a, b) => b.totalTransitions - a.totalTransitions);

    return res.json({
      success: true,
      groups,
      meta: {
        window: windowLabel(q),
        standardOnly,
        total: allRows.length,
        totalTransitions: allRows.reduce((s, r) => s + r.totalTransitions, 0),
        multiLine: groups.length > 1,
        capped: false,
      },
    });
  } catch (err) {
    console.error("getRecruiterActivity:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter activity" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity/drill — one row = one real transition
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterActivityDrill = async (
  req: Request,
  res: Response
) => {
  try {
    const q = req.query as Record<string, string>;
    const { recruiterId, stageId } = q;

    if (!recruiterId)
      return res
        .status(400)
        .json({ success: false, message: "recruiterId is required" });

    const scope = await resolveRequirementScope(req, q);
    if (scope.treeUserIds !== null && !scope.treeUserIds.includes(recruiterId))
      return res
        .status(403)
        .json({ success: false, message: "Recruiter not in your scope" });

    const win = resolveDateWindow(q);
    const logWhere: Prisma.CandidatePipelineStageLogWhereInput = {
      pipeline: { recruiterId, requirement: reqWhereOf(q) },
    };
    if (win.gte || win.lte)
      logWhere.createdAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
    if (stageId) logWhere.toStageId = stageId;

    const logRows = await prisma.candidatePipelineStageLog.findMany({
      where: logWhere,
      select: {
        id: true,
        createdAt: true,
        timeInPrevStageMins: true,
        note: true,
        wasSkipped: true,
        fromStageId: true,
        fromStage: { select: { id: true, label: true, order: true } },
        toStageId: true,
        toStage: {
          select: {
            id: true,
            label: true,
            order: true,
            isTerminal: true,
            isNearTerminal: true,
            isSourced: true,
            pipeline: true,
          },
        },
        changedBy: { select: { id: true, firstName: true, lastName: true } },
        pipeline: {
          select: {
            id: true,
            recruiterId: true,
            recruiter: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            snapshot: { select: { fullName: true, email: true, phone: true } },
            requirement: {
              select: {
                id: true,
                reqCode: true,
                title: true,
                client: { select: { id: true, name: true } },
                serviceLine: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 3000,
    });

    // Real stage moves only (skip transfers / notes logged as same → same)
    const moves = logRows.filter((l) => l.fromStageId !== l.toStageId);

    if (!moves.length) {
      return res.json({
        success: true,
        data: {
          recruiter: null,
          rows: [],
          stageSummary: {},
          total: 0,
          capped: false,
        },
        meta: { window: windowLabel(q) },
      });
    }

    const stageSummary: Record<string, number> = {};
    for (const log of moves)
      stageSummary[log.toStage.label] =
        (stageSummary[log.toStage.label] ?? 0) + 1;

    const firstRec = moves[0].pipeline.recruiter;

    return res.json({
      success: true,
      data: {
        recruiter: {
          id: firstRec.id,
          name: personName(firstRec),
          email: firstRec.email,
        },
        rows: moves.map((log) => ({
          logId: log.id,
          createdAt: log.createdAt,
          timeInPrevStageMins: log.timeInPrevStageMins ?? null,
          wasSkipped: log.wasSkipped,
          note: log.note ?? null,
          fromStage: log.fromStage
            ? {
                id: log.fromStageId!,
                label: log.fromStage.label,
                order: log.fromStage.order,
              }
            : null,
          toStage: {
            id: log.toStageId,
            label: log.toStage.label,
            order: log.toStage.order,
            isTerminal: log.toStage.isTerminal,
            isNearTerminal: log.toStage.isNearTerminal,
            isSourced: log.toStage.isSourced,
            pipeline: log.toStage.pipeline,
            bucket: bucketOf(log.toStage),
          },
          movedBy: log.changedBy ? personName(log.changedBy) : "—",
          candidate: {
            name: log.pipeline.snapshot?.fullName ?? "—",
            email: log.pipeline.snapshot?.email ?? "",
            phone: log.pipeline.snapshot?.phone ?? "",
          },
          requirement: {
            id: log.pipeline.requirement.id,
            reqCode: log.pipeline.requirement.reqCode,
            title: log.pipeline.requirement.title,
          },
          client: log.pipeline.requirement.client ?? null,
          serviceLine: log.pipeline.requirement.serviceLine ?? null,
        })),
        stageSummary,
        total: moves.length,
        capped: logRows.length >= 3000,
      },
      meta: { window: windowLabel(q) },
    });
  } catch (err) {
    console.error("getRecruiterActivityDrill:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch activity drill" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOG COLUMN REGISTRY — opt-out via ?hiddenActivityCols=key1,key2
// ─────────────────────────────────────────────────────────────────────────────

const ALL_ACTIVITY_COLS = [
  { key: "when", header: "Transition Date", width: 18, group: "transition" },
  {
    key: "prevHrs",
    header: "Time in Prev Stage (hrs)",
    width: 20,
    group: "transition",
  },
  { key: "fromStage", header: "From Stage", width: 22, group: "transition" },
  { key: "toStage", header: "To Stage", width: 22, group: "transition" },
  { key: "bucket", header: "Status", width: 14, group: "transition" },
  { key: "wasSkipped", header: "Skipped?", width: 10, group: "transition" },
  { key: "movedBy", header: "Moved By", width: 22, group: "transition" },
  { key: "note", header: "Note", width: 30, group: "transition" },
  { key: "recruiter", header: "Recruiter", width: 24, group: "recruiter" },
  { key: "recEmail", header: "Recruiter Email", width: 28, group: "recruiter" },
  { key: "candidate", header: "Candidate", width: 26, group: "candidate" },
  {
    key: "candEmail",
    header: "Candidate Email",
    width: 28,
    group: "candidate",
  },
  {
    key: "candPhone",
    header: "Candidate Phone",
    width: 16,
    group: "candidate",
  },
  {
    key: "currentTitle",
    header: "Current Title",
    width: 24,
    group: "candidate",
  },
  {
    key: "currentCompany",
    header: "Current Company",
    width: 22,
    group: "candidate",
  },
  { key: "expYears", header: "Exp (yrs)", width: 10, group: "candidate" },
  { key: "topSkills", header: "Top Skills", width: 34, group: "candidate" },
  { key: "reqCode", header: "Req Code", width: 14, group: "requirement" },
  { key: "reqTitle", header: "Requirement", width: 34, group: "requirement" },
  { key: "client", header: "Client", width: 22, group: "requirement" },
  { key: "spoc", header: "Client SPOC", width: 22, group: "requirement" },
  { key: "sl", header: "Service Line", width: 18, group: "requirement" },
  { key: "bu", header: "Business Unit", width: 20, group: "requirement" },
  { key: "currentCtc", header: "Current CTC", width: 14, group: "ctc" },
  { key: "expectedCtc", header: "Expected CTC", width: 14, group: "ctc" },
  { key: "negotiatedCtc", header: "Negotiated CTC", width: 14, group: "ctc" },
  { key: "offeredCtc", header: "Offered CTC", width: 14, group: "ctc" },
  { key: "offerStatus", header: "Offer Status", width: 14, group: "ctc" },
  // ── Joining — LWD, else today + notice period days ──
  { key: "noticePeriod", header: "Notice (days)", width: 14, group: "joining" },
  { key: "lwd", header: "Last Working Day", width: 16, group: "joining" },
  {
    key: "derivedJoining",
    header: "Joining Date",
    width: 16,
    group: "joining",
  },
  {
    key: "monthOfJoining",
    header: "Month of Joining",
    width: 16,
    group: "joining",
  },
  { key: "daysToJoin", header: "Days to Join", width: 14, group: "joining" },
  { key: "joiningSource", header: "Joining From", width: 18, group: "joining" },
] as const;

type ActivityColKey = (typeof ALL_ACTIVITY_COLS)[number]["key"];

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity/export/columns
// ─────────────────────────────────────────────────────────────────────────────

export const getActivityExportColumns = async (
  _req: Request,
  res: Response
) => {
  const groups: Record<string, { key: string; header: string }[]> = {};
  for (const c of ALL_ACTIVITY_COLS) {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push({ key: c.key, header: c.header });
  }
  return res.json({
    success: true,
    data: {
      columns: ALL_ACTIVITY_COLS.map((c) => ({
        key: c.key,
        header: c.header,
        group: c.group,
      })),
      groups,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity/export
// Sheet 1 Activity Summary · Sheet 2 Activity Log · Sheet 3 Stage Totals
// ─────────────────────────────────────────────────────────────────────────────

export const exportRecruiterActivity = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const win = resolveDateWindow(q);
    const standardOnly = q.standardOnly === "true";

    let effectiveIds = await activityUserIds(req, q);
    const selectedIds = parseIds(q.ids);
    if (selectedIds)
      effectiveIds =
        effectiveIds === null
          ? selectedIds
          : selectedIds.filter((id) => effectiveIds!.includes(id));

    const counts = await fetchActivityCounts(win, effectiveIds, q);
    const recruiterIds = [...new Set(counts.map((c) => c.recruiterId))];
    const stageIds = [...new Set(counts.map((c) => c.toStageId))];

    const [recruiters, stages] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: recruiterIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      prisma.pipelineStage.findMany({
        where: { id: { in: stageIds } },
        select: {
          id: true,
          label: true,
          order: true,
          isStandard: true,
          isTerminal: true,
          isNearTerminal: true,
          isSourced: true,
          pipeline: true,
        },
        orderBy: { order: "asc" },
      }),
    ]);

    const activeStages = standardOnly
      ? stages.filter((s) => s.isStandard)
      : stages;
    const activeStageIdSet = new Set(activeStages.map((s) => s.id));
    const recById = new Map(recruiters.map((r) => [r.id, r]));

    const byRec = new Map<
      string,
      {
        name: string;
        email: string;
        total: number;
        stageCounts: Record<string, number>;
      }
    >();
    const grandStageCounts: Record<string, number> = {};

    for (const c of counts) {
      if (!activeStageIdSet.has(c.toStageId)) continue;
      const rec = recById.get(c.recruiterId);
      if (!rec) continue;
      if (!byRec.has(c.recruiterId))
        byRec.set(c.recruiterId, {
          name: personName(rec),
          email: rec.email,
          total: 0,
          stageCounts: {},
        });
      const r = byRec.get(c.recruiterId)!;
      r.stageCounts[c.toStageId] = (r.stageCounts[c.toStageId] ?? 0) + c.count;
      r.total += c.count;
      grandStageCounts[c.toStageId] =
        (grandStageCounts[c.toStageId] ?? 0) + c.count;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    const mkFill = (argb: string): ExcelJS.Fill => ({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb },
    });
    const styleHdr = (row: ExcelJS.Row, fill = mkFill("FF1E3A5F")) => {
      row.eachCell((c) => {
        c.fill = fill;
        c.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 };
        c.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
      });
      row.height = 28;
    };

    // ── Sheet 1: Summary ─────────────────────────────────────────────────
    const s1 = workbook.addWorksheet("Activity Summary", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
    });
    s1.columns = [
      { header: "Recruiter", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Total Transitions", key: "total", width: 16 },
      ...activeStages.map((s) => ({
        header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
        key: `st_${s.id}`,
        width: Math.max(s.label.length + 6, 14),
      })),
    ];
    styleHdr(s1.getRow(1));

    const sortedRecs = [...byRec.values()].sort((a, b) => b.total - a.total);
    for (const r of sortedRecs) {
      const dyn: Record<string, number> = {};
      for (const s of activeStages)
        dyn[`st_${s.id}`] = r.stageCounts[s.id] ?? 0;
      const row = s1.addRow({
        name: r.name,
        email: r.email,
        total: r.total,
        ...dyn,
      });
      row.height = 18;
      for (const s of activeStages) {
        if ((r.stageCounts[s.id] ?? 0) === 0) continue;
        const cell = row.getCell(`st_${s.id}`);
        if (s.isTerminal) cell.fill = mkFill("FFE2EFDA");
        else if (s.isNearTerminal) cell.fill = mkFill("FFFFF3CD");
        else if (!s.pipeline) cell.fill = mkFill("FFFCE4D6");
      }
    }

    const totalsDyn: Record<string, number> = {};
    for (const s of activeStages)
      totalsDyn[`st_${s.id}`] = grandStageCounts[s.id] ?? 0;
    const totalsRow = s1.addRow({
      name: "TOTAL",
      email: "",
      total: sortedRecs.reduce((sum, r) => sum + r.total, 0),
      ...totalsDyn,
    });
    totalsRow.eachCell((c) => {
      c.font = { bold: true };
      c.fill = mkFill("FFF0F4FF");
      c.border = { top: { style: "medium", color: { argb: "FF4F46E5" } } };
    });
    s1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s1.columnCount },
    };

    // ── Sheet 2: Detailed log ────────────────────────────────────────────
    const logWhere: Prisma.CandidatePipelineStageLogWhereInput = {
      pipeline: {
        ...(effectiveIds !== null ? { recruiterId: { in: effectiveIds } } : {}),
        requirement: reqWhereOf(q),
      },
    };
    if (win.gte || win.lte)
      logWhere.createdAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };

    const logRowsAll = await prisma.candidatePipelineStageLog.findMany({
      where: logWhere,
      select: {
        id: true,
        createdAt: true,
        timeInPrevStageMins: true,
        wasSkipped: true,
        note: true,
        fromStageId: true,
        toStageId: true,
        fromStage: { select: { label: true } },
        toStage: {
          select: {
            label: true,
            isTerminal: true,
            isNearTerminal: true,
            pipeline: true,
            isSourced: true,
          },
        },
        changedBy: { select: { firstName: true, lastName: true } },
        pipeline: {
          select: {
            recruiter: {
              select: { firstName: true, lastName: true, email: true },
            },
            snapshot: {
              select: {
                fullName: true,
                email: true,
                phone: true,
                currentTitle: true,
                currentCompany: true,
                totalExpYears: true,
                topSkills: true,
              },
            },
            currentCtc: true,
            expectedCtc: true,
            negotiatedCtc: true,
            offeredCtc: true,
            offerStatus: true,
            noticePeriodDays: true,
            lastWorkingDate: true,
            requirement: {
              select: {
                reqCode: true,
                title: true,
                client: { select: { name: true } },
                clientSpoc: { select: { firstName: true, lastName: true } },
                serviceLine: { select: { name: true } },
                businessUnit: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50000,
    });
    const logRows = logRowsAll.filter((l) => l.fromStageId !== l.toStageId);

    const hiddenActivityCols = new Set(
      (parseIds(q.hiddenActivityCols) ?? []) as ActivityColKey[]
    );
    const activeCols = ALL_ACTIVITY_COLS.filter(
      (c) => !hiddenActivityCols.has(c.key)
    );
    const has = (k: ActivityColKey) => !hiddenActivityCols.has(k);

    const s2 = workbook.addWorksheet("Activity Log", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    s2.columns = activeCols.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));
    styleHdr(s2.getRow(1));

    const now = new Date();

    for (const log of logRows) {
      const t = log.toStage;
      const p = log.pipeline;
      const rq = p.requirement;
      const snap = p.snapshot;
      const j = resolveJoining(p, now);

      const all: Record<ActivityColKey, unknown> = {
        when: new Date(log.createdAt),
        prevHrs:
          log.timeInPrevStageMins != null
            ? +(log.timeInPrevStageMins / 60).toFixed(1)
            : "",
        fromStage: log.fromStage?.label ?? "— (entry)",
        toStage: t.label,
        bucket: bucketOf(t),
        wasSkipped: log.wasSkipped ? "Yes" : "No",
        movedBy: log.changedBy ? personName(log.changedBy) : "—",
        note: log.note ?? "",
        recruiter: personName(p.recruiter),
        recEmail: p.recruiter.email,
        candidate: snap?.fullName ?? "—",
        candEmail: snap?.email ?? "",
        candPhone: snap?.phone ?? "",
        currentTitle: snap?.currentTitle ?? "",
        currentCompany: snap?.currentCompany ?? "",
        expYears: snap?.totalExpYears ?? "",
        topSkills: (snap?.topSkills ?? []).join(", "),
        reqCode: rq?.reqCode ?? "",
        reqTitle: rq?.title ?? "",
        client: rq?.client?.name ?? "",
        spoc: personName(rq?.clientSpoc),
        sl: rq?.serviceLine?.name ?? "",
        bu: rq?.businessUnit?.name ?? "",
        currentCtc: p.currentCtc ?? "",
        expectedCtc: p.expectedCtc ?? "",
        negotiatedCtc: p.negotiatedCtc ?? "",
        offeredCtc: p.offeredCtc ?? "",
        offerStatus: p.offerStatus ?? "",
        noticePeriod: j.noticeDays ?? "",
        lwd: p.lastWorkingDate ? new Date(p.lastWorkingDate) : "",
        derivedJoining: j.date ?? "",
        monthOfJoining: j.mojLabel ?? "",
        daysToJoin: j.daysToJoin ?? "",
        joiningSource: j.source ? JOINING_SOURCE_LABELS[j.source] : "",
      };

      const row = s2.addRow(
        Object.fromEntries(activeCols.map((c) => [c.key, all[c.key]]))
      );
      row.height = 18;

      if (has("when")) row.getCell("when").numFmt = "dd-mmm-yyyy hh:mm";
      if (has("lwd")) row.getCell("lwd").numFmt = "dd-mmm-yyyy";
      if (has("derivedJoining"))
        row.getCell("derivedJoining").numFmt = "dd-mmm-yyyy";

      if (t.isTerminal) {
        if (has("toStage")) row.getCell("toStage").fill = mkFill("FFE2EFDA");
        if (has("bucket")) row.getCell("bucket").fill = mkFill("FFE2EFDA");
        if (has("monthOfJoining") && j.mojLabel) {
          row.getCell("monthOfJoining").fill = mkFill("FFE2EFDA");
          row.getCell("monthOfJoining").font = {
            bold: true,
            color: { argb: "FF1A5C2A" },
          };
        }
      } else if (t.isNearTerminal) {
        if (has("toStage")) row.getCell("toStage").fill = mkFill("FFFFF3CD");
        if (has("bucket")) row.getCell("bucket").fill = mkFill("FFFFF3CD");
      } else if (!t.pipeline) {
        if (has("bucket")) row.getCell("bucket").fill = mkFill("FFFCE4D6");
      }
    }

    s2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s2.columnCount },
    };

    // ── Sheet 3: Stage totals ────────────────────────────────────────────
    const s3 = workbook.addWorksheet("Stage Totals");
    s3.columns = [
      { header: "Stage", key: "stage", width: 28 },
      { header: "Status", key: "bucket", width: 16 },
      { header: "Transitions in Window", key: "count", width: 22 },
    ];
    styleHdr(s3.getRow(1));
    for (const s of activeStages)
      s3.addRow({
        stage: s.label,
        bucket: bucketOf(s),
        count: grandStageCounts[s.id] ?? 0,
      });
    const s3Total = s3.addRow({
      stage: "TOTAL",
      bucket: "",
      count: Object.values(grandStageCounts).reduce((a, b) => a + b, 0),
    });
    s3Total.eachCell((c) => {
      c.font = { bold: true };
      c.fill = mkFill("FFF0F4FF");
    });

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-activity-${windowLabel(
        q
      )}-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRecruiterActivity:", err);
    if (!res.headersSent)
      return res
        .status(500)
        .json({
          success: false,
          message: "Failed to export recruiter activity",
        });
  }
};
