// File: reports.controller.ts
// Path: src/controller/reports.controller.ts

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// DATE / TIME WINDOW RESOLVER
// Precedence:  hours  →  named range  →  explicit fromDate/toDate
//   ?hours=8            last 8 hours (also 12 / 24 / any custom int)
//   ?range=today        start-of-today  → now
//   ?range=yesterday    full previous day (00:00 → 23:59:59.999)
//   ?range=last7        last 7 days (incl. today)
//   ?range=last30       last 30 days
//   ?range=thisMonth    1st of month → now
//   ?fromDate&?toDate    explicit; a date-only toDate auto-extends to end of day
// Returns a Prisma range object { gte?, lte? } or {} for no filter.
// NOTE: uses server local time. If server runs UTC, treat inputs accordingly.
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
// true when the string carries no time component (e.g. "2026-07-22")
function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

interface DateWindow {
  gte?: Date;
  lte?: Date;
}

function resolveDateWindow(q: Record<string, string | undefined>): DateWindow {
  const now = new Date();

  // 1. rolling hour window
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    if (!Number.isNaN(h) && h > 0) {
      return { gte: new Date(now.getTime() - h * 60 * 60 * 1000), lte: now };
    }
  }

  // 2. named presets
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

  // 3. explicit from/to
  const w: DateWindow = {};
  if (q.fromDate) {
    w.gte = isDateOnly(q.fromDate)
      ? startOfDay(new Date(q.fromDate))
      : new Date(q.fromDate);
  }
  if (q.toDate) {
    w.lte = isDateOnly(q.toDate)
      ? endOfDay(new Date(q.toDate))
      : new Date(q.toDate);
  }
  return w;
}

