// File: reports.controller.ts
// Path: src/controller/reports.controller.ts

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import prisma from "@/utils/prisma/client";
import { computeSaleValue } from "../requirementsController";

// ─────────────────────────────────────────────────────────────────────────────
// DATE / TIME WINDOW RESOLVER
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
      return { gte: new Date(now.getTime() - h * 60 * 60 * 1000), lte: now };
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
// SCOPE RESOLUTION
//
// !! CRITICAL FIX: The old approach (BFS via reportingToId only) missed team
// leads entirely — they use teamLeadId, not reportingToId.
//
// resolveScopedUserIds → reads req.scopeFilter (set by middleware).
//   TEAM scope now correctly returns teamMemberIds which includes the lead.
//
// resolveOrgTreeDown → kept only for CREATOR scope on requirement report
//   (who created requirements I can see follows the reporting tree,
//    not the team-lead tree — intentionally separate).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the set of user IDs whose pipeline rows the current user may see.
 * Reads from req.scopeFilter (already resolved by scopeFilter middleware).
 * Returns null = no restriction (ALL scope / super admin).
 */
function resolveScopedUserIds(req: Request): string[] | null {
  const scope = req.scopeFilter;
  if (!scope || scope.type === "ALL") return null;

  switch (scope.type) {
    case "OWN":
      return [scope.userId!];
    case "TEAM":
      // teamMemberIds already includes the team lead themselves
      return scope.teamMemberIds ?? [scope.userId!];
    case "REPORTING":
      return scope.subordinateIds ?? [scope.userId!];
    case "REPORTING_LINE":
      return scope.reportingLineIds ?? [scope.userId!];
    case "BU":
      return scope.subordinateIds ?? [scope.userId!];
    case "DEPARTMENT":
      // Can't express as a flat id list — fall back to self (safe default)
      return [scope.userId!];
    default:
      return [scope.userId!];
  }
}

/**
 * BFS down BOTH reportingToId AND teamLeadId trees.
 * Used for requirement creator-scope — "which users' created requirements can I see?"
 *
 * A team lead's members are linked via teamLeadId, NOT reportingToId.
 * Without walking teamLeadId, a team lead only sees requirements created by
 * people in the reportingTo chain — missing their entire team.
 *
 * Returns null for super admin (no filter).
 */