// human label for the window — printed into the export filename + sheet meta
function windowLabel(q: Record<string, string | undefined>): string {
  if (q.hours) return `last-${q.hours}h`;
  if (q.range) return q.range;
  if (q.fromDate || q.toDate) {
    return `${q.fromDate ?? "start"}_to_${q.toDate ?? "now"}`;
  }
  return "all-time";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE: BFS downward from userId — self + all reportees recursively
// SuperAdmin → null (no filter, entire org). Everyone else → self + subtree.
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOrgTreeDown(
  userId: string,
  isSuperAdmin: boolean
): Promise<string[] | null> {
  if (isSuperAdmin) return null;

  const visited = new Set<string>([userId]);
  let frontier = [userId];

  while (frontier.length > 0) {
    const children = await prisma.user.findMany({
      where: {
        reportingToId: { in: frontier },
        isActive: true,
        id: { notIn: [...visited] },
      },
      select: { id: true },
    });
    frontier = [];
    for (const c of children) {
      if (!visited.has(c.id)) {
        visited.add(c.id);
        frontier.push(c.id);
      }
    }
  }
  return [...visited];
}

async function resolveScopedUserIds(req: Request): Promise<string[] | null> {
  return resolveOrgTreeDown(req.user!.id, req.user!.isSuperAdmin);
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT WHERE builder — folds in the resolved date window on createdAt
// ─────────────────────────────────────────────────────────────────────────────

function buildReqWhere(
  q: Record<string, string | undefined>
): Record<string, any> {
  const where: Record<string, any> = { deletedAt: null };
  if (q.clientId) where.clientId = q.clientId;
  if (q.serviceLineId) where.serviceLineId = q.serviceLineId;
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;

  const win = resolveDateWindow(q);
  if (win.gte || win.lte) {
    where.createdAt = {};
    if (win.gte) where.createdAt.gte = win.gte;
    if (win.lte) where.createdAt.lte = win.lte;
  }
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGES — real PipelineStage rows, scoped by service line.
// serviceLineId === null  → common (all lines)
// serviceLineId === <id>  → variant, only that line
// When a serviceLineId filter is present we merge common + that line's stages.
// Otherwise every active stage is returned.
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_SELECT = {
  id: true,
  code: true,
  label: true,
  order: true,
  isStandard: true,
  isTerminal: true,
  canonicalStage: true,
  serviceLineId: true,
  serviceLine: { select: { id: true, name: true } },
} as const;

async function fetchScopedStages(serviceLineId?: string) {
  const where: Record<string, any> = { isActive: true };
  if (serviceLineId) {
    where.OR = [{ serviceLineId: null }, { serviceLineId }];
  }
  return prisma.pipelineStage.findMany({
    where,
    orderBy: { order: "asc" },
    select: STAGE_SELECT,
  });
}

type StageMeta = Awaited<ReturnType<typeof fetchScopedStages>>[number];

function stageMetaOut(stages: StageMeta[], standardOnly: boolean) {
  const list = standardOnly ? stages.filter((s) => s.isStandard) : stages;
  return list.map((s) => ({
    id: s.id,
    code: s.code,
    label: s.label,
    order: s.order,
    isStandard: s.isStandard,
    isTerminal: s.isTerminal,
    canonicalStage: s.canonicalStage ?? null,
    serviceLineId: s.serviceLineId ?? null,
    serviceLine: s.serviceLine ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPOSITION HELPERS  (business enums, not display config)
// ─────────────────────────────────────────────────────────────────────────────

function isJoined(p: any): boolean {
  return p.disposition === "PLACED" || !!p.actualJoiningDate;
}
function isDropped(p: any): boolean {
  return p.disposition === "DROPPED" || p.isRejected || p.isWithdrawn;
}
function isActive(p: any): boolean {
  return p.disposition === "ACTIVE";
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: formatAging
// ─────────────────────────────────────────────────────────────────────────────

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL styling
// ─────────────────────────────────────────────────────────────────────────────

const HDR_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};
const HDR_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FFFFFFFF" },
  bold: true,
  size: 11,
};
const SUB_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2D5986" },
};

function styleHdr(row: ExcelJS.Row, fill = HDR_FILL) {
  row.eachCell((c) => {
    c.fill = fill;
    c.font = HDR_FONT;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: "FF4A90D9" } } };
  });
  row.height = 28;
}

function humanKey(key: string) {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function spocName(spoc: any): string {
  if (!spoc) return "";
  return `${spoc.firstName ?? ""} ${spoc.lastName ?? ""}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT for candidate detail sheet (used in all exports)
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_DETAIL_SELECT = {
  id: true,
  requirementId: true,
  recruiterId: true,
  currentStageId: true,
  disposition: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  salaryCurrency: true,
  salaryType: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  lastWorkingDate: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  monthOfJoining: true,
  remainingDaysToJoin: true,
  stageUpdatedAt: true,
  createdAt: true,
  noticePeriod: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      canonicalStage: true,
    },
  },
  stageHistory: { select: { timeInPrevStageMins: true } },
  recruiter: {
    select: { id: true, firstName: true, lastName: true, email: true },
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
} as const;

// Requirement fields resolved for the candidate sheet lookup.
// Client / SPOC / Service Line / BU are the important new additions.
const REQ_LOOKUP_SELECT = {
  id: true,
  reqCode: true,
  title: true,
  status: true,
  createdAt: true,
  deletedAt: true,
  client: { select: { id: true, name: true } },
  clientSpoc: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      designation: true,
    },
  },
  serviceLine: { select: { id: true, name: true } },
  businessUnit: { select: { id: true, name: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SHEET 2 (always): candidate detail — now with client / spoc / SL / BU
// ─────────────────────────────────────────────────────────────────────────────

function buildCandidateSheet(
  workbook: ExcelJS.Workbook,
  pipelines: any[],
  reqLookup: Record<string, any>
) {
  const sheet = workbook.addWorksheet("Candidates", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Req Code", key: "reqCode", width: 14 },
    { header: "Requirement", key: "reqTitle", width: 34 },
    // client context — the important new block
    { header: "Client", key: "client", width: 24 },
    { header: "Client SPOC", key: "spoc", width: 22 },
    { header: "SPOC Email", key: "spocEmail", width: 26 },
    { header: "SPOC Designation", key: "spocDesig", width: 20 },
    { header: "Service Line", key: "serviceLine", width: 18 },
    { header: "Business Unit", key: "bu", width: 20 },
    // candidate
    { header: "Candidate Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Current Title", key: "title", width: 24 },
    { header: "Current Company", key: "company", width: 22 },
    { header: "Exp (yrs)", key: "exp", width: 10 },
    { header: "Top Skills", key: "skills", width: 34 },
    { header: "Recruiter", key: "recruiter", width: 22 },
    { header: "Current Stage", key: "stage", width: 24 },
    { header: "Status", key: "disposition", width: 14 },
    { header: "Added On", key: "addedOn", width: 16 },
    { header: "Days in Pipeline", key: "pipelineDays", width: 16 },
    { header: "Stage Aging", key: "aging", width: 12 },
    { header: "Submitted At", key: "submittedAt", width: 18 },
    { header: "Offer Status", key: "offerStatus", width: 14 },
    // CTC breakdown
    { header: "Current CTC", key: "currentCtc", width: 14 },
    { header: "Expected CTC", key: "expectedCtc", width: 14 },
    { header: "Negotiated CTC", key: "negotiatedCtc", width: 14 },
    { header: "Offered CTC", key: "offeredCtc", width: 14 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Salary Type", key: "salaryType", width: 12 },
    // Joining
    { header: "Notice Period", key: "noticePeriod", width: 14 },
    { header: "Last Working Day", key: "lwd", width: 16 },
    { header: "Expected Joining", key: "expectedJoining", width: 16 },
    { header: "Actual Joining", key: "actualJoining", width: 16 },
    { header: "Month of Joining", key: "monthOfJoining", width: 16 },
    { header: "Days to Join", key: "daysToJoin", width: 14 },
    { header: "Rejected?", key: "rejected", width: 10 },
    { header: "Withdrawn?", key: "withdrawn", width: 10 },
    { header: "On Hold?", key: "onHold", width: 10 },
    // requirement audit
    { header: "Req Created", key: "reqCreated", width: 16 },
    { header: "Req Deleted", key: "reqDeleted", width: 16 },
  ];

  styleHdr(sheet.getRow(1));

  const now = Date.now();
  for (const p of pipelines) {
    const req = reqLookup[p.requirementId];
    const stageAgeMins = Math.floor(
      (now - new Date(p.stageUpdatedAt).getTime()) / 60000
    );
    const totalMins =
      (p.stageHistory ?? []).reduce(
        (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
        0
      ) + stageAgeMins;

    const row = sheet.addRow({
      reqCode: req?.reqCode ?? "",
      reqTitle: req?.title ?? "",
      client: req?.client?.name ?? "",
      spoc: spocName(req?.clientSpoc),
      spocEmail: req?.clientSpoc?.email ?? "",
      spocDesig: req?.clientSpoc?.designation ?? "",
      serviceLine: req?.serviceLine?.name ?? "",
      bu: req?.businessUnit?.name ?? "",
      name: p.snapshot?.fullName ?? "",
      email: p.snapshot?.email ?? "",
      phone: p.snapshot?.phone ?? "",
      title: p.snapshot?.currentTitle ?? "",
      company: p.snapshot?.currentCompany ?? "",
      exp: p.snapshot?.totalExpYears ?? "",
      skills: (p.snapshot?.topSkills ?? []).join(", "),
      recruiter: p.recruiter
        ? `${p.recruiter.firstName} ${p.recruiter.lastName}`
        : "",
      stage: p.currentStage?.label ?? "",
      disposition: p.disposition,
      addedOn: new Date(p.createdAt),
      pipelineDays: Math.floor(totalMins / 1440),
      aging: formatAging(stageAgeMins),
      submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
      offerStatus: p.offerStatus ?? "",
      currentCtc: p.currentCtc ?? "",
      expectedCtc: p.expectedCtc ?? "",
      negotiatedCtc: p.negotiatedCtc ?? "",
      offeredCtc: p.offeredCtc ?? "",
      currency: p.salaryCurrency ?? "",
      salaryType: p.salaryType ?? "",
      noticePeriod: p.noticePeriod ?? "",
      lwd: p.lastWorkingDate ? new Date(p.lastWorkingDate) : "",
      expectedJoining: p.expectedJoiningDate
        ? new Date(p.expectedJoiningDate)
        : "",
      actualJoining: p.actualJoiningDate ? new Date(p.actualJoiningDate) : "",
      monthOfJoining: p.monthOfJoining ?? "",
      daysToJoin: p.remainingDaysToJoin ?? "",
      rejected: p.isRejected ? "Yes" : "No",
      withdrawn: p.isWithdrawn ? "Yes" : "No",
      onHold: p.isOnHold ? "Yes" : "No",
      reqCreated: req?.createdAt ? new Date(req.createdAt) : "",
      reqDeleted: req?.deletedAt ? new Date(req.deletedAt) : "",
    });

    row.height = 18;
    row.getCell("addedOn").numFmt = "dd-mmm-yyyy";
    if (p.submittedAt) row.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
    if (p.lastWorkingDate) row.getCell("lwd").numFmt = "dd-mmm-yyyy";
    if (p.expectedJoiningDate)
      row.getCell("expectedJoining").numFmt = "dd-mmm-yyyy";
    if (p.actualJoiningDate)
      row.getCell("actualJoining").numFmt = "dd-mmm-yyyy";
    if (req?.createdAt) row.getCell("reqCreated").numFmt = "dd-mmm-yyyy hh:mm";
    if (req?.deletedAt) row.getCell("reqDeleted").numFmt = "dd-mmm-yyyy hh:mm";

    if (p.isRejected || p.isWithdrawn) {
      row.eachCell((c) => {
        c.font = { ...c.font, color: { argb: "FF7A869A" } };
      });
    }
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

// parse ?ids=a,b,c → string[] (deduped, trimmed). Empty → null.
function parseIds(raw?: string): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 0. OVERVIEW  —  monitoring dashboard feed (KPIs, funnel, time-series, leaders)
// GET /reports/overview
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

export const getReportsOverview = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const win = resolveDateWindow(q);
    const scopedUserIds = await resolveScopedUserIds(req);

    const reqWhere = buildReqWhere(q);
    const stages = await fetchScopedStages(q.serviceLineId);

    const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null) {
      pipelineWhere.recruiterId = { in: scopedUserIds };
    }

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: {
        recruiterId: true,
        currentStageId: true,
        disposition: true,
        isRejected: true,
        isWithdrawn: true,
        submittedAt: true,
        actualJoiningDate: true,
        offerStatus: true,
        createdAt: true,
        recruiter: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const total = pipelines.length;
    let submitted = 0;
    let offered = 0;
    let joined = 0;
    let dropped = 0;
    let active = 0;

    const stageCounts: Record<string, number> = Object.fromEntries(
      stages.map((s) => [s.id, 0])
    );
    const dispositionCounts: Record<string, number> = {};
    const recruiterAgg: Record<
      string,
      { id: string; name: string; sourced: number; joined: number }
    > = {};

    // time-series bucketing — hourly if window ≤ 2 days, else daily
    const spanMs =
      win.gte && win.lte ? win.lte.getTime() - win.gte.getTime() : Infinity;
    const bucketByHour = spanMs <= 2 * 24 * 60 * 60 * 1000;
    const series: Record<string, number> = {};
    const bucketKey = (d: Date) => {
      if (bucketByHour) {
        const x = new Date(d);
        x.setMinutes(0, 0, 0);
        return x.toISOString();
      }
      return startOfDay(d).toISOString();
    };

    for (const p of pipelines) {
      if (p.currentStageId in stageCounts) stageCounts[p.currentStageId]++;
      dispositionCounts[p.disposition] =
        (dispositionCounts[p.disposition] ?? 0) + 1;
      if (p.submittedAt) submitted++;
      if (p.offerStatus) offered++;
      if (isJoined(p)) joined++;
      if (isDropped(p)) dropped++;
      if (isActive(p)) active++;

      const k = bucketKey(new Date(p.createdAt));
      series[k] = (series[k] ?? 0) + 1;

      const rid = p.recruiterId;
      if (!recruiterAgg[rid]) {
        recruiterAgg[rid] = {
          id: rid,
          name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
          sourced: 0,
          joined: 0,
        };
      }
      recruiterAgg[rid].sourced++;
      if (isJoined(p)) recruiterAgg[rid].joined++;
    }

    const funnel = stages
      .map((s) => ({
        stageId: s.id,
        code: s.code,
        label: s.label,
        order: s.order,
        isStandard: s.isStandard,
        serviceLine: s.serviceLine ?? null,
        count: stageCounts[s.id] ?? 0,
      }))
      .filter((s) => s.count > 0);

    const timeSeries = Object.entries(series)
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    const leaderboard = Object.values(recruiterAgg)
      .sort((a, b) => b.sourced - a.sourced)
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        kpis: {
          total,
          submitted,
          offered,
          joined,
          dropped,
          active,
          submissionRate:
            total > 0 ? +((submitted / total) * 100).toFixed(1) : 0,
          offerRate:
            submitted > 0 ? +((offered / submitted) * 100).toFixed(1) : 0,
          joinRate: offered > 0 ? +((joined / offered) * 100).toFixed(1) : 0,
        },
        funnel,
        dispositionCounts,
        timeSeries,
        timeGranularity: bucketByHour ? "hour" : "day",
        leaderboard,
      },
      meta: {
        window: windowLabel(q),
        granularity: bucketByHour ? "hour" : "day",
        scope: (req as any).scopeFilter?.type ?? "ALL",
      },
    });
  } catch (err) {
    console.error("getReportsOverview:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch overview" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 1. RECRUITER REPORT  (real service-line stages, per-requirement drill-down)
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/recruiters
export const getRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const { recruiterId, requirementId } = q;
    const standardOnly = q.standardOnly === "true";

    const scopedUserIds = await resolveScopedUserIds(req);

    let recruiterFilter: Record<string, any> = {};
    if (recruiterId) {
      if (scopedUserIds !== null && !scopedUserIds.includes(recruiterId)) {
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      }
      recruiterFilter = { recruiterId };
    } else if (scopedUserIds !== null) {
      recruiterFilter = { recruiterId: { in: scopedUserIds } };
    }

    const reqWhere = buildReqWhere(q);
    if (requirementId) reqWhere.id = requirementId; // within-a-requirement filter

    const stages = await fetchScopedStages(q.serviceLineId);

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirement: reqWhere, ...recruiterFilter },
      select: {
        ...PIPELINE_DETAIL_SELECT,
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            totalOpenings: true,
            client: { select: { id: true, name: true } },
            serviceLine: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
          },
        },
      },
    });

    type ReqStats = {
      requirementId: string;
      reqCode: string;
      title: string;
      status: string;
      totalOpenings: number;
      client: { id: string; name: string } | null;
      serviceLine: { id: string; name: string } | null;
      businessUnit: { id: string; name: string } | null;
      sourced: number;
      submitted: number;
      offered: number;
      joined: number;
      dropped: number;
      active: number;
      stageCounts: Record<string, number>;
    };
    type RecAgg = {
      id: string;
      name: string;
      email: string;
      sourced: number;
      submitted: number;
      offered: number;
      joined: number;
      dropped: number;
      active: number;
      submitTimeMins: number[];
      stageCounts: Record<string, number>;
      reqMap: Record<string, ReqStats>;
    };

    const map: Record<string, RecAgg> = {};

    for (const p of pipelines) {
      const rid = p.recruiterId;
      if (!map[rid]) {
        map[rid] = {
          id: rid,
          name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
          email: p.recruiter.email,
          sourced: 0,
          submitted: 0,
          offered: 0,
          joined: 0,
          dropped: 0,
          active: 0,
          submitTimeMins: [],
          stageCounts: {},
          reqMap: {},
        };
      }
      const r = map[rid];
      r.sourced++;
      r.stageCounts[p.currentStageId] =
        (r.stageCounts[p.currentStageId] ?? 0) + 1;
      if (p.submittedAt) r.submitted++;
      if (p.offerStatus) r.offered++;
      if (isJoined(p)) r.joined++;
      if (isDropped(p)) r.dropped++;
      if (isActive(p)) r.active++;
      if (p.submittedAt) {
        r.submitTimeMins.push(
          (p.stageHistory ?? []).reduce(
            (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
            0
          )
        );
      }

      const rq = (p as any).requirement;
      const reqId = p.requirementId;
      if (!r.reqMap[reqId]) {
        r.reqMap[reqId] = {
          requirementId: reqId,
          reqCode: rq?.reqCode ?? "",
          title: rq?.title ?? "",
          status: rq?.status ?? "",
          totalOpenings: rq?.totalOpenings ?? 0,
          client: rq?.client ?? null,
          serviceLine: rq?.serviceLine ?? null,
          businessUnit: rq?.businessUnit ?? null,
          sourced: 0,
          submitted: 0,
          offered: 0,
          joined: 0,
          dropped: 0,
          active: 0,
          stageCounts: {},
        };
      }
      const rqs = r.reqMap[reqId];
      rqs.sourced++;
      rqs.stageCounts[p.currentStageId] =
        (rqs.stageCounts[p.currentStageId] ?? 0) + 1;
      if (p.submittedAt) rqs.submitted++;
      if (p.offerStatus) rqs.offered++;
      if (isJoined(p)) rqs.joined++;
      if (isDropped(p)) rqs.dropped++;
      if (isActive(p)) rqs.active++;
    }

    const stageOut = stageMetaOut(stages, standardOnly);

    const data = Object.values(map).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      sourced: r.sourced,
      submitted: r.submitted,
      offered: r.offered,
      joined: r.joined,
      dropped: r.dropped,
      active: r.active,
      submissionRate:
        r.sourced > 0 ? +((r.submitted / r.sourced) * 100).toFixed(1) : 0,
      offerRate:
        r.submitted > 0 ? +((r.offered / r.submitted) * 100).toFixed(1) : 0,
      joinRate: r.offered > 0 ? +((r.joined / r.offered) * 100).toFixed(1) : 0,
      avgTimeToSubmitDays:
        r.submitTimeMins.length > 0
          ? +(
              r.submitTimeMins.reduce((a, b) => a + b, 0) /
              r.submitTimeMins.length /
              1440
            ).toFixed(1)
          : null,
      // real-stage counts keyed by stageId
      stageCounts: r.stageCounts,
      requirementBreakdown: Object.values(r.reqMap)
        .sort((a, b) => b.sourced - a.sourced)
        .map((rq) => ({ ...rq })),
    }));

    data.sort((a, b) => b.sourced - a.sourced);

    return res.json({
      success: true,
      data,
      total: data.length,
      meta: {
        stages: stageOut,
        scope: (req as any).scopeFilter?.type ?? "ALL",
        window: windowLabel(q),
        standardOnly,
      },
    });
  } catch (err) {
    console.error("getRecruiterReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter report" });
  }
};

// GET /reports/recruiters/export   ( ?ids=recId1,recId2  → only those recruiters )
export const exportRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const selectedIds = parseIds(q.ids);
    const standardOnly = q.standardOnly === "true";

    const scopedUserIds = await resolveScopedUserIds(req);

    // resolve the recruiter id filter: selected ∩ scope
    let recruiterFilter: Record<string, any> = {};
    let allowedIds: string[] | null = scopedUserIds;
    if (selectedIds) {
      allowedIds =
        scopedUserIds === null
          ? selectedIds
          : selectedIds.filter((id) => scopedUserIds.includes(id));
      recruiterFilter = { recruiterId: { in: allowedIds } };
    } else if (scopedUserIds !== null) {
      recruiterFilter = { recruiterId: { in: scopedUserIds } };
    }
    if (q.recruiterId) recruiterFilter = { recruiterId: q.recruiterId };

    const reqWhere = buildReqWhere(q);
    if (q.requirementId) reqWhere.id = q.requirementId;

    const stages = await fetchScopedStages(q.serviceLineId);
    const activeStages = standardOnly
      ? stages.filter((s) => s.isStandard)
      : stages;

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirement: reqWhere, ...recruiterFilter },
      select: {
        ...PIPELINE_DETAIL_SELECT,
        requirement: { select: REQ_LOOKUP_SELECT },
      },
      orderBy: [{ recruiterId: "asc" }, { createdAt: "asc" }],
      take: 5000,
    });

    // per-recruiter aggregation for sheet 1
    type Agg = {
      name: string;
      email: string;
      sourced: number;
      submitted: number;
      offered: number;
      joined: number;
      dropped: number;
      active: number;
      submitTimeMins: number[];
      requirementIds: Set<string>;
      stageCounts: Record<string, number>;
    };
    const recruiterMap: Record<string, Agg> = {};

    for (const p of pipelines) {
      const rid = p.recruiterId;
      if (!recruiterMap[rid]) {
        recruiterMap[rid] = {
          name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
          email: p.recruiter.email,
          sourced: 0,
          submitted: 0,
          offered: 0,
          joined: 0,
          dropped: 0,
          active: 0,
          submitTimeMins: [],
          requirementIds: new Set(),
          stageCounts: {},
        };
      }
      const r = recruiterMap[rid];
      r.requirementIds.add(p.requirementId);
      r.sourced++;
      r.stageCounts[p.currentStageId] =
        (r.stageCounts[p.currentStageId] ?? 0) + 1;
      if (p.submittedAt) r.submitted++;
      if (p.offerStatus) r.offered++;
      if (isJoined(p)) r.joined++;
      if (isDropped(p)) r.dropped++;
      if (isActive(p)) r.active++;
      if (p.submittedAt) {
        r.submitTimeMins.push(
          (p.stageHistory ?? []).reduce(
            (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
            0
          )
        );
      }
    }

    const summaryRows = Object.values(recruiterMap).sort(
      (a, b) => b.sourced - a.sourced
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // Sheet 1: recruiter summary — dynamic real-stage columns
    const sheet1 = workbook.addWorksheet("Recruiter Summary", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const fixedLeft = [
      { header: "Recruiter", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Requirements", key: "reqs", width: 14 },
      { header: "Sourced", key: "sourced", width: 12 },
      { header: "Submitted", key: "submitted", width: 12 },
    ];
    const stageCols = activeStages.map((s) => ({
      header: s.label,
      key: `stage_${s.id}`,
      width: 16,
    }));
    const fixedRight = [
      { header: "Offered", key: "offered", width: 12 },
      { header: "Joined", key: "joined", width: 12 },
      { header: "Dropped", key: "dropped", width: 12 },
      { header: "Active", key: "active", width: 12 },
      { header: "Avg Days to Submit", key: "avgDays", width: 18 },
    ];
    sheet1.columns = [...fixedLeft, ...stageCols, ...fixedRight];
    styleHdr(sheet1.getRow(1));

    for (const r of summaryRows) {
      const avgDays =
        r.submitTimeMins.length > 0
          ? +(
              r.submitTimeMins.reduce((a, b) => a + b, 0) /
              r.submitTimeMins.length /
              1440
            ).toFixed(1)
          : "";
      const dynVals: Record<string, number> = {};
      for (const s of activeStages)
        dynVals[`stage_${s.id}`] = r.stageCounts[s.id] ?? 0;

      sheet1.addRow({
        name: r.name,
        email: r.email,
        reqs: r.requirementIds.size,
        sourced: r.sourced,
        submitted: r.submitted,
        ...dynVals,
        offered: r.offered,
        joined: r.joined,
        dropped: r.dropped,
        active: r.active,
        avgDays,
      }).height = 18;
    }
    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet1.columnCount },
    };

    // Sheet 2: candidates
    const reqLookup = Object.fromEntries(
      pipelines.map((p) => [p.requirementId, (p as any).requirement])
    );
    buildCandidateSheet(workbook, pipelines, reqLookup);

    const dateStr = new Date().toISOString().split("T")[0];
    const scopeTag = selectedIds ? "selected" : "all";
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-report-${scopeTag}-${windowLabel(
        q
      )}-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRecruiterReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export recruiter report" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 2. REQUIREMENT REPORT  (real service-line stages, selectable export)
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/requirements
export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const standardOnly = q.standardOnly === "true";

    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin
    );
    const baseReqWhere = buildReqWhere(q);
    const reqWhere =
      creatorIds !== null
        ? { ...baseReqWhere, createdById: { in: creatorIds } }
        : baseReqWhere;

    const stages = await fetchScopedStages(q.serviceLineId);
    const stageIdSet = new Set(stages.map((s) => s.id));

    const page = parseInt(q.page ?? "1", 10);
    const limit = Math.min(parseInt(q.limit ?? "25", 10), 100);
    const skip = (page - 1) * limit;

    const [total, requirements] = await Promise.all([
      prisma.requirement.count({ where: reqWhere }),
      prisma.requirement.findMany({
        where: reqWhere,
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          priority: true,
          jobType: true,
          remoteType: true,
          totalOpenings: true,
          city: true,
          country: true,
          respondBy: true,
          isRespondByBreached: true,
          isTurnaroundBreached: true,
          createdAt: true,
          deletedAt: true,
          client: { select: { id: true, name: true } },
          clientSpoc: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          businessUnit: { select: { id: true, name: true } },
          serviceLine: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { pipelines: true, assignments: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    if (!requirements.length) {
      return res.json({
        success: true,
        data: [],
        meta: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          stages: stageMetaOut(stages, standardOnly),
          window: windowLabel(q),
        },
      });
    }

    const reqIds = requirements.map((r) => r.id);

    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!stageIdSet.has(sc.currentStageId)) continue;
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] =
        (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
    }

    const data = requirements.map((r) => {
      const counts = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(counts).reduce((s, n) => s + n, 0);
      return {
        ...r,
        totalCandidates,
        stageCounts: counts, // keyed by stageId
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        stages: stageMetaOut(stages, standardOnly),
        window: windowLabel(q),
        standardOnly,
      },
    });
  } catch (err) {
    console.error("getRequirementReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement report" });
  }
};

// GET /reports/requirements/export   ( ?ids=  OR  /:id/export )
export const exportRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const singleId = req.params.id ?? null;
    const selectedIds = parseIds(q.ids);
    const standardOnly = q.standardOnly === "true";

    let baseWhere: Record<string, any>;
    if (singleId) {
      baseWhere = { id: singleId, deletedAt: null };
    } else {
      const creatorIds = await resolveOrgTreeDown(
        req.user!.id,
        req.user!.isSuperAdmin
      );
      const reqFilter = buildReqWhere(q);
      baseWhere =
        creatorIds !== null
          ? { ...reqFilter, createdById: { in: creatorIds } }
          : reqFilter;
      if (selectedIds) baseWhere.id = { in: selectedIds };
    }

    const stages = await fetchScopedStages(q.serviceLineId);
    const activeStages = standardOnly
      ? stages.filter((s) => s.isStandard)
      : stages;
    const stageIdSet = new Set(stages.map((s) => s.id));

    const requirements = await prisma.requirement.findMany({
      where: baseWhere,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        priority: true,
        jobType: true,
        remoteType: true,
        totalOpenings: true,
        city: true,
        state: true,
        country: true,
        respondBy: true,
        isRespondByBreached: true,
        isTurnaroundBreached: true,
        createdAt: true,
        deletedAt: true,
        client: { select: { id: true, name: true } },
        clientSpoc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: true,
          },
        },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    if (!requirements.length) {
      return res
        .status(404)
        .json({ success: false, message: "No requirements found" });
    }

    const reqIds = requirements.map((r) => r.id);

    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!stageIdSet.has(sc.currentStageId)) continue;
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] =
        (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
    }

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirementId: { in: reqIds } },
      select: PIPELINE_DETAIL_SELECT,
      orderBy: { createdAt: "asc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // Sheet 1: requirements — 2-row header (detail group + stage group)
    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    const fixedCols = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Title", key: "title", width: 38 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Client", key: "client", width: 24 },
      { header: "Client SPOC", key: "spoc", width: 22 },
      { header: "SPOC Email", key: "spocEmail", width: 26 },
      { header: "Business Unit", key: "bu", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "City", key: "city", width: 16 },
      { header: "Country", key: "country", width: 14 },
      { header: "Job Type", key: "jobType", width: 16 },
      { header: "Remote", key: "remote", width: 12 },
      { header: "Total Openings", key: "openings", width: 14 },
      { header: "Created By", key: "createdBy", width: 22 },
      { header: "Created Date", key: "createdAt", width: 18 },
      { header: "Deleted Date", key: "deletedAt", width: 18 },
      { header: "Days Open", key: "daysOpen", width: 12 },
      { header: "Respond By", key: "respondBy", width: 18 },
      { header: "SLA Breached?", key: "breached", width: 14 },
      { header: "Total Candidates", key: "total", width: 16 },
    ];
    const stageCols = activeStages.map((s) => ({
      header: s.label,
      key: `stage_${s.id}`,
      width: 14,
    }));
    sheet1.columns = [...fixedCols, ...stageCols];

    // group header row 1
    const groupRow = sheet1.getRow(1);
    groupRow.getCell(1).value = "Requirement Details";
    if (stageCols.length > 0) {
      groupRow.getCell(fixedCols.length + 1).value = "Pipeline Stages";
      sheet1.mergeCells(1, 1, 1, fixedCols.length);
      sheet1.mergeCells(
        1,
        fixedCols.length + 1,
        1,
        fixedCols.length + stageCols.length
      );
    }
    styleHdr(groupRow);
    if (stageCols.length > 0)
      groupRow.getCell(fixedCols.length + 1).fill = SUB_FILL;

    // column header row 2
    const colHdr = sheet1.getRow(2);
    [...fixedCols, ...stageCols].forEach((col, i) => {
      colHdr.getCell(i + 1).value = col.header;
    });
    styleHdr(colHdr, SUB_FILL);

    const now = Date.now();
    const STATUS_COLORS: Record<string, string> = {
      ACTIVE: "FF00875A",
      CLOSED: "FFDE350B",
      ON_HOLD: "FFFF991F",
      PENDING_APPROVAL: "FF0052CC",
      DRAFT: "FF6B778C",
      CANCELLED: "FF5E6C84",
    };

    for (const r of requirements) {
      const counts = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(counts).reduce((s, n) => s + n, 0);
      const daysOpen = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86400000
      );

      const rowData: Record<string, any> = {
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        priority: r.priority,
        client: r.client?.name ?? "",
        spoc: spocName(r.clientSpoc),
        spocEmail: r.clientSpoc?.email ?? "",
        bu: r.businessUnit?.name ?? "",
        sl: r.serviceLine?.name ?? "",
        city: r.city ?? "",
        country: r.country ?? "",
        jobType: r.jobType,
        remote: r.remoteType,
        openings: r.totalOpenings,
        createdBy: `${r.createdBy.firstName} ${r.createdBy.lastName}`,
        createdAt: new Date(r.createdAt),
        deletedAt: r.deletedAt ? new Date(r.deletedAt) : "",
        daysOpen,
        respondBy: r.respondBy ? new Date(r.respondBy) : "",
        breached:
          r.isRespondByBreached || r.isTurnaroundBreached ? "Yes" : "No",
        total: totalCandidates,
      };
      for (const s of activeStages)
        rowData[`stage_${s.id}`] = counts[s.id] ?? 0;

      const dataRow = sheet1.addRow(rowData);
      dataRow.height = 20;
      dataRow.getCell("createdAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (r.deletedAt)
        dataRow.getCell("deletedAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (r.respondBy) dataRow.getCell("respondBy").numFmt = "dd-mmm-yyyy";

      const sc = STATUS_COLORS[r.status];
      if (sc) {
        dataRow.getCell("status").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: sc },
        };
        dataRow.getCell("status").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }
      if (r.isRespondByBreached || r.isTurnaroundBreached) {
        dataRow.getCell("breached").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDE350B" },
        };
        dataRow.getCell("breached").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }
    }
    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: fixedCols.length + stageCols.length },
    };

    // Sheet 2: candidates
    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));
    buildCandidateSheet(workbook, pipelines, reqLookup);

    const suffix = singleId
      ? requirements[0]?.reqCode ?? singleId
      : selectedIds
      ? "selected"
      : "all";
    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="requirements-${suffix}-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRequirementReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export requirement report" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 3. CANDIDATE FUNNEL REPORT  (real stages)
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/candidates
export const getCandidateReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const reqWhere = buildReqWhere(q);
    const scopedUserIds = await resolveScopedUserIds(req);
    const stages = await fetchScopedStages(q.serviceLineId);

    const where: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null) where.recruiterId = { in: scopedUserIds };

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: {
        currentStageId: true,
        disposition: true,
        isRejected: true,
        isWithdrawn: true,
        stageUpdatedAt: true,
        stageHistory: { select: { timeInPrevStageMins: true } },
      },
    });

    const stageCounts: Record<string, number> = Object.fromEntries(
      stages.map((s) => [s.id, 0])
    );
    const dispositionCounts: Record<string, number> = {};
    let totalAgingMins = 0;

    for (const p of pipelines) {
      if (p.currentStageId in stageCounts) stageCounts[p.currentStageId]++;
      dispositionCounts[p.disposition] =
        (dispositionCounts[p.disposition] ?? 0) + 1;
      const stageAge = Math.floor(
        (Date.now() - new Date(p.stageUpdatedAt).getTime()) / 60000
      );
      totalAgingMins +=
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0
        ) + stageAge;
    }

    const total = pipelines.length;
    return res.json({
      success: true,
      data: {
        totalCandidates: total,
        funnelByStage: stages
          .map((s) => ({
            stageId: s.id,
            code: s.code,
            label: s.label,
            order: s.order,
            isStandard: s.isStandard,
            serviceLine: s.serviceLine ?? null,
            count: stageCounts[s.id] ?? 0,
            pct:
              total > 0
                ? +(((stageCounts[s.id] ?? 0) / total) * 100).toFixed(1)
                : 0,
          }))
          .filter((s) => s.count > 0),
        dispositionSummary: dispositionCounts,
        avgPipelineDays:
          total > 0 ? +(totalAgingMins / total / 1440).toFixed(1) : 0,
      },
      meta: { window: windowLabel(q) },
    });
  } catch (err) {
    console.error("getCandidateReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate report" });
  }
};

// GET /reports/candidates/export
export const exportCandidateReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const reqWhere = buildReqWhere(q);
    const scopedUserIds = await resolveScopedUserIds(req);

    const where: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null) where.recruiterId = { in: scopedUserIds };
    if (q.stageId) where.currentStageId = q.stageId;
    if (q.disposition) where.disposition = q.disposition as any;

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: {
        ...PIPELINE_DETAIL_SELECT,
        requirement: { select: REQ_LOOKUP_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    const reqLookup = Object.fromEntries(
      pipelines.map((p) => [p.requirementId, (p as any).requirement])
    );
    buildCandidateSheet(workbook, pipelines, reqLookup);

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="candidate-report-${windowLabel(
        q
      )}-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportCandidateReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export candidate report" });
  }
};