export async function resolveOrgTreeDown(
  userId: string,
  isSuperAdmin: boolean
): Promise<string[] | null> {
  if (isSuperAdmin) return null;
  const visited = new Set<string>([userId]);
  let frontier = [userId];
  while (frontier.length > 0) {
    // Walk both trees in one query — union of reportingToId and teamLeadId children
    const children = await prisma.user.findMany({
      where: {
        OR: [
          { reportingToId: { in: frontier } },
          { teamLeadId: { in: frontier } },
        ],
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

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT WHERE builder
// ─────────────────────────────────────────────────────────────────────────────

function buildReqWhere(
  q: Record<string, string | undefined>,
  opts: { withDateWindow?: boolean } = {}
): Record<string, any> {
  const { withDateWindow = true } = opts;
  const where: Record<string, any> = { deletedAt: null };
  if (q.clientId) where.clientId = q.clientId;
  if (q.serviceLineId) where.serviceLineId = q.serviceLineId;
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (withDateWindow) {
    const win = resolveDateWindow(q);
    if (win.gte || win.lte) {
      where.createdAt = {};
      if (win.gte) where.createdAt.gte = win.gte;
      if (win.lte) where.createdAt.lte = win.lte;
    }
  }
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGES
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
  if (serviceLineId) where.OR = [{ serviceLineId: null }, { serviceLineId }];
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
// DISPOSITION HELPERS
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

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL STYLING
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
const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEFF6FF" },
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

function styleTotalsRow(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.fill = TOTAL_FILL;
    c.font = { bold: true, size: 11, color: { argb: "FF1E3A5F" } };
    c.border = {
      top: { style: "medium", color: { argb: "FF4F46E5" } },
      bottom: { style: "thin", color: { argb: "FF4F46E5" } },
    };
  });
  row.height = 22;
}

function spocName(spoc: any): string {
  if (!spoc) return "";
  return `${spoc.firstName ?? ""} ${spoc.lastName ?? ""}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT
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
      isTerminal: true, // ← ADD
      isNearTerminal: true, // ← ADD
      pipeline: true, // ← ADD
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
// ALL CANDIDATE COLUMNS — single source of truth
// key   = what the frontend sends in ?hiddenCandidateCols=key1,key2
// Everything here is opt-out. User hides what they don't want.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CANDIDATE_COLS = [
  // ── Requirement context ──
  { key: "reqCode", header: "Req Code", width: 14, group: "requirement" },
  { key: "reqTitle", header: "Requirement", width: 34, group: "requirement" },
  {
    key: "totalPipeline",
    header: "Total Pipeline",
    width: 14,
    group: "requirement",
  }, // total candidates in this req
  { key: "client", header: "Client", width: 24, group: "requirement" },
  { key: "spoc", header: "Client SPOC", width: 22, group: "requirement" },
  { key: "spocEmail", header: "SPOC Email", width: 26, group: "requirement" },
  {
    key: "spocDesig",
    header: "SPOC Designation",
    width: 20,
    group: "requirement",
  },
  {
    key: "serviceLine",
    header: "Service Line",
    width: 18,
    group: "requirement",
  },
  { key: "bu", header: "Business Unit", width: 20, group: "requirement" },
  // ── Candidate identity ──
  { key: "name", header: "Candidate Name", width: 26, group: "candidate" },
  { key: "email", header: "Email", width: 30, group: "candidate" },
  { key: "phone", header: "Phone", width: 16, group: "candidate" },
  { key: "title", header: "Current Title", width: 24, group: "candidate" },
  { key: "company", header: "Current Company", width: 22, group: "candidate" },
  { key: "exp", header: "Exp (yrs)", width: 10, group: "candidate" },
  { key: "skills", header: "Top Skills", width: 34, group: "candidate" },
  // ── Pipeline state ──
  { key: "recruiter", header: "Recruiter", width: 22, group: "pipeline" },
  { key: "stage", header: "Current Stage", width: 24, group: "pipeline" },
  { key: "disposition", header: "Status", width: 14, group: "pipeline" },
  { key: "addedOn", header: "Added On", width: 16, group: "pipeline" },
  {
    key: "pipelineDays",
    header: "Days in Pipeline",
    width: 16,
    group: "pipeline",
  },
  { key: "aging", header: "Stage Aging", width: 12, group: "pipeline" },
  { key: "submittedAt", header: "Submitted At", width: 18, group: "pipeline" },
  { key: "offerStatus", header: "Offer Status", width: 14, group: "pipeline" },
  // ── CTC ──
  { key: "currentCtc", header: "Current CTC", width: 14, group: "ctc" },
  { key: "expectedCtc", header: "Expected CTC", width: 14, group: "ctc" },
  { key: "negotiatedCtc", header: "Negotiated CTC", width: 14, group: "ctc" },
  { key: "offeredCtc", header: "Offered CTC", width: 14, group: "ctc" },
  { key: "currency", header: "Currency", width: 10, group: "ctc" },
  { key: "salaryType", header: "Salary Type", width: 12, group: "ctc" },
  // ── Joining ──
  { key: "noticePeriod", header: "Notice Period", width: 14, group: "joining" },
  { key: "lwd", header: "Last Working Day", width: 16, group: "joining" },
  {
    key: "expectedJoining",
    header: "Expected Joining",
    width: 16,
    group: "joining",
  },
  {
    key: "actualJoining",
    header: "Actual Joining",
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
  // ── Flags ──
  { key: "rejected", header: "Rejected?", width: 10, group: "flags" },
  { key: "withdrawn", header: "Withdrawn?", width: 10, group: "flags" },
  { key: "onHold", header: "On Hold?", width: 10, group: "flags" },
  // ── Audit ──
  { key: "reqCreated", header: "Req Created", width: 16, group: "audit" },
  { key: "reqDeleted", header: "Req Deleted", width: 16, group: "audit" },
] as const;

type CandidateColKey = (typeof ALL_CANDIDATE_COLS)[number]["key"];

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE SHEET BUILDER
//
// opts.hiddenCols  — keys the user has unchecked in the candidate column picker
// opts.stageIds    — filter: only emit rows where currentStageId is in this set
// opts.disposition — filter: only emit rows with this disposition
// totalPipelineByReq — total pipeline count per req (all stages, pre-computed)
// ─────────────────────────────────────────────────────────────────────────────

function buildCandidateSheet(
  workbook: ExcelJS.Workbook,
  pipelines: any[],
  reqLookup: Record<string, any>,
  opts: {
    hiddenCols?: Set<CandidateColKey>;
    stageIds?: string[];
    disposition?: string;
  } = {},
  totalPipelineByReq: Record<string, number> = {}
) {
  const hidden = opts.hiddenCols ?? new Set<CandidateColKey>();

  // Only include columns the user hasn't hidden
  const activeCols = ALL_CANDIDATE_COLS.filter((c) => !hidden.has(c.key));

  const sheet = workbook.addWorksheet("Candidates", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = activeCols.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  styleHdr(sheet.getRow(1));

  const stageSet = opts.stageIds ? new Set(opts.stageIds) : null;
  const now = Date.now();

  let totalRows = 0;
  let totalPipelineDays = 0;
  const dispositionCount: Record<string, number> = {};

  const has = (k: CandidateColKey) => !hidden.has(k);

  for (const p of pipelines) {
    if (stageSet && !stageSet.has(p.currentStageId)) continue;
    if (opts.disposition && p.disposition !== opts.disposition) continue;

    const req = reqLookup[p.requirementId];
    const stageAgeMins = Math.floor(
      (now - new Date(p.stageUpdatedAt).getTime()) / 60000
    );
    const totalMins =
      (p.stageHistory ?? []).reduce(
        (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
        0
      ) + stageAgeMins;
    const pipelineDays = Math.floor(totalMins / 1440);

    totalRows++;
    totalPipelineDays += pipelineDays;
    dispositionCount[p.disposition] =
      (dispositionCount[p.disposition] ?? 0) + 1;

    // Build row data only for active columns — avoids setting unused keys
    const rowData: Record<string, any> = {};
    if (has("reqCode")) rowData.reqCode = req?.reqCode ?? "";
    if (has("reqTitle")) rowData.reqTitle = req?.title ?? "";
    if (has("totalPipeline"))
      rowData.totalPipeline = totalPipelineByReq[p.requirementId] ?? "";
    if (has("client")) rowData.client = req?.client?.name ?? "";
    if (has("spoc")) rowData.spoc = spocName(req?.clientSpoc);
    if (has("spocEmail")) rowData.spocEmail = req?.clientSpoc?.email ?? "";
    if (has("spocDesig"))
      rowData.spocDesig = req?.clientSpoc?.designation ?? "";
    if (has("serviceLine")) rowData.serviceLine = req?.serviceLine?.name ?? "";
    if (has("bu")) rowData.bu = req?.businessUnit?.name ?? "";
    if (has("name"))
      rowData.name =
        p.snapshot?.fullName || `[no snapshot — ${p.id.slice(0, 8)}]`;
    if (has("email")) rowData.email = p.snapshot?.email ?? "";
    if (has("phone")) rowData.phone = p.snapshot?.phone ?? "";
    if (has("title")) rowData.title = p.snapshot?.currentTitle ?? "";
    if (has("company")) rowData.company = p.snapshot?.currentCompany ?? "";
    if (has("exp")) rowData.exp = p.snapshot?.totalExpYears ?? "";
    if (has("skills"))
      rowData.skills = (p.snapshot?.topSkills ?? []).join(", ");
    if (has("recruiter"))
      rowData.recruiter = [p.recruiter?.firstName, p.recruiter?.lastName]
        .filter(Boolean)
        .join(" ");
    if (has("stage")) rowData.stage = p.currentStage?.label ?? "";
    if (has("disposition")) rowData.disposition = p.disposition;
    if (has("addedOn")) rowData.addedOn = new Date(p.createdAt);
    if (has("pipelineDays")) rowData.pipelineDays = pipelineDays;
    if (has("aging")) rowData.aging = formatAging(stageAgeMins);
    if (has("submittedAt"))
      rowData.submittedAt = p.submittedAt ? new Date(p.submittedAt) : "";
    if (has("offerStatus")) rowData.offerStatus = p.offerStatus ?? "";
    if (has("currentCtc")) rowData.currentCtc = p.currentCtc ?? "";
    if (has("expectedCtc")) rowData.expectedCtc = p.expectedCtc ?? "";
    if (has("negotiatedCtc")) rowData.negotiatedCtc = p.negotiatedCtc ?? "";
    if (has("offeredCtc")) rowData.offeredCtc = p.offeredCtc ?? "";
    if (has("currency")) rowData.currency = p.salaryCurrency ?? "";
    if (has("salaryType")) rowData.salaryType = p.salaryType ?? "";
    if (has("noticePeriod")) rowData.noticePeriod = p.noticePeriod ?? "";
    if (has("lwd"))
      rowData.lwd = p.lastWorkingDate ? new Date(p.lastWorkingDate) : "";
    if (has("expectedJoining"))
      rowData.expectedJoining = p.expectedJoiningDate
        ? new Date(p.expectedJoiningDate)
        : "";
    if (has("actualJoining"))
      rowData.actualJoining = p.actualJoiningDate
        ? new Date(p.actualJoiningDate)
        : "";
    if (has("monthOfJoining")) rowData.monthOfJoining = p.monthOfJoining ?? "";
    if (has("daysToJoin")) rowData.daysToJoin = p.remainingDaysToJoin ?? "";
    if (has("rejected")) rowData.rejected = p.isRejected ? "Yes" : "No";
    if (has("withdrawn")) rowData.withdrawn = p.isWithdrawn ? "Yes" : "No";
    if (has("onHold")) rowData.onHold = p.isOnHold ? "Yes" : "No";
    if (has("reqCreated"))
      rowData.reqCreated = req?.createdAt ? new Date(req.createdAt) : "";
    if (has("reqDeleted"))
      rowData.reqDeleted = req?.deletedAt ? new Date(req.deletedAt) : "";

    const row = sheet.addRow(rowData);
    row.height = 18;
    if (has("addedOn")) row.getCell("addedOn").numFmt = "dd-mmm-yyyy";
    if (has("submittedAt") && p.submittedAt)
      row.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
    if (has("lwd") && p.lastWorkingDate)
      row.getCell("lwd").numFmt = "dd-mmm-yyyy";
    if (has("expectedJoining") && p.expectedJoiningDate)
      row.getCell("expectedJoining").numFmt = "dd-mmm-yyyy";
    if (has("actualJoining") && p.actualJoiningDate)
      row.getCell("actualJoining").numFmt = "dd-mmm-yyyy";
    if (has("reqCreated") && req?.createdAt)
      row.getCell("reqCreated").numFmt = "dd-mmm-yyyy hh:mm";
    if (has("reqDeleted") && req?.deletedAt)
      row.getCell("reqDeleted").numFmt = "dd-mmm-yyyy hh:mm";

    if (p.isRejected || p.isWithdrawn) {
      row.eachCell((c) => {
        c.font = { ...c.font, color: { argb: "FF7A869A" } };
      });
    }
  }

  // ── TOTALS ROW ────────────────────────────────────────────────────────────
  const dispositionSummary = Object.entries(dispositionCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");

  const totalsData: Record<string, any> = {};
  // First visible column gets the total label
  if (activeCols.length > 0)
    totalsData[activeCols[0].key] = `TOTAL: ${totalRows} candidates`;
  if (activeCols.length > 1)
    totalsData[activeCols[1].key] = dispositionSummary || "";
  if (has("pipelineDays"))
    totalsData.pipelineDays =
      totalRows > 0 ? Math.round(totalPipelineDays / totalRows) : 0;
  if (has("aging")) totalsData.aging = "avg days";

  const totalsRow = sheet.addRow(totalsData);
  styleTotalsRow(totalsRow);
  if (activeCols.length >= 2) {
    sheet.mergeCells(totalsRow.number, 1, totalsRow.number, 2);
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };

  return { totalRows, dispositionCount };
}

function parseIds(raw?: string): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. OVERVIEW
// GET /reports/overview
// ─────────────────────────────────────────────────────────────────────────────

export const getReportsOverview = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const win = resolveDateWindow(q);
    const scopedUserIds = resolveScopedUserIds(req); // !! sync now, reads req.scopeFilter

    const reqWhere = buildReqWhere(q);
    const stages = await fetchScopedStages(q.serviceLineId);

    const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null)
      pipelineWhere.recruiterId = { in: scopedUserIds };

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
        requirement: {
          select: {
            serviceLineId: true,
            serviceLine: { select: { id: true, name: true } },
            businessUnitId: true,
            businessUnit: { select: { id: true, name: true } },
          },
        },
      },
    });

    const total = pipelines.length;
    let submitted = 0,
      offered = 0,
      joined = 0,
      dropped = 0,
      active = 0;

    const NONE = "__none__";
    const stageCounts: Record<string, number> = Object.fromEntries(
      stages.map((s) => [s.id, 0])
    );
    const dispositionCounts: Record<string, number> = {};
    const recruiterAgg: Record<
      string,
      { id: string; name: string; sourced: number; joined: number }
    > = {};

    type LineAgg = {
      serviceLineId: string | null;
      name: string;
      total: number;
      submitted: number;
      offered: number;
      joined: number;
      stageCounts: Record<string, number>;
    };
    const lineAgg: Record<string, LineAgg> = {};

    type BuAgg = {
      businessUnitId: string | null;
      name: string;
      total: number;
      joined: number;
    };
    const buAgg: Record<string, BuAgg> = {};

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
      const rq = (p as any).requirement;
      const lineId: string | null = rq?.serviceLineId ?? null;
      const lineKey = lineId ?? NONE;
      const buId: string | null = rq?.businessUnitId ?? null;
      const buKey = buId ?? NONE;

      if (p.currentStageId in stageCounts) stageCounts[p.currentStageId]++;
      dispositionCounts[p.disposition] =
        (dispositionCounts[p.disposition] ?? 0) + 1;
      const isJ = isJoined(p);
      if (p.submittedAt) submitted++;
      if (p.offerStatus) offered++;
      if (isJ) joined++;
      if (isDropped(p)) dropped++;
      if (isActive(p)) active++;

      const k = bucketKey(new Date(p.createdAt));
      series[k] = (series[k] ?? 0) + 1;

      const rid = p.recruiterId;
      if (!recruiterAgg[rid])
        recruiterAgg[rid] = {
          id: rid,
          name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
          sourced: 0,
          joined: 0,
        };
      recruiterAgg[rid].sourced++;
      if (isJ) recruiterAgg[rid].joined++;

      if (!lineAgg[lineKey])
        lineAgg[lineKey] = {
          serviceLineId: lineId,
          name: rq?.serviceLine?.name ?? "Unassigned",
          total: 0,
          submitted: 0,
          offered: 0,
          joined: 0,
          stageCounts: {},
        };
      const la = lineAgg[lineKey];
      la.total++;
      if (p.submittedAt) la.submitted++;
      if (p.offerStatus) la.offered++;
      if (isJ) la.joined++;
      la.stageCounts[p.currentStageId] =
        (la.stageCounts[p.currentStageId] ?? 0) + 1;

      if (!buAgg[buKey])
        buAgg[buKey] = {
          businessUnitId: buId,
          name: rq?.businessUnit?.name ?? "Unassigned",
          total: 0,
          joined: 0,
        };
      buAgg[buKey].total++;
      if (isJ) buAgg[buKey].joined++;
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

    const stageForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId
      );

    const byServiceLine = Object.values(lineAgg)
      .sort((a, b) => b.total - a.total)
      .map((la) => ({
        serviceLineId: la.serviceLineId,
        name: la.name,
        total: la.total,
        submitted: la.submitted,
        offered: la.offered,
        joined: la.joined,
        funnel: stageForLine(la.serviceLineId)
          .map((s) => ({
            stageId: s.id,
            label: s.label,
            order: s.order,
            count: la.stageCounts[s.id] ?? 0,
          }))
          .filter((s) => s.count > 0),
      }));

    const byBusinessUnit = Object.values(buAgg).sort(
      (a, b) => b.total - a.total
    );
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
        byServiceLine,
        byBusinessUnit,
        dispositionCounts,
        timeSeries,
        timeGranularity: bucketByHour ? "hour" : "day",
        leaderboard,
      },
      meta: {
        window: windowLabel(q),
        granularity: bucketByHour ? "hour" : "day",
        scope: req.scopeFilter?.type ?? "ALL",
        multiLine: byServiceLine.length > 1,
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
// 1. RECRUITER REPORT
// GET /reports/recruiters
// ─────────────────────────────────────────────────────────────────────────────

// function buildRecruiterRows(pipes: any[]) {
//   type ReqStats = {
//     requirementId: string;
//     reqCode: string;
//     title: string;
//     status: string;
//     totalOpenings: number;
//     client: any;
//     serviceLine: any;
//     businessUnit: any;
//     sourced: number;
//     submitted: number;
//     offered: number;
//     joined: number;
//     dropped: number;
//     active: number;
//     stageCounts: Record<string, number>;
//   };
//   type RecAgg = {
//     id: string;
//     name: string;
//     email: string;
//     sourced: number;
//     submitted: number;
//     offered: number;
//     joined: number;
//     dropped: number;
//     active: number;
//     submitTimeMins: number[];
//     stageCounts: Record<string, number>;
//     reqMap: Record<string, ReqStats>;
//   };

//   const map: Record<string, RecAgg> = {};

//   for (const p of pipes) {
//     const rid = p.recruiterId;
//     if (!map[rid]) {
//       map[rid] = {
//         id: rid,
//         name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
//         email: p.recruiter.email,
//         sourced: 0,
//         submitted: 0,
//         offered: 0,
//         joined: 0,
//         dropped: 0,
//         active: 0,
//         submitTimeMins: [],
//         stageCounts: {},
//         reqMap: {},
//       };
//     }
//     const r = map[rid];
//     r.sourced++;
//     r.stageCounts[p.currentStageId] =
//       (r.stageCounts[p.currentStageId] ?? 0) + 1;
//     if (p.submittedAt) r.submitted++;
//     if (p.offerStatus) r.offered++;
//     if (isJoined(p)) r.joined++;
//     if (isDropped(p)) r.dropped++;
//     if (isActive(p)) r.active++;
//     if (p.submittedAt)
//       r.submitTimeMins.push(
//         (p.stageHistory ?? []).reduce(
//           (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
//           0
//         )
//       );

//     const rq = p.requirement;
//     const reqId = p.requirementId;
//     if (!r.reqMap[reqId])
//       r.reqMap[reqId] = {
//         requirementId: reqId,
//         reqCode: rq?.reqCode ?? "",
//         title: rq?.title ?? "",
//         status: rq?.status ?? "",
//         totalOpenings: rq?.totalOpenings ?? 0,
//         client: rq?.client ?? null,
//         serviceLine: rq?.serviceLine ?? null,
//         businessUnit: rq?.businessUnit ?? null,
//         sourced: 0,
//         submitted: 0,
//         offered: 0,
//         joined: 0,
//         dropped: 0,
//         active: 0,
//         stageCounts: {},
//       };
//     const rqs = r.reqMap[reqId];
//     rqs.sourced++;
//     rqs.stageCounts[p.currentStageId] =
//       (rqs.stageCounts[p.currentStageId] ?? 0) + 1;
//     if (p.submittedAt) rqs.submitted++;
//     if (p.offerStatus) rqs.offered++;
//     if (isJoined(p)) rqs.joined++;
//     if (isDropped(p)) rqs.dropped++;
//     if (isActive(p)) rqs.active++;
//   }

//   return Object.values(map)
//     .map((r) => ({
//       id: r.id,
//       name: r.name,
//       email: r.email,
//       sourced: r.sourced,
//       submitted: r.submitted,
//       offered: r.offered,
//       joined: r.joined,
//       dropped: r.dropped,
//       active: r.active,
//       submissionRate:
//         r.sourced > 0 ? +((r.submitted / r.sourced) * 100).toFixed(1) : 0,
//       offerRate:
//         r.submitted > 0 ? +((r.offered / r.submitted) * 100).toFixed(1) : 0,
//       joinRate: r.offered > 0 ? +((r.joined / r.offered) * 100).toFixed(1) : 0,
//       avgTimeToSubmitDays:
//         r.submitTimeMins.length > 0
//           ? +(
//               r.submitTimeMins.reduce((a, b) => a + b, 0) /
//               r.submitTimeMins.length /
//               1440
//             ).toFixed(1)
//           : null,
//       stageCounts: r.stageCounts,
//       requirementBreakdown: Object.values(r.reqMap)
//         .sort((a, b) => b.sourced - a.sourced)
//         .map((rq) => ({ ...rq })),
//     }))
//     .sort((a, b) => b.sourced - a.sourced);
// }

// File: reports.controller.recruiter.stats.patch.ts
// Path: DROP INTO src/controller/reports/reports.controller.ts
//
// INSTRUCTIONS:
// 1. Replace the existing `buildRecruiterRows` function wholesale.
// 2. In `getRecruiterReport`, replace the `pipelines` select to include
//    the new stage flags (isNearTerminal, isSourced, pipeline).
// 3. In `exportRecruiterReport`, update the summary sheet columns to add
//    the new stat columns.
//
// WHAT CHANGED vs old version:
//   OLD: isJoined(p) checked disposition=PLACED || actualJoiningDate → "joined"
//        isDropped(p) checked disposition=DROPPED || isRejected || isWithdrawn → "dropped"
//        isActive(p) checked disposition=ACTIVE → "active"
//
//   NEW: reads currentStage flags instead:
//        isTerminal  → placed (achieved)
//        isNearTerminal && !isTerminal → nearTerminal
//        pipeline=false → offPipeline (dropped, rejected, duplicate, withdrawn — all "out")
//        pipeline=true && !isTerminal && !isNearTerminal → inPipeline
//
//   "sourced" = total candidates in the recruiter's pipeline — unchanged.
//
// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT — add to your existing PIPELINE_DETAIL_SELECT:
// currentStage now includes the flags we need.
// ─────────────────────────────────────────────────────────────────────────────

// In PIPELINE_DETAIL_SELECT, ensure currentStage select has these fields:
//
// currentStage: {
//   select: {
//     id: true,
//     code: true,
//     label: true,
//     order: true,
//     canonicalStage: true,
//     isTerminal: true,      // ← NEW (may already be there)
//     isNearTerminal: true,  // ← NEW
//     isSourced: true,       // ← NEW
//     pipeline: true,        // ← NEW (Boolean — false = off pipeline)
//   },
// },

// ─────────────────────────────────────────────────────────────────────────────
// REPLACEMENT FUNCTION — drop in place of existing buildRecruiterRows
// ─────────────────────────────────────────────────────────────────────────────

export function buildRecruiterRows(pipes: any[]) {
  type ReqStats = {
    requirementId: string;
    reqCode: string;
    title: string;
    status: string;
    totalOpenings: number;
    client: any;
    serviceLine: any;
    businessUnit: any;
    sourced: number;
    submitted: number;
    offered: number;
    placed: number; // isTerminal
    nearTerminal: number; // isNearTerminal && !isTerminal
    offPipeline: number; // pipeline=false (rejected, dropped, dup, withdrawn)
    inPipeline: number; // pipeline=true && !isTerminal && !isNearTerminal
    stageCounts: Record<string, number>;
  };

  type RecAgg = {
    id: string;
    name: string;
    email: string;
    sourced: number;
    submitted: number;
    offered: number;
    placed: number; // isTerminal
    nearTerminal: number; // isNearTerminal && !isTerminal
    offPipeline: number; // pipeline=false
    inPipeline: number; // active in pipeline
    submitTimeMins: number[];
    stageCounts: Record<string, number>;
    reqMap: Record<string, ReqStats>;
  };

  const map: Record<string, RecAgg> = {};

  for (const p of pipes) {
    const rid = p.recruiterId;
    if (!map[rid]) {
      map[rid] = {
        id: rid,
        name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
        email: p.recruiter.email,
        sourced: 0,
        submitted: 0,
        offered: 0,
        placed: 0,
        nearTerminal: 0,
        offPipeline: 0,
        inPipeline: 0,
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

    // ── Stage flag classification ─────────────────────────────────────────
    const stage = p.currentStage;
    if (stage?.isTerminal) {
      r.placed++;
    } else if (stage?.isNearTerminal) {
      r.nearTerminal++;
    } else if (stage?.pipeline === false) {
      // pipeline=false covers: rejected, withdrawn, duplicate, dropped —
      // anything that is permanently out of the active funnel
      r.offPipeline++;
    } else {
      // pipeline=true, not terminal, not near-terminal → actively in pipeline
      r.inPipeline++;
    }

    if (p.submittedAt)
      r.submitTimeMins.push(
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0
        )
      );

    const rq = p.requirement;
    const reqId = p.requirementId;
    if (!r.reqMap[reqId])
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
        placed: 0,
        nearTerminal: 0,
        offPipeline: 0,
        inPipeline: 0,
        stageCounts: {},
      };
    const rqs = r.reqMap[reqId];
    rqs.sourced++;
    rqs.stageCounts[p.currentStageId] =
      (rqs.stageCounts[p.currentStageId] ?? 0) + 1;
    if (p.submittedAt) rqs.submitted++;
    if (p.offerStatus) rqs.offered++;
    if (stage?.isTerminal) rqs.placed++;
    else if (stage?.isNearTerminal) rqs.nearTerminal++;
    else if (stage?.pipeline === false) rqs.offPipeline++;
    else rqs.inPipeline++;
  }

  return Object.values(map)
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      sourced: r.sourced,
      submitted: r.submitted,
      offered: r.offered,
      placed: r.placed,
      nearTerminal: r.nearTerminal,
      offPipeline: r.offPipeline,
      inPipeline: r.inPipeline,
      submissionRate:
        r.sourced > 0 ? +((r.submitted / r.sourced) * 100).toFixed(1) : 0,
      offerRate:
        r.submitted > 0 ? +((r.offered / r.submitted) * 100).toFixed(1) : 0,
      placementRate:
        r.sourced > 0 ? +((r.placed / r.sourced) * 100).toFixed(1) : 0,
      avgTimeToSubmitDays:
        r.submitTimeMins.length > 0
          ? +(
              r.submitTimeMins.reduce((a, b) => a + b, 0) /
              r.submitTimeMins.length /
              1440
            ).toFixed(1)
          : null,
      stageCounts: r.stageCounts,
      requirementBreakdown: Object.values(r.reqMap)
        .sort((a, b) => b.sourced - a.sourced)
        .map((rq) => ({ ...rq })),
    }))
    .sort((a, b) => b.sourced - a.sourced);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT SHEET COLUMNS PATCH
// In exportRecruiterReport, replace the fixedRight array with this:
// ─────────────────────────────────────────────────────────────────────────────

// export const RECRUITER_EXPORT_FIXED_RIGHT = [
//   { header: "Offered", key: "offered", width: 12 },
//   { header: "Placed", key: "placed", width: 12 }, // was "Joined"
//   { header: "Near Close", key: "nearTerminal", width: 14 }, // NEW
//   { header: "In Pipeline", key: "inPipeline", width: 14 }, // was "Active"
//   { header: "Off Pipeline", key: "offPipeline", width: 14 }, // was "Dropped"
//   { header: "Avg Days to Submit", key: "avgDays", width: 18 },
// ];

export const RECRUITER_EXPORT_FIXED_RIGHT = [
  { header: "Offered", key: "offered", width: 12 },
  { header: "Placed", key: "placed", width: 12 }, // was "Joined"
  { header: "Near Close", key: "nearTerminal", width: 14 }, // NEW
  { header: "In Pipeline", key: "inPipeline", width: 14 }, // was "Active"
  { header: "Off Pipeline", key: "offPipeline", width: 14 }, // was "Dropped"
  { header: "Avg Days to Submit", key: "avgDays", width: 18 },
];

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT ROW PATCH
// In exportRecruiterReport data loop, replace old joined/dropped/active with:
//
//   placed:       r.placed,
//   nearTerminal: r.nearTerminal,
//   inPipeline:   r.inPipeline,
//   offPipeline:  r.offPipeline,
//
// And in totals row:
//   placed:       totalPlaced,
//   nearTerminal: totalNearTerminal,
//   inPipeline:   totalInPipeline,
//   offPipeline:  totalOffPipeline,
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const { recruiterId, requirementId } = q;
    const standardOnly = q.standardOnly === "true";

    const scopedUserIds = resolveScopedUserIds(req); // !! sync, reads req.scopeFilter

    let recruiterFilter: Record<string, any> = {};
    if (recruiterId) {
      if (scopedUserIds !== null && !scopedUserIds.includes(recruiterId))
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      recruiterFilter = { recruiterId };
    } else if (scopedUserIds !== null) {
      recruiterFilter = { recruiterId: { in: scopedUserIds } };
    }

    const reqWhere = buildReqWhere(q, { withDateWindow: false });
    if (requirementId) reqWhere.id = requirementId;

    const stages = await fetchScopedStages(q.serviceLineId);

    const win = resolveDateWindow(q);
    const activityWindow =
      win.gte || win.lte
        ? {
            ...(win.gte ? { gte: win.gte } : {}),
            ...(win.lte ? { lte: win.lte } : {}),
          }
        : null;

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: {
        requirement: reqWhere,
        ...recruiterFilter,
        ...(activityWindow
          ? {
              OR: [
                { createdAt: activityWindow },
                { updatedAt: activityWindow },
                { stageHistory: { some: { createdAt: activityWindow } } },
              ],
            }
          : {}),
      },
      select: {
        ...PIPELINE_DETAIL_SELECT,
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            totalOpenings: true,
            serviceLineId: true,
            client: { select: { id: true, name: true } },
            serviceLine: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
          },
        },
      },
    });

    const commonMeta = {
      scope: req.scopeFilter?.type ?? "ALL",
      window: windowLabel(q),
      standardOnly,
    };
    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId
      );

    const recruiterIds = [...new Set(pipelines.map((p) => p.recruiterId))];
    const users =
      recruiterIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: recruiterIds } },
            select: {
              id: true,
              servicelineId: true,
              serviceline: { select: { id: true, name: true } },
            },
          })
        : [];
    const userLine = new Map<string, { id: string; name: string } | null>();
    for (const u of users) userLine.set(u.id, u.serviceline ?? null);

    const fallbackTally = new Map<
      string,
      Map<string, { name: string; count: number }>
    >();
    for (const p of pipelines) {
      const rid = p.recruiterId;
      if (userLine.get(rid)) continue;
      const sl = (p as any).requirement?.serviceLine ?? null;
      if (!sl) continue;
      if (!fallbackTally.has(rid)) fallbackTally.set(rid, new Map());
      const t = fallbackTally.get(rid)!;
      const e = t.get(sl.id) ?? { name: sl.name, count: 0 };
      e.count++;
      t.set(sl.id, e);
    }

    const resolveLine = (rid: string): { id: string; name: string } | null => {
      const fromUser = userLine.get(rid);
      if (fromUser) return fromUser;
      const t = fallbackTally.get(rid);
      if (t && t.size) {
        let best: { id: string; name: string; count: number } | null = null;
        for (const [id, { name, count }] of t)
          if (!best || count > best.count) best = { id, name, count };
        if (best) return { id: best.id, name: best.name };
      }
      return null;
    };

    const byLine = new Map<string, any[]>();
    const lineMeta = new Map<string, { id: string; name: string } | null>();
    for (const p of pipelines) {
      const line = resolveLine(p.recruiterId);
      const key = line?.id ?? "__none__";
      if (!byLine.has(key)) {
        byLine.set(key, []);
        lineMeta.set(key, line);
      }
      byLine.get(key)!.push(p);
    }

    const groups = [...byLine.entries()]
      .map(([key, pipes]) => {
        const sl = lineMeta.get(key) ?? null;
        const data = buildRecruiterRows(pipes);
        return {
          serviceLine: sl,
          stages: stageMetaOut(stagesForLine(sl?.id ?? null), standardOnly),
          data,
          total: data.length,
        };
      })
      .sort(
        (a, b) =>
          b.data.reduce((s, r) => s + r.sourced, 0) -
          a.data.reduce((s, r) => s + r.sourced, 0)
      );

    return res.json({
      success: true,
      groups,
      meta: { ...commonMeta, multiLine: groups.length > 1 },
    });
  } catch (err) {
    console.error("getRecruiterReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter report" });
  }
};

// GET /reports/recruiters/export
// Query params synced from frontend:
//   ids, recruiterId, requirementId, serviceLineId, standardOnly,
//   stageIds      — stage IDs the user explicitly selected (filters Candidates sheet to those stages)
//   hiddenStageIds — stage column IDs hidden via column picker (omit from Sheet 1 AND Candidates)
//   disposition, clientId, status, range/hours/fromDate/toDate
export const exportRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const selectedIds = parseIds(q.ids);
    const selectedStageIds = parseIds(q.stageIds);
    const hiddenStageIds = new Set(parseIds(q.hiddenStageIds) ?? []);
    const standardOnly = q.standardOnly === "true";

    const scopedUserIds = resolveScopedUserIds(req);

    let recruiterFilter: Record<string, any> = {};
    if (selectedIds) {
      const allowedIds =
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
    // Remove stages the user has hidden in the column picker
    const activeStages = (
      standardOnly ? stages.filter((s) => s.isStandard) : stages
    ).filter((s) => !hiddenStageIds.has(s.id));

    const pipelineWhere: Record<string, any> = {
      requirement: reqWhere,
      ...recruiterFilter,
    };
    if (q.disposition) pipelineWhere.disposition = q.disposition as any;

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: { ...PIPELINE_DETAIL_SELECT },
      orderBy: [{ recruiterId: "asc" }, { createdAt: "asc" }],
      take: 5000,
    });

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
      if (!recruiterMap[rid])
        recruiterMap[rid] = {
          name: [p.recruiter?.firstName, p.recruiter?.lastName]
            .filter(Boolean)
            .join(" "),
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
      if (p.submittedAt)
        r.submitTimeMins.push(
          (p.stageHistory ?? []).reduce(
            (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
            0
          )
        );
    }

    const summaryRows = Object.values(recruiterMap).sort(
      (a, b) => b.sourced - a.sourced
    );

    // Pre-compute grand stage totals — bake into column headers as "Label (N)"
    const grandStageCounts: Record<string, number> = {};
    for (const r of summaryRows) {
      for (const s of activeStages) {
        grandStageCounts[s.id] =
          (grandStageCounts[s.id] ?? 0) + (r.stageCounts[s.id] ?? 0);
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

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
    // "Label (N)" — column total visible at a glance without scrolling to the totals row
    const stageCols = activeStages.map((s) => ({
      header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
      key: `stage_${s.id}`,
      width: Math.max(s.label.length + 6, 14),
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

    let totalSourced = 0,
      totalSubmitted = 0,
      totalOffered = 0,
      totalJoined = 0,
      totalDropped = 0,
      totalActive = 0;
    const totalReqs = new Set<string>();

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
      totalSourced += r.sourced;
      totalSubmitted += r.submitted;
      totalOffered += r.offered;
      totalJoined += r.joined;
      totalDropped += r.dropped;
      totalActive += r.active;
      r.requirementIds.forEach((id) => totalReqs.add(id));
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

    const grandDynVals: Record<string, number> = {};
    for (const s of activeStages)
      grandDynVals[`stage_${s.id}`] = grandStageCounts[s.id] ?? 0;
    const totalsRow1 = sheet1.addRow({
      name: "TOTAL",
      email: "",
      reqs: totalReqs.size,
      sourced: totalSourced,
      submitted: totalSubmitted,
      ...grandDynVals,
      offered: totalOffered,
      joined: totalJoined,
      dropped: totalDropped,
      active: totalActive,
      avgDays: "",
    });
    styleTotalsRow(totalsRow1);

    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet1.columnCount },
    };

    // ── Sheet 2: Candidates ───────────────────────────────────────────────────
    // stageIds priority: explicit selection > hidden exclusion (show visible only) > all
    const reqIds = [...new Set(pipelines.map((p) => p.requirementId))];
    const requirements = await prisma.requirement.findMany({
      where: { id: { in: reqIds } },
      select: {
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
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
      },
    });
    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));

    // totalPipeline per req — count ALL pipelines for that req (not just filtered subset)
    const totalPipelineByReq: Record<string, number> = {};
    for (const p of pipelines) {
      totalPipelineByReq[p.requirementId] =
        (totalPipelineByReq[p.requirementId] ?? 0) + 1;
    }

    const hiddenCandidateCols = new Set(
      (parseIds(q.hiddenCandidateCols) ?? []) as CandidateColKey[]
    );
    const candidateStageIds =
      selectedStageIds ??
      (hiddenStageIds.size > 0 ? activeStages.map((s) => s.id) : undefined);

    buildCandidateSheet(
      workbook,
      pipelines,
      reqLookup,
      {
        hiddenCols: hiddenCandidateCols,
        stageIds: candidateStageIds,
        disposition: q.disposition || undefined,
      },
      totalPipelineByReq
    );

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
// };

// ─────────────────────────────────────────────────────────────────────────────
// 2. REQUIREMENT REPORT
// GET /reports/requirements
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const standardOnly = q.standardOnly === "true";

    // Creator scope: reporting-tree BFS (intentionally separate from pipeline scope)
    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin
    );
    const requestedCreatorId = q.createdById?.trim() || null;
    const effectiveCreatorIds =
      creatorIds === null
        ? requestedCreatorId
          ? [requestedCreatorId]
          : null
        : requestedCreatorId
        ? creatorIds.includes(requestedCreatorId)
          ? [requestedCreatorId]
          : []
        : creatorIds;

    const createdByWhere =
      effectiveCreatorIds === null
        ? {}
        : { createdById: { in: effectiveCreatorIds } };
    const baseReqWhere = buildReqWhere(q, { withDateWindow: false });

    const win = resolveDateWindow(q);
    const activityWindow =
      win.gte || win.lte
        ? {
            ...(win.gte ? { gte: win.gte } : {}),
            ...(win.lte ? { lte: win.lte } : {}),
          }
        : null;
    const activityFilter = activityWindow
      ? {
          pipelines: {
            some: {
              OR: [
                { createdAt: activityWindow },
                { updatedAt: activityWindow },
                { stageHistory: { some: { createdAt: activityWindow } } },
              ],
            },
          },
        }
      : {};

    const reqWhere = { ...baseReqWhere, ...activityFilter, ...createdByWhere };

    const stages = await fetchScopedStages(q.serviceLineId);
    const stageIdSet = new Set(stages.map((s) => s.id));

    const requirements = await prisma.requirement.findMany({
      where: reqWhere,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        priority: true,
        jobType: true,
        salaryMin: true,
        salaryMax: true,
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
        _count: { select: { pipelines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    if (!requirements.length)
      return res.json({
        success: true,
        groups: [],
        meta: {
          window: windowLabel(q),
          standardOnly,
          total: 0,
          multiLine: false,
        },
      });

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

    const rows = requirements.map((r) => {
      const counts = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(counts).reduce((s, n) => s + n, 0);
      return { ...r, totalCandidates, stageCounts: counts };
    });

    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId
      );
    const byLine = new Map<string, any[]>();
    const lineMeta = new Map<string, { id: string; name: string } | null>();
    for (const r of rows) {
      const sl = r.serviceLine ?? null;
      const key = sl?.id ?? "__none__";
      if (!byLine.has(key)) {
        byLine.set(key, []);
        lineMeta.set(key, sl);
      }
      byLine.get(key)!.push(r);
    }

    const groups = [...byLine.entries()]
      .map(([key, rws]) => {
        const sl = lineMeta.get(key) ?? null;
        return {
          serviceLine: sl,
          stages: stageMetaOut(stagesForLine(sl?.id ?? null), standardOnly),
          data: rws,
          total: rws.length,
        };
      })
      .sort((a, b) => b.data.length - a.data.length);

    return res.json({
      success: true,
      groups,
      meta: {
        window: windowLabel(q),
        standardOnly,
        multiLine: groups.length > 1,
      },
    });
  } catch (err) {
    console.error("getRequirementReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement report" });
  }
};

// GET /reports/requirements/export
// Synced params: ids, serviceLineId, standardOnly,
//   stageIds      — explicit stage selection for Candidates sheet
//   hiddenStageIds — hidden stage columns → omit from Sheet 1 AND Candidates
//   disposition, clientId, status, createdById, range/hours/fromDate/toDate
export const exportRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const singleId = req.params.id ?? null;
    const selectedIds = parseIds(q.ids);
    const selectedStageIds = parseIds(q.stageIds);
    const hiddenStageIds = new Set(parseIds(q.hiddenStageIds) ?? []);
    const standardOnly = q.standardOnly === "true";

    let baseWhere: Record<string, any>;
    if (singleId) {
      baseWhere = { id: singleId, deletedAt: null };
    } else {
      const creatorIds = await resolveOrgTreeDown(
        req.user!.id,
        req.user!.isSuperAdmin
      );
      const reqFilter = buildReqWhere(q, { withDateWindow: false });
      const win = resolveDateWindow(q);
      const activityWindow =
        win.gte || win.lte
          ? {
              ...(win.gte ? { gte: win.gte } : {}),
              ...(win.lte ? { lte: win.lte } : {}),
            }
          : null;
      const activityFilter = activityWindow
        ? {
            pipelines: {
              some: {
                OR: [
                  { createdAt: activityWindow },
                  { updatedAt: activityWindow },
                  { stageHistory: { some: { createdAt: activityWindow } } },
                ],
              },
            },
          }
        : {};
      baseWhere =
        creatorIds !== null
          ? { ...reqFilter, ...activityFilter, createdById: { in: creatorIds } }
          : { ...reqFilter, ...activityFilter };
      if (selectedIds) {
        baseWhere.id = { in: selectedIds };
        delete baseWhere.pipelines;
      }
    }

    const stages = await fetchScopedStages(q.serviceLineId);
    // Remove hidden stage columns from Sheet 1
    const activeStages = (
      standardOnly ? stages.filter((s) => s.isStandard) : stages
    ).filter((s) => !hiddenStageIds.has(s.id));
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

    if (!requirements.length)
      return res
        .status(404)
        .json({ success: false, message: "No requirements found" });

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

    const pipelineWhere: Record<string, any> = {
      requirementId: { in: reqIds },
    };
    if (q.disposition) pipelineWhere.disposition = q.disposition as any;

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: PIPELINE_DETAIL_SELECT,
      orderBy: { createdAt: "asc" },
    });

    // Pre-compute grand stage totals for column headers
    const grandStageCounts: Record<string, number> = {};
    for (const r of requirements) {
      const counts = countsByReq[r.id] ?? {};
      for (const s of activeStages) {
        grandStageCounts[s.id] =
          (grandStageCounts[s.id] ?? 0) + (counts[s.id] ?? 0);
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

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
    // "Label (N)" — grand total per stage baked into column header
    const stageCols = activeStages.map((s) => ({
      header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
      key: `stage_${s.id}`,
      width: Math.max(s.label.length + 6, 14),
    }));
    sheet1.columns = [...fixedCols, ...stageCols];

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

    let grandTotal = 0,
      grandDaysOpen = 0;

    for (const r of requirements) {
      const counts = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(counts).reduce((s, n) => s + n, 0);
      const daysOpen = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86400000
      );
      grandTotal += totalCandidates;
      grandDaysOpen += daysOpen;

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
        createdBy: [r.createdBy.firstName, r.createdBy.lastName]
          .filter(Boolean)
          .join(" "),
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

    const grandStageData: Record<string, number> = {};
    for (const s of activeStages)
      grandStageData[`stage_${s.id}`] = grandStageCounts[s.id] ?? 0;
    const totalsRow1 = sheet1.addRow({
      reqCode: `TOTAL: ${requirements.length} requirements`,
      title: "",
      status: "",
      priority: "",
      client: "",
      spoc: "",
      spocEmail: "",
      bu: "",
      sl: "",
      city: "",
      country: "",
      jobType: "",
      remote: "",
      openings: requirements.reduce((s, r) => s + r.totalOpenings, 0),
      createdBy: "",
      createdAt: "",
      deletedAt: "",
      daysOpen:
        requirements.length > 0
          ? Math.round(grandDaysOpen / requirements.length)
          : 0,
      respondBy: "",
      breached: "",
      total: grandTotal,
      ...grandStageData,
    });
    styleTotalsRow(totalsRow1);
    sheet1.mergeCells(totalsRow1.number, 1, totalsRow1.number, 4);

    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: fixedCols.length + stageCols.length },
    };

    // ── Sheet 2: Candidates ───────────────────────────────────────────────────
    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));

    // totalPipeline per req — total ALL pipelines for that req
    const totalPipelineByReq: Record<string, number> = {};
    for (const p of pipelines) {
      totalPipelineByReq[p.requirementId] =
        (totalPipelineByReq[p.requirementId] ?? 0) + 1;
    }

    const hiddenCandidateCols = new Set(
      (parseIds(q.hiddenCandidateCols) ?? []) as CandidateColKey[]
    );
    const candidateStageIds =
      selectedStageIds ??
      (hiddenStageIds.size > 0 ? activeStages.map((s) => s.id) : undefined);

    buildCandidateSheet(
      workbook,
      pipelines,
      reqLookup,
      {
        hiddenCols: hiddenCandidateCols,
        stageIds: candidateStageIds,
        disposition: q.disposition || undefined,
      },
      totalPipelineByReq
    );

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
// File: exportRequirements (function only)
// Path: src/controllers/requirementsController.ts
// Drop this entire function in place of the existing exportRequirements.
// It replaces ONLY the exportRequirements function — nothing else in the file changes.

// export const exportRequirements = async (req: Request, res: Response) => {
//   try {
//     const {
//       search,
//       status,
//       buId,
//       serviceLineId,
//       clientId,
//       clientSpocId,
//       priority,
//       createdById,
//       dateFrom,
//       dateTo,
//     } = req.query as Record<string, string>;

//     const userId = req.user!.id;
//     const isSuperAdmin = req.user!.isSuperAdmin;

//     const where = await buildRequirementsWhere(
//       {
//         search,
//         status,
//         buId,
//         serviceLineId,
//         clientId,
//         clientSpocId,
//         priority,
//         createdById,
//         dateFrom,
//         dateTo,
//       },
//       userId,
//       isSuperAdmin
//     );

//     const requirements = await prisma.requirement.findMany({
//       where,
//       select: {
//         id: true,
//         reqCode: true,
//         title: true,
//         status: true,
//         priority: true,
//         jobType: true,
//         remoteType: true,
//         totalOpenings: true,
//         city: true,
//         state: true,
//         country: true,
//         respondBy: true,
//         isRespondByBreached: true,
//         isTurnaroundBreached: true,
//         createdAt: true,
//         serviceLineId: true,
//         saleValue: true,
//         salaryMin: true,
//         salaryMax: true,
//         salaryType: true,
//         salaryCurrency: true,
//         band: {
//           select: {
//             id: true,
//             code: true,
//             name: true,
//             rangeFrom: true,
//             rangeTo: true,
//             value: true,
//           },
//         },
//         client: {
//           select: { name: true, agreementType: true, percentageValue: true },
//         },
//         clientSpoc: { select: { id: true, firstName: true, lastName: true } },
//         businessUnit: { select: { name: true } },
//         serviceLine: { select: { id: true, name: true } },
//         createdBy: { select: { id: true, firstName: true, lastName: true } },
//       },
//       orderBy: { createdAt: "desc" },
//       take: 1000,
//     });

//     if (!requirements.length) {
//       return res
//         .status(404)
//         .json({ success: false, message: "No requirements found to export" });
//     }

//     const reqIds = requirements.map((r) => r.id);

//     // ── RBAC: resolve manager sets ─────────────────────────────────────────
//     const uniqueCreatorIds = [
//       ...new Set(requirements.map((r) => r.createdBy.id)),
//     ];
//     const managerSetByCreator = await resolveManagerSets(uniqueCreatorIds);

//     // ── Terminal stages ────────────────────────────────────────────────────
//     const terminalStages = await prisma.pipelineStage.findMany({
//       where: {
//         isActive: true,
//         isTerminal: true,
//         ...(serviceLineId
//           ? { OR: [{ serviceLineId: null }, { serviceLineId }] }
//           : {}),
//       },
//       select: {
//         id: true,
//         code: true,
//         label: true,
//         order: true,
//         serviceLineId: true,
//       },
//       orderBy: { order: "asc" },
//     });

//     // ── All active stages for pipeline counts ──────────────────────────────
//     const allStages = await prisma.pipelineStage.findMany({
//       where: { isActive: true },
//       select: {
//         id: true,
//         code: true,
//         label: true,
//         order: true,
//         serviceLineId: true,
//         isTerminal: true,
//       },
//       orderBy: { order: "asc" },
//     });

//     // ── Pipeline counts per requirement ────────────────────────────────────
//     const pipelineCounts = await prisma.requirementCandidatePipeline.groupBy({
//       by: ["requirementId", "currentStageId"],
//       where: { requirementId: { in: reqIds } },
//       _count: { id: true },
//     });

//     const countsByReq: Record<string, Record<string, number>> = {};
//     for (const pc of pipelineCounts) {
//       if (!countsByReq[pc.requirementId]) countsByReq[pc.requirementId] = {};
//       countsByReq[pc.requirementId][(pc as any).currentStageId] =
//         (pc as any)._count?.id ?? 0;
//     }

//     // ── Pipeline candidate rows ────────────────────────────────────────────
//     // FULL select — all CTC, all joining date fields, notice period, LWD
//     const pipelines = await prisma.requirementCandidatePipeline.findMany({
//       where: { requirementId: { in: reqIds } },
//       select: {
//         id: true,
//         requirementId: true,
//         stageUpdatedAt: true,
//         isRejected: true,
//         isWithdrawn: true,
//         isOnHold: true,
//         submittedAt: true,
//         offerStatus: true,
//         // ── CTC fields ──────────────────────────────────────────────────
//         offeredCtc: true,
//         currentCtc: true,
//         expectedCtc: true,
//         negotiatedCtc: true,
//         // ── Joining / notice fields ──────────────────────────────────────
//         actualJoiningDate: true,
//         expectedJoiningDate: true,
//         lastWorkingDate: true,
//         noticePeriod: true,
//         createdAt: true,
//         currentStage: {
//           select: {
//             code: true,
//             label: true,
//             isTerminal: true,
//             isNearTerminal: true,
//           },
//         },
//         recruiter: { select: { firstName: true, lastName: true } },
//         snapshot: {
//           select: {
//             fullName: true,
//             email: true,
//             phone: true,
//             currentTitle: true,
//             currentCompany: true,
//             totalExpYears: true,
//             topSkills: true,
//           },
//         },
//         stageHistory: { select: { timeInPrevStageMins: true } },
//       },
//       orderBy: { createdAt: "asc" },
//     });

//     const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));

//     // ─────────────────────────────────────────────────────────────────────
//     // HELPERS
//     // ─────────────────────────────────────────────────────────────────────

//     const mkFill = (argb: string): ExcelJS.Fill => ({
//       type: "pattern",
//       pattern: "solid",
//       fgColor: { argb },
//     });
//     const WHITE_FONT: Partial<ExcelJS.Font> = {
//       color: { argb: "FFFFFFFF" },
//       bold: true,
//       size: 11,
//     };
//     const FILLS = {
//       darkBlue: mkFill("FF1E3A5F"),
//       midBlue: mkFill("FF2D5986"),
//       darkGreen: mkFill("FF1A5C2A"),
//       purple: mkFill("FF4A148C"),
//       lightGreen: mkFill("FFE2EFDA"),
//       lightRed: mkFill("FFFCE4D6"),
//       lightPurple: mkFill("FFEDE7F6"),
//       lightAmber: mkFill("FFFFF3CD"),
//     };
//     const STATUS_COLORS: Record<string, string> = {
//       ACTIVE: "FF00875A",
//       CLOSED: "FFDE350B",
//       ON_HOLD: "FFFF991F",
//       PENDING_APPROVAL: "FF0052CC",
//       DRAFT: "FF6B778C",
//       CANCELLED: "FF5E6C84",
//     };

//     const applyHeader = (row: ExcelJS.Row, fill = FILLS.darkBlue) => {
//       row.eachCell((cell) => {
//         cell.fill = fill;
//         cell.font = WHITE_FONT;
//         cell.alignment = {
//           vertical: "middle",
//           horizontal: "center",
//           wrapText: true,
//         };
//         cell.border = {
//           bottom: { style: "thin", color: { argb: "FF4A90D9" } },
//         };
//       });
//       row.height = 28;
//     };

//     /** Safely convert Prisma value to Date — returns null if invalid */
//     const safeDate = (val: any): Date | null => {
//       if (!val) return null;
//       const d = val instanceof Date ? val : new Date(val);
//       return isNaN(d.getTime()) ? null : d;
//     };

//     /** Safely format a date — returns "" on any failure */
//     const safeFormat = (val: any, fmt: string): string => {
//       const d = safeDate(val);
//       if (!d) return "";
//       try {
//         // Manual format to avoid date-fns issues in some Node environments
//         const pad = (n: number) => String(n).padStart(2, "0");
//         const MONTHS = [
//           "Jan",
//           "Feb",
//           "Mar",
//           "Apr",
//           "May",
//           "Jun",
//           "Jul",
//           "Aug",
//           "Sep",
//           "Oct",
//           "Nov",
//           "Dec",
//         ];
//         const MONTHS_FULL = [
//           "January",
//           "February",
//           "March",
//           "April",
//           "May",
//           "June",
//           "July",
//           "August",
//           "September",
//           "October",
//           "November",
//           "December",
//         ];
//         if (fmt === "dd-mmm-yyyy" || fmt === "dd-MMM-yyyy") {
//           return `${pad(d.getDate())}-${
//             MONTHS[d.getMonth()]
//           }-${d.getFullYear()}`;
//         }
//         if (fmt === "MMMM yyyy") {
//           return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
//         }
//         if (fmt === "yyyy-MM-dd") {
//           return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
//             d.getDate()
//           )}`;
//         }
//         return d.toLocaleDateString("en-IN");
//       } catch {
//         return "";
//       }
//     };

//     /** Derive joining date: actual → expected → lastWorkingDate → notice period from today */
//     const deriveJoiningDate = (
//       actualJoiningDate: any,
//       expectedJoiningDate: any,
//       lastWorkingDate: any,
//       noticePeriod: string | null
//     ): Date | null => {
//       const actual = safeDate(actualJoiningDate);
//       if (actual) return actual;
//       const expected = safeDate(expectedJoiningDate);
//       if (expected) return expected;
//       const lwd = safeDate(lastWorkingDate);
//       if (lwd) return lwd;
//       if (noticePeriod) {
//         const lower = noticePeriod.toLowerCase().trim();
//         const numMatch = lower.match(/^(\d+)/);
//         const num = numMatch ? parseInt(numMatch[1], 10) : null;
//         if (num != null) {
//           const base = new Date();
//           if (lower.includes("month")) {
//             base.setMonth(base.getMonth() + num);
//             return base;
//           }
//           base.setDate(base.getDate() + num);
//           return base;
//         }
//       }
//       return null;
//     };

//     const formatAging = (mins: number): string => {
//       if (mins < 60) return `${mins}m`;
//       if (mins < 1440) return `${Math.floor(mins / 60)}h`;
//       if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
//       if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
//       return `${Math.floor(mins / 43800)}mo`;
//     };

//     // ─────────────────────────────────────────────────────────────────────
//     // WORKBOOK
//     // ─────────────────────────────────────────────────────────────────────

//     const workbook = new ExcelJS.Workbook();
//     workbook.creator = "TalentOS";
//     workbook.created = new Date();

//     // ═════════════════════════════════════════════════════════════════════
//     // SHEET 1 — Requirements
//     // ═════════════════════════════════════════════════════════════════════
//     const sheet1 = workbook.addWorksheet("Requirements", {
//       views: [{ state: "frozen", ySplit: 2 }],
//     });

//     const fixedCols = [
//       { header: "Req Code", key: "reqCode", width: 14 },
//       { header: "Title", key: "title", width: 38 },
//       { header: "Status", key: "status", width: 16 },
//       { header: "Priority", key: "priority", width: 12 },
//       { header: "Client", key: "client", width: 24 },
//       { header: "Client SPOC", key: "spoc", width: 22 },
//       { header: "Agreement", key: "agreementType", width: 14 },
//       { header: "Business Unit", key: "bu", width: 22 },
//       { header: "Service Line", key: "sl", width: 20 },
//       { header: "City", key: "city", width: 16 },
//       { header: "Country", key: "country", width: 14 },
//       { header: "Job Type", key: "jobType", width: 16 },
//       { header: "Remote", key: "remote", width: 12 },
//       { header: "Total Openings", key: "openings", width: 14 },
//       { header: "Created By", key: "createdBy", width: 22 },
//       { header: "Created Date", key: "createdAt", width: 18 },
//       { header: "Days Open", key: "daysOpen", width: 12 },
//       { header: "Respond By", key: "respondBy", width: 18 },
//       { header: "SLA Breached?", key: "breached", width: 14 },
//       { header: "Total Funnel", key: "totalFunnel", width: 14 },
//     ];

//     const saleValueCols = [
//       { header: "Band Code", key: "bandCode", width: 12 },
//       { header: "Band Name", key: "bandName", width: 18 },
//       { header: "Band Range", key: "bandRange", width: 20 },
//       { header: "Band Value", key: "bandValue", width: 14 },
//       { header: "Client %", key: "clientPct", width: 12 },
//       { header: "Salary Min", key: "salaryMin", width: 14 },
//       { header: "Salary Max", key: "salaryMax", width: 14 },
//       { header: "Req. Sale Value", key: "reqSaleValue", width: 16 },
//       { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
//       { header: "Sale Basis", key: "saleValueBasis", width: 18 },
//     ];

//     const achievedCols = [
//       ...terminalStages.map((s) => ({
//         header: `Achieved: ${s.label}`,
//         key: `term_${s.id}`,
//         width: 18,
//       })),
//       { header: "Achieved (Headcount)", key: "terminalCount", width: 22 },
//       { header: "Achieved %", key: "achievedPct", width: 14 },
//       { header: "Achieved Value", key: "achievedValue", width: 20 },
//     ];

//     sheet1.columns = [...fixedCols, ...saleValueCols, ...achievedCols];

//     const nFixed = fixedCols.length;
//     const nSale = saleValueCols.length;
//     const nAchieved = achievedCols.length;

//     const groupRow = sheet1.getRow(1);
//     groupRow.getCell(1).value = "Requirement Details";
//     groupRow.getCell(nFixed + 1).value = "Sale Value (Creator / Manager Only)";
//     groupRow.getCell(nFixed + nSale + 1).value = "Achieved (Terminal Stages)";
//     sheet1.mergeCells(1, 1, 1, nFixed);
//     sheet1.mergeCells(1, nFixed + 1, 1, nFixed + nSale);
//     if (nAchieved > 0)
//       sheet1.mergeCells(1, nFixed + nSale + 1, 1, nFixed + nSale + nAchieved);
//     applyHeader(groupRow);
//     groupRow.getCell(nFixed + 1).fill = FILLS.darkGreen;
//     groupRow.getCell(nFixed + nSale + 1).fill = FILLS.purple;

//     const colHeaderRow = sheet1.getRow(2);
//     [...fixedCols, ...saleValueCols, ...achievedCols].forEach((col, i) => {
//       colHeaderRow.getCell(i + 1).value = col.header;
//     });
//     applyHeader(colHeaderRow, FILLS.midBlue);

//     const now = Date.now();
//     let exportTotalSaleValue = 0;
//     let exportTotalAchieved = 0;
//     let exportOmittedCount = 0;

//     for (const r of requirements) {
//       const daysOpen = Math.floor(
//         (now - new Date(r.createdAt).getTime()) / 86400000
//       );

//       const canSeeSale =
//         isSuperAdmin ||
//         userId === r.createdBy.id ||
//         (managerSetByCreator[r.createdBy.id]?.has(userId) ?? false);

//       const band = r.band
//         ? {
//             value: r.band.value != null ? Number(r.band.value) : null,
//             rangeFrom:
//               r.band.rangeFrom != null ? Number(r.band.rangeFrom) : null,
//             rangeTo: r.band.rangeTo != null ? Number(r.band.rangeTo) : null,
//           }
//         : null;
//       const clientPct =
//         r.client?.percentageValue != null
//           ? Number(r.client.percentageValue)
//           : null;

//       const { computedSaleValue, saleValueBasis } = computeSaleValue({
//         saleValue: r.saleValue,
//         totalOpenings: r.totalOpenings,
//         salaryMin: r.salaryMin,
//         band: band ? { value: band.value } : null,
//         client: { percentageValue: clientPct },
//       });

//       if (computedSaleValue != null) exportTotalSaleValue += computedSaleValue;
//       else exportOmittedCount++;

//       const reqStageCounts = countsByReq[r.id] ?? {};
//       const totalFunnel = Object.values(reqStageCounts).reduce(
//         (s, n) => s + n,
//         0
//       );

//       const termCountPerStage: Record<string, number> = {};
//       let terminalTotal = 0;
//       for (const ts of terminalStages) {
//         if (ts.serviceLineId && ts.serviceLineId !== r.serviceLineId) {
//           termCountPerStage[ts.id] = 0;
//           continue;
//         }
//         const cnt = reqStageCounts[ts.id] ?? 0;
//         termCountPerStage[ts.id] = cnt;
//         terminalTotal += cnt;
//       }

//       const achievedPct =
//         r.totalOpenings > 0
//           ? Math.min(100, (terminalTotal / r.totalOpenings) * 100)
//           : 0;
//       const achievedValue =
//         computedSaleValue != null && r.totalOpenings > 0
//           ? (terminalTotal / r.totalOpenings) * computedSaleValue
//           : null;
//       if (achievedValue != null) exportTotalAchieved += achievedValue;

//       const rowData: Record<string, any> = {
//         reqCode: r.reqCode,
//         title: r.title,
//         status: r.status,
//         priority: r.priority,
//         client: r.client?.name ?? "",
//         spoc: r.clientSpoc
//           ? `${r.clientSpoc.firstName} ${r.clientSpoc.lastName}`
//           : "",
//         agreementType: r.client?.agreementType ?? "",
//         bu: r.businessUnit?.name ?? "",
//         sl: r.serviceLine?.name ?? "",
//         city: r.city ?? "",
//         country: r.country ?? "",
//         jobType: r.jobType,
//         remote: r.remoteType,
//         openings: r.totalOpenings,
//         createdBy: `${r.createdBy.firstName} ${r.createdBy.lastName}`,
//         createdAt: new Date(r.createdAt),
//         daysOpen,
//         respondBy: r.respondBy ? new Date(r.respondBy) : "",
//         breached:
//           r.isRespondByBreached || r.isTurnaroundBreached ? "Yes" : "No",
//         totalFunnel,
//         // Sale value — RBAC gated
//         bandCode: canSeeSale ? r.band?.code ?? "" : "—",
//         bandName: canSeeSale ? r.band?.name ?? "" : "—",
//         bandRange:
//           canSeeSale && band?.rangeFrom != null && band?.rangeTo != null
//             ? `${band.rangeFrom} – ${band.rangeTo}`
//             : canSeeSale
//             ? ""
//             : "—",
//         bandValue: canSeeSale ? band?.value ?? "" : "—",
//         clientPct: canSeeSale ? clientPct ?? "" : "—",
//         salaryMin: canSeeSale
//           ? r.salaryMin != null
//             ? Number(r.salaryMin)
//             : ""
//           : "—",
//         salaryMax: canSeeSale
//           ? r.salaryMax != null
//             ? Number(r.salaryMax)
//             : ""
//           : "—",
//         reqSaleValue: canSeeSale
//           ? r.saleValue != null
//             ? Number(r.saleValue)
//             : ""
//           : "—",
//         computedSaleValue: computedSaleValue ?? "",
//         saleValueBasis: canSeeSale ? saleValueBasis ?? "N/A" : "—",
//         // Achieved — everyone sees
//         ...Object.fromEntries(
//           terminalStages.map((ts) => [
//             `term_${ts.id}`,
//             termCountPerStage[ts.id] ?? 0,
//           ])
//         ),
//         terminalCount: terminalTotal,
//         achievedPct: Math.round(achievedPct * 10) / 10,
//         achievedValue: achievedValue ?? "",
//       };

//       const dataRow = sheet1.addRow(rowData);
//       dataRow.height = 20;
//       dataRow.getCell("createdAt").numFmt = "dd-mmm-yyyy";
//       if (r.respondBy) dataRow.getCell("respondBy").numFmt = "dd-mmm-yyyy";

//       const sCls = STATUS_COLORS[r.status];
//       if (sCls) {
//         dataRow.getCell("status").fill = mkFill(sCls);
//         dataRow.getCell("status").font = {
//           color: { argb: "FFFFFFFF" },
//           bold: true,
//         };
//       }
//       if (r.isRespondByBreached || r.isTurnaroundBreached) {
//         dataRow.getCell("breached").fill = mkFill("FFDE350B");
//         dataRow.getCell("breached").font = {
//           color: { argb: "FFFFFFFF" },
//           bold: true,
//         };
//       }
//       if (computedSaleValue != null) {
//         dataRow.getCell("computedSaleValue").fill = FILLS.lightGreen;
//         dataRow.getCell("computedSaleValue").font = { bold: true };
//         dataRow.getCell("computedSaleValue").numFmt = "#,##0.00";
//       } else {
//         dataRow.getCell("computedSaleValue").fill = FILLS.lightRed;
//         dataRow.getCell("computedSaleValue").font = {
//           color: { argb: "FFDE350B" },
//         };
//       }
//       if (achievedValue != null && achievedValue > 0) {
//         dataRow.getCell("achievedValue").fill = FILLS.lightPurple;
//         dataRow.getCell("achievedValue").font = { bold: true };
//         dataRow.getCell("achievedValue").numFmt = "#,##0.00";
//       }
//       if (achievedPct >= 100) {
//         dataRow.getCell("achievedPct").fill = mkFill("FF00875A");
//         dataRow.getCell("achievedPct").font = {
//           color: { argb: "FFFFFFFF" },
//           bold: true,
//         };
//       } else if (achievedPct >= 50) {
//         dataRow.getCell("achievedPct").fill = mkFill("FFFFE082");
//       }
//       if (!canSeeSale) {
//         [
//           "bandCode",
//           "bandName",
//           "bandRange",
//           "bandValue",
//           "clientPct",
//           "salaryMin",
//           "salaryMax",
//           "reqSaleValue",
//           "saleValueBasis",
//         ].forEach((k) => {
//           dataRow.getCell(k).font = {
//             color: { argb: "FFBDBDBD" },
//             italic: true,
//           };
//         });
//       }
//     }

//     // Summary row
//     const summaryRow = sheet1.addRow({});
//     summaryRow.height = 24;
//     const svColIdx =
//       [...fixedCols, ...saleValueCols].findIndex(
//         (c) => c.key === "computedSaleValue"
//       ) + 1;
//     const achValColIdx = nFixed + nSale + terminalStages.length + 3;
//     summaryRow.getCell(svColIdx - 1).value = `Total (${
//       requirements.length - exportOmittedCount
//     } computed, ${exportOmittedCount} no data)`;
//     summaryRow.getCell(svColIdx - 1).font = {
//       bold: true,
//       italic: true,
//       size: 10,
//       color: { argb: "FF1E3A5F" },
//     };
//     summaryRow.getCell(svColIdx).value = exportTotalSaleValue;
//     summaryRow.getCell(svColIdx).numFmt = "#,##0.00";
//     summaryRow.getCell(svColIdx).font = {
//       bold: true,
//       color: { argb: "FF1A5C2A" },
//     };
//     summaryRow.getCell(svColIdx).fill = FILLS.lightGreen;
//     summaryRow.getCell(achValColIdx).value = exportTotalAchieved;
//     summaryRow.getCell(achValColIdx).numFmt = "#,##0.00";
//     summaryRow.getCell(achValColIdx).font = {
//       bold: true,
//       color: { argb: "FF4A148C" },
//     };
//     summaryRow.getCell(achValColIdx).fill = FILLS.lightPurple;

//     sheet1.autoFilter = {
//       from: { row: 2, column: 1 },
//       to: { row: 2, column: nFixed + nSale + nAchieved },
//     };

//     // ═════════════════════════════════════════════════════════════════════
//     // SHEET 2 — Candidates (one row per pipeline entry)
//     // All CTC fields, all joining date fields, Month of Joining, Days to Join
//     // Sale value context from the requirement
//     // ═════════════════════════════════════════════════════════════════════
//     const sheet2 = workbook.addWorksheet("Candidates", {
//       views: [{ state: "frozen", ySplit: 1 }],
//     });

//     sheet2.columns = [
//       // Requirement context
//       { header: "Req Code", key: "reqCode", width: 14 },
//       { header: "Requirement Title", key: "reqTitle", width: 36 },
//       { header: "Service Line", key: "reqSL", width: 18 },
//       { header: "Client", key: "reqClient", width: 22 },
//       // Candidate
//       { header: "Candidate Name", key: "name", width: 26 },
//       { header: "Email", key: "email", width: 30 },
//       { header: "Phone", key: "phone", width: 16 },
//       { header: "Current Title", key: "title", width: 26 },
//       { header: "Current Company", key: "company", width: 24 },
//       { header: "Exp (yrs)", key: "exp", width: 10 },
//       { header: "Top Skills", key: "skills", width: 40 },
//       // Pipeline
//       { header: "Current Stage", key: "stage", width: 22 },
//       { header: "Is Terminal?", key: "isTerminal", width: 12 },
//       { header: "Is Near Terminal?", key: "isNearTerminal", width: 14 },
//       { header: "Status", key: "status", width: 12 },
//       { header: "Recruiter", key: "recruiter", width: 22 },
//       { header: "Added On", key: "addedOn", width: 16 },
//       { header: "Days in Pipeline", key: "pipelineDays", width: 16 },
//       { header: "Stage Aging", key: "stageAging", width: 14 },
//       { header: "Rejected?", key: "rejected", width: 10 },
//       { header: "Withdrawn?", key: "withdrawn", width: 10 },
//       { header: "On Hold?", key: "onHold", width: 10 },
//       // Offer / submission
//       { header: "Submitted At", key: "submittedAt", width: 18 },
//       { header: "Offer Status", key: "offerStatus", width: 14 },
//       // CTC — all four
//       { header: "Current CTC", key: "currentCtc", width: 14 },
//       { header: "Expected CTC", key: "expectedCtc", width: 14 },
//       { header: "Negotiated CTC", key: "negotiatedCtc", width: 14 },
//       { header: "Offered CTC", key: "offeredCtc", width: 14 },
//       // Joining timeline
//       { header: "Notice Period", key: "noticePeriod", width: 14 },
//       { header: "Last Working Day", key: "lastWorkingDay", width: 16 },
//       { header: "Expected Joining", key: "expectedJoining", width: 16 },
//       { header: "Actual Joining", key: "actualJoining", width: 16 },
//       { header: "Derived Joining", key: "derivedJoining", width: 16 },
//       { header: "Month of Joining", key: "monthOfJoining", width: 16 },
//       { header: "Days to Join", key: "daysToJoin", width: 12 },
//       // Req sale value context (everyone sees computed; others RBAC-gated)
//       { header: "Req Salary Min", key: "reqSalaryMin", width: 14 },
//       { header: "Req Salary Max", key: "reqSalaryMax", width: 14 },
//       { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
//       { header: "Sale Basis", key: "saleValueBasis", width: 16 },
//     ];

//     applyHeader(sheet2.getRow(1));

//     for (const p of pipelines as any[]) {
//       const r = reqLookup[p.requirementId];
//       if (!r) continue;

//       const stageAgeMins = Math.floor(
//         (now - new Date(p.stageUpdatedAt).getTime()) / 60000
//       );
//       const totalPipelineMins =
//         (p.stageHistory ?? []).reduce(
//           (sum: number, log: any) => sum + (log.timeInPrevStageMins ?? 0),
//           0
//         ) + stageAgeMins;

//       // ── Derive joining date using all available fields ─────────────────
//       const derivedJoining = deriveJoiningDate(
//         p.actualJoiningDate,
//         p.expectedJoiningDate,
//         p.lastWorkingDate,
//         p.noticePeriod
//       );
//       const monthOfJoining = safeFormat(derivedJoining, "MMMM yyyy");
//       const daysToJoin = derivedJoining
//         ? Math.max(0, Math.floor((derivedJoining.getTime() - now) / 86400000))
//         : "";

//       // ── Sale value for this requirement ────────────────────────────────
//       const canSeeSale =
//         isSuperAdmin ||
//         userId === r.createdBy.id ||
//         (managerSetByCreator[r.createdBy.id]?.has(userId) ?? false);

//       const { computedSaleValue, saleValueBasis } = computeSaleValue({
//         saleValue: r.saleValue,
//         totalOpenings: r.totalOpenings,
//         salaryMin: r.salaryMin,
//         band: r.band
//           ? { value: r.band.value != null ? Number(r.band.value) : null }
//           : null,
//         client: r.client
//           ? {
//               percentageValue:
//                 r.client.percentageValue != null
//                   ? Number(r.client.percentageValue)
//                   : null,
//             }
//           : null,
//       });

//       const candidateStatus = p.currentStage?.isTerminal
//         ? "Placed"
//         : p.currentStage?.isNearTerminal
//         ? "Near Terminal"
//         : p.isRejected
//         ? "Rejected"
//         : p.isWithdrawn
//         ? "Withdrawn"
//         : p.isOnHold
//         ? "On Hold"
//         : "Active";

//       const dataRow = sheet2.addRow({
//         reqCode: r.reqCode,
//         reqTitle: r.title,
//         reqSL: r.serviceLine?.name ?? "",
//         reqClient: r.client?.name ?? "",
//         name: p.snapshot?.fullName ?? "",
//         email: p.snapshot?.email ?? "",
//         phone: p.snapshot?.phone ?? "",
//         title: p.snapshot?.currentTitle ?? "",
//         company: p.snapshot?.currentCompany ?? "",
//         exp: p.snapshot?.totalExpYears ?? "",
//         skills: Array.isArray(p.snapshot?.topSkills)
//           ? p.snapshot.topSkills.join(", ")
//           : p.snapshot?.topSkills ?? "",
//         stage: p.currentStage?.label ?? "",
//         isTerminal: p.currentStage?.isTerminal ? "Yes" : "No",
//         isNearTerminal: p.currentStage?.isNearTerminal ? "Yes" : "No",
//         status: candidateStatus,
//         recruiter: p.recruiter
//           ? `${p.recruiter.firstName} ${p.recruiter.lastName}`
//           : "",
//         addedOn: new Date(p.createdAt),
//         pipelineDays: Math.floor(totalPipelineMins / 1440),
//         stageAging: formatAging(stageAgeMins),
//         rejected: p.isRejected ? "Yes" : "No",
//         withdrawn: p.isWithdrawn ? "Yes" : "No",
//         onHold: p.isOnHold ? "Yes" : "No",
//         submittedAt: safeDate(p.submittedAt) ?? "",
//         offerStatus: p.offerStatus ?? "",
//         // CTC — all four fields
//         currentCtc: p.currentCtc != null ? Number(p.currentCtc) : "",
//         expectedCtc: p.expectedCtc != null ? Number(p.expectedCtc) : "",
//         negotiatedCtc: p.negotiatedCtc != null ? Number(p.negotiatedCtc) : "",
//         offeredCtc: p.offeredCtc != null ? Number(p.offeredCtc) : "",
//         // Joining timeline — all four sources + derived
//         noticePeriod: p.noticePeriod ?? "",
//         lastWorkingDay: safeDate(p.lastWorkingDate) ?? "",
//         expectedJoining: safeDate(p.expectedJoiningDate) ?? "",
//         actualJoining: safeDate(p.actualJoiningDate) ?? "",
//         derivedJoining: derivedJoining ?? "",
//         monthOfJoining,
//         daysToJoin,
//         // Sale value context
//         reqSalaryMin:
//           canSeeSale && r.salaryMin != null ? Number(r.salaryMin) : "",
//         reqSalaryMax:
//           canSeeSale && r.salaryMax != null ? Number(r.salaryMax) : "",
//         computedSaleValue: computedSaleValue ?? "",
//         saleValueBasis:
//           computedSaleValue != null ? saleValueBasis : "NOT_FOUND",
//       });

//       dataRow.height = 18;

//       // Date formatting
//       dataRow.getCell("addedOn").numFmt = "dd-mmm-yyyy";
//       if (safeDate(p.submittedAt))
//         dataRow.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
//       if (safeDate(p.lastWorkingDate))
//         dataRow.getCell("lastWorkingDay").numFmt = "dd-mmm-yyyy";
//       if (safeDate(p.expectedJoiningDate))
//         dataRow.getCell("expectedJoining").numFmt = "dd-mmm-yyyy";
//       if (safeDate(p.actualJoiningDate))
//         dataRow.getCell("actualJoining").numFmt = "dd-mmm-yyyy";
//       if (derivedJoining)
//         dataRow.getCell("derivedJoining").numFmt = "dd-mmm-yyyy";

//       // Terminal rows — green
//       if (p.currentStage?.isTerminal) {
//         ["stage", "isTerminal", "status"].forEach((k) => {
//           dataRow.getCell(k).fill = FILLS.lightGreen;
//           dataRow.getCell(k).font = { bold: true, color: { argb: "FF1A5C2A" } };
//         });
//         if (monthOfJoining) {
//           dataRow.getCell("monthOfJoining").fill = FILLS.lightGreen;
//           dataRow.getCell("monthOfJoining").font = {
//             bold: true,
//             color: { argb: "FF1A5C2A" },
//           };
//         }
//       }

//       // Near terminal — amber
//       if (p.currentStage?.isNearTerminal && !p.currentStage?.isTerminal) {
//         ["stage", "isNearTerminal", "status"].forEach((k) => {
//           dataRow.getCell(k).fill = FILLS.lightAmber;
//           dataRow.getCell(k).font = { bold: true };
//         });
//       }

//       // Rejected/withdrawn — grey out
//       if (p.isRejected || p.isWithdrawn) {
//         dataRow.eachCell((cell) => {
//           cell.font = { ...cell.font, color: { argb: "FF9E9E9E" } };
//         });
//       }

//       // Sale value cell styling
//       if (computedSaleValue != null) {
//         dataRow.getCell("computedSaleValue").fill = FILLS.lightGreen;
//         dataRow.getCell("computedSaleValue").font = { bold: true };
//         dataRow.getCell("computedSaleValue").numFmt = "#,##0.00";
//       }
//     }

//     sheet2.autoFilter = {
//       from: { row: 1, column: 1 },
//       to: { row: 1, column: sheet2.columnCount },
//     };

//     // ─────────────────────────────────────────────────────────────────────
//     // Stream
//     // ─────────────────────────────────────────────────────────────────────
//     const dateStr = new Date().toISOString().split("T")[0];
//     const filename = `requirements-export-${dateStr}.xlsx`;
//     res.setHeader(
//       "Content-Type",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//     );
//     res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
//     await workbook.xlsx.write(res);
//     res.end();
//   } catch (err) {
//     console.error("exportRequirements:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to export requirements" });
//   }
// };
// ─────────────────────────────────────────────────────────────────────────────
// 3. CANDIDATE FUNNEL REPORT
// GET /reports/candidates
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidateReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const reqWhere = buildReqWhere(q);
    const scopedUserIds = resolveScopedUserIds(req); // !! sync
    const stages = await fetchScopedStages(q.serviceLineId);

    const where: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null) where.recruiterId = { in: scopedUserIds };
    if (q.stageId) where.currentStageId = q.stageId;
    if (q.disposition) where.disposition = q.disposition as any;

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
    const scopedUserIds = resolveScopedUserIds(req); // !! sync
    const selectedStageIds = parseIds(q.stageIds);

    const where: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null) where.recruiterId = { in: scopedUserIds };
    if (q.stageId) where.currentStageId = q.stageId; // single-stage drill
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

    const totalPipelineByReq: Record<string, number> = {};
    for (const p of pipelines) {
      totalPipelineByReq[p.requirementId] =
        (totalPipelineByReq[p.requirementId] ?? 0) + 1;
    }

    const hiddenCandidateCols = new Set(
      (parseIds(q.hiddenCandidateCols) ?? []) as CandidateColKey[]
    );
    buildCandidateSheet(
      workbook,
      pipelines,
      reqLookup,
      {
        hiddenCols: hiddenCandidateCols,
        stageIds: selectedStageIds ?? undefined,
        disposition: q.disposition || undefined,
      },
      totalPipelineByReq
    );

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
