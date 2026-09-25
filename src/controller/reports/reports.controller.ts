// File: reports.controller.ts
// Path: src/controller/reports/reports.controller.ts

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// MOJ HELPERS — single source of truth
// mojMonth = "2025-09" → monthOfJoining = "September 2025" (stored string)
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function mojMonthToLabel(mojMonth: string): string | null {
  const parts = mojMonth.split("-");
  const year = parts[0];
  const monthIdx = parseInt(parts[1] ?? "0", 10) - 1;
  if (!year || monthIdx < 0 || monthIdx > 11) return null;
  return `${MONTH_NAMES[monthIdx]} ${year}`;
}

export function buildMojWhere(
  q: Record<string, string | string[] | undefined>,
): Record<string, any> | null {
  const rawMoj = q.mojMonth;
  const mojMonths: string[] = Array.isArray(rawMoj)
    ? rawMoj
    : rawMoj
      ? [rawMoj]
      : [];
  const mojYear = Array.isArray(q.mojYear) ? q.mojYear[0] : (q.mojYear ?? null);
  if (mojMonths.length === 1) return { monthOfJoining: mojMonths[0] };
  if (mojMonths.length > 1)
    return {
      OR: mojMonths.map((m) => ({ monthOfJoining: { startsWith: m } })),
    };
  if (mojYear) return { monthOfJoining: { startsWith: mojYear } };
  return null;
}

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

function prismaIn(v: string | string[] | undefined) {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.length) return undefined;
  return arr.length === 1 ? arr[0] : { in: arr };
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
// ─────────────────────────────────────────────────────────────────────────────

function resolveScopedUserIds(req: Request): string[] | null {
  const scope = req.scopeFilter;
  if (!scope || scope.type === "ALL") return null;

  switch (scope.type) {
    case "OWN":
      return [scope.userId!];
    case "TEAM":
      return scope.teamMemberIds ?? [scope.userId!];
    case "REPORTING":
      return scope.subordinateIds ?? [scope.userId!];
    case "REPORTING_LINE":
      return scope.reportingLineIds ?? [scope.userId!];
    case "BU":
      return scope.subordinateIds ?? [scope.userId!];
    case "DEPARTMENT":
      return [scope.userId!];
    default:
      return [scope.userId!];
  }
}

export async function resolveOrgTreeDown(
  userId: string,
  isSuperAdmin: boolean,
): Promise<string[] | null> {
  if (isSuperAdmin) return null;
  const visited = new Set<string>([userId]);
  let frontier = [userId];
  while (frontier.length > 0) {
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

function toSingleQ(
  q: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-VALUE QUERY PARAM HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function toArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function toPrismaFilter(
  val: string | string[] | undefined,
): string | { in: string[] } | undefined {
  const arr = toArray(val);
  if (arr.length === 0) return undefined;
  if (arr.length === 1) return arr[0];
  return { in: arr };
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT WHERE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildReqWhere(
  q: Record<string, string | string[] | undefined>,
  opts: { withDateWindow?: boolean } = {},
): Record<string, any> {
  const { withDateWindow = true } = opts;
  const where: Record<string, any> = { deletedAt: null };

  const clientFilter = toPrismaFilter(q.clientId);
  if (clientFilter) where.clientId = clientFilter;

  const spocFilter = toPrismaFilter(q.clientSpocId);
  if (spocFilter) where.clientSpocId = spocFilter;

  const slFilter = toPrismaFilter(q.serviceLineId);
  if (slFilter) where.serviceLineId = slFilter;

  const buFilter = toPrismaFilter(q.businessUnitId);
  if (buFilter) where.businessUnitId = buFilter;

  const statusArr = toArray(q.status);
  if (statusArr.length === 1) where.status = statusArr[0];
  else if (statusArr.length > 1) where.status = { in: statusArr };

  const priorityFilter = toPrismaFilter(q.priority);
  if (priorityFilter) where.priority = priorityFilter;

  // ── CSM / creator filter ──────────────────────────────────────────────────
  // On Recruiters tab: filter requirements created by this CSM, then show
  // which recruiters worked those requirements.
  // On Requirements tab: filter requirements by who created them.
  const createdByFilter = toPrismaFilter(q.createdById);
  if (createdByFilter) where.createdById = createdByFilter;

  if (withDateWindow) {
    const singleQ = Object.fromEntries(
      Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    ) as Record<string, string | undefined>;
    const win = resolveDateWindow(singleQ);
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
  isNearTerminal: true,
  pipeline: true,
  canonicalStage: true,
  serviceLineId: true,
  serviceLine: { select: { id: true, name: true } },
} as const;

async function fetchScopedStages(serviceLineId?: string | string[]) {
  const ids = toArray(serviceLineId);
  const where: Record<string, any> = { isActive: true };
  if (ids.length > 0) {
    where.OR = [
      { serviceLineId: null },
      ids.length === 1
        ? { serviceLineId: ids[0] }
        : { serviceLineId: { in: ids } },
    ];
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
  monthOfJoining: true,
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
      isTerminal: true,
      isNearTerminal: true,
      pipeline: true,
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
// ALL CANDIDATE COLUMNS
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CANDIDATE_COLS = [
  { key: "reqCode", header: "Req Code", width: 14, group: "requirement" },
  { key: "reqTitle", header: "Requirement", width: 34, group: "requirement" },
  {
    key: "totalPipeline",
    header: "Total Pipeline",
    width: 14,
    group: "requirement",
  },
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
  { key: "name", header: "Candidate Name", width: 26, group: "candidate" },
  { key: "email", header: "Email", width: 30, group: "candidate" },
  { key: "phone", header: "Phone", width: 16, group: "candidate" },
  { key: "title", header: "Current Title", width: 24, group: "candidate" },
  { key: "company", header: "Current Company", width: 22, group: "candidate" },
  { key: "exp", header: "Exp (yrs)", width: 10, group: "candidate" },
  { key: "skills", header: "Top Skills", width: 34, group: "candidate" },
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
  { key: "currentCtc", header: "Current CTC", width: 14, group: "ctc" },
  { key: "expectedCtc", header: "Expected CTC", width: 14, group: "ctc" },
  { key: "negotiatedCtc", header: "Negotiated CTC", width: 14, group: "ctc" },
  { key: "offeredCtc", header: "Offered CTC", width: 14, group: "ctc" },
  { key: "currency", header: "Currency", width: 10, group: "ctc" },
  { key: "salaryType", header: "Salary Type", width: 12, group: "ctc" },
  { key: "noticePeriod", header: "Notice Period", width: 14, group: "joining" },
  { key: "lwd", header: "Last Working Day", width: 16, group: "joining" },
  {
    key: "monthOfJoining",
    header: "Month of Joining",
    width: 16,
    group: "joining",
  },
  { key: "rejected", header: "Rejected?", width: 10, group: "flags" },
  { key: "withdrawn", header: "Withdrawn?", width: 10, group: "flags" },
  { key: "onHold", header: "On Hold?", width: 10, group: "flags" },
  { key: "reqCreated", header: "Req Created", width: 16, group: "audit" },
  { key: "reqDeleted", header: "Req Deleted", width: 16, group: "audit" },
] as const;

type CandidateColKey = (typeof ALL_CANDIDATE_COLS)[number]["key"];

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE SHEET BUILDER
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
  totalPipelineByReq: Record<string, number> = {},
) {
  const hidden = opts.hiddenCols ?? new Set<CandidateColKey>();
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
      (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
    );
    const totalMins =
      (p.stageHistory ?? []).reduce(
        (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
        0,
      ) + stageAgeMins;
    const pipelineDays = Math.floor(totalMins / 1440);

    totalRows++;
    totalPipelineDays += pipelineDays;
    dispositionCount[p.disposition] =
      (dispositionCount[p.disposition] ?? 0) + 1;

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
    if (has("monthOfJoining")) rowData.monthOfJoining = p.monthOfJoining ?? "";
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

  const dispositionSummary = Object.entries(dispositionCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");

  const totalsData: Record<string, any> = {};
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

function parseIds(raw?: string | string[]): string[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const arr = raw.map((s) => s.trim()).filter(Boolean);
    return arr.length ? [...new Set(arr)] : null;
  }
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
    const q = req.query as Record<string, string | string[] | undefined>;
    const win = resolveDateWindow(toSingleQ(q));
    const scopedUserIds = resolveScopedUserIds(req);

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
      stages.map((s) => [s.id, 0]),
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
        (s) => s.serviceLineId === null || s.serviceLineId === lineId,
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
      (a, b) => b.total - a.total,
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
        window: windowLabel(toSingleQ(q)),
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
    placed: number;
    nearTerminal: number;
    offPipeline: number;
    inPipeline: number;
    stageCounts: Record<string, number>;
  };

  type RecAgg = {
    id: string;
    name: string;
    email: string;
    sourced: number;
    submitted: number;
    offered: number;
    placed: number;
    nearTerminal: number;
    offPipeline: number;
    inPipeline: number;
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

    const stage = p.currentStage;
    if (stage?.isTerminal) r.placed++;
    else if (stage?.isNearTerminal) r.nearTerminal++;
    else if (stage?.pipeline === false) r.offPipeline++;
    else r.inPipeline++;

    if (p.submittedAt)
      r.submitTimeMins.push(
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0,
        ),
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

export const RECRUITER_EXPORT_FIXED_RIGHT = [
  { header: "Offered", key: "offered", width: 12 },
  { header: "Placed", key: "placed", width: 12 },
  { header: "Near Close", key: "nearTerminal", width: 14 },
  { header: "In Pipeline", key: "inPipeline", width: 14 },
  { header: "Off Pipeline", key: "offPipeline", width: 14 },
  { header: "Avg Days to Submit", key: "avgDays", width: 18 },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const { recruiterId, requirementId } = q;
    const standardOnly = q.standardOnly === "true";

    const scopedUserIds = resolveScopedUserIds(req);

    let recruiterFilter: Record<string, any> = {};

    if (recruiterId) {
      if (
        scopedUserIds !== null &&
        !scopedUserIds.includes(recruiterId as string)
      )
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      recruiterFilter = { recruiterId };
    } else if (scopedUserIds !== null) {
      recruiterFilter = { recruiterId: { in: scopedUserIds } };
    }

    // Department filter lives on recruiter, not requirement
    const departmentId = prismaIn(q.departmentId);
    if (departmentId) {
      recruiterFilter = {
        ...recruiterFilter,
        recruiter: { is: { departmentId } },
      };
    }

    // buildReqWhere now includes createdById — filters reqs by CSM creator
    const reqWhere = buildReqWhere(q, { withDateWindow: false });
    if (requirementId) reqWhere.id = requirementId;

    const stages = await fetchScopedStages(q.serviceLineId);

    const win = resolveDateWindow(toSingleQ(q));
    const activityWindow =
      win.gte || win.lte
        ? {
            ...(win.gte ? { gte: win.gte } : {}),
            ...(win.lte ? { lte: win.lte } : {}),
          }
        : null;

    // ── MOJ filter — scope pipeline rows to candidates joining in selected month
    const rawMoj = q.mojMonth;
    const mojMonths: string[] = Array.isArray(rawMoj)
      ? rawMoj
      : rawMoj
        ? [rawMoj]
        : [];
    const mojYear = Array.isArray(q.mojYear)
      ? q.mojYear[0]
      : (q.mojYear ?? null);

    let mojWhere: Record<string, any> | null = null;
    if (mojMonths.length === 1) {
      const label = mojMonthToLabel(mojMonths[0]);
      if (label) mojWhere = { monthOfJoining: label };
    } else if (mojMonths.length > 1) {
      const labels = mojMonths.map((m) => mojMonthToLabel(m)).filter(Boolean);
      if (labels.length) mojWhere = { monthOfJoining: { in: labels } };
    } else if (mojYear) {
      mojWhere = { monthOfJoining: { contains: mojYear } };
    }
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: {
        AND: [
          { requirement: { is: reqWhere } },
          recruiterFilter,
          // MOJ: only candidates whose monthOfJoining matches — null = no filter
          ...(mojWhere ? [mojWhere] : []),
          ...(activityWindow
            ? [
                {
                  OR: [
                    { createdAt: activityWindow },
                    { updatedAt: activityWindow },
                    { stageHistory: { some: { createdAt: activityWindow } } },
                  ],
                },
              ]
            : []),
        ],
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
      window: windowLabel(toSingleQ(q)),
      standardOnly,
      // Echo active filters back to frontend
      filters: {
        mojMonths: Array.isArray(q.mojMonth)
          ? q.mojMonth
          : q.mojMonth
            ? [q.mojMonth]
            : [],

        mojYear: Array.isArray(q.mojYear) ? q.mojYear[0] : (q.mojYear ?? null),
        createdById: Array.isArray(q.createdById)
          ? q.createdById[0]
          : (q.createdById ?? null),
      },
    };

    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId,
      );

    const recruiterIds = [...new Set(pipelines.map((p) => p.recruiterId))];
    const deptFilter = toPrismaFilter(q.departmentId);

    const users =
      recruiterIds.length > 0
        ? await prisma.user.findMany({
            where: {
              id: { in: recruiterIds },
              ...(deptFilter && { departmentId: deptFilter }),
            },
            select: {
              id: true,
              servicelineId: true,
              serviceline: { select: { id: true, name: true } },
              departmentId: true,
              department: { select: { id: true, name: true } },
            },
          })
        : [];

    const userLine = new Map<string, { id: string; name: string } | null>();
    const userDept = new Map<string, { id: string; name: string } | null>();

    for (const u of users) {
      userLine.set(u.id, u.serviceline ?? null);
      userDept.set(u.id, u.department ?? null);
    }

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
        const data = buildRecruiterRows(pipes).map((row) => ({
          ...row,
          department: userDept.get(row.id) ?? null,
        }));
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
          a.data.reduce((s, r) => s + r.sourced, 0),
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/export
// ─────────────────────────────────────────────────────────────────────────────

export const exportRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
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

    // buildReqWhere includes createdById for CSM filter
    const reqWhere = buildReqWhere(q);
    if (q.requirementId) reqWhere.id = q.requirementId;

    const stages = await fetchScopedStages(q.serviceLineId);
    const activeStages = (
      standardOnly ? stages.filter((s) => s.isStandard) : stages
    ).filter((s) => !hiddenStageIds.has(s.id));

    const terminalStageIds = new Set(
      stages.filter((s) => s.isTerminal).map((s) => s.id),
    );
    const nearTerminalStageIds = new Set(
      stages.filter((s) => s.isNearTerminal && !s.isTerminal).map((s) => s.id),
    );
    const offPipelineStageIds = new Set(
      stages.filter((s) => !s.pipeline).map((s) => s.id),
    );

    // ── MOJ filter
    // const mojWhere = buildMojWhere(q);
    // ── MOJ filter — same label-based logic as getRecruiterReport
    const rawMoj = q.mojMonth;
    const mojMonths: string[] = Array.isArray(rawMoj)
      ? rawMoj
      : rawMoj
        ? [rawMoj]
        : [];
    const mojYear = Array.isArray(q.mojYear)
      ? q.mojYear[0]
      : (q.mojYear ?? null);

    let mojWhere: Record<string, any> | null = null;
    if (mojMonths.length === 1) {
      const label = mojMonthToLabel(mojMonths[0]);
      if (label) mojWhere = { monthOfJoining: label };
    } else if (mojMonths.length > 1) {
      const labels = mojMonths.map((m) => mojMonthToLabel(m)).filter(Boolean);
      if (labels.length) mojWhere = { monthOfJoining: { in: labels } };
    } else if (mojYear) {
      mojWhere = { monthOfJoining: { contains: mojYear } };
    }
    const pipelineWhere: Record<string, any> = {
      requirement: reqWhere,
      ...recruiterFilter,
      // MOJ scoping — export only includes candidates for the selected joining month
      ...(mojWhere ?? {}),
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
      placed: number;
      nearClose: number;
      inPipeline: number;
      offPipeline: number;
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
          placed: 0,
          nearClose: 0,
          inPipeline: 0,
          offPipeline: 0,
          submitTimeMins: [],
          requirementIds: new Set(),
          stageCounts: {},
        };
      const r = recruiterMap[rid];
      r.requirementIds.add(p.requirementId);
      r.sourced++;
      r.stageCounts[p.currentStageId] =
        (r.stageCounts[p.currentStageId] ?? 0) + 1;

      if (terminalStageIds.has(p.currentStageId)) r.placed++;
      else if (nearTerminalStageIds.has(p.currentStageId)) r.nearClose++;
      else if (offPipelineStageIds.has(p.currentStageId)) r.offPipeline++;
      else r.inPipeline++;

      if (p.submittedAt)
        r.submitTimeMins.push(
          (p.stageHistory ?? []).reduce(
            (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
            0,
          ),
        );
    }

    const summaryRows = Object.values(recruiterMap).sort(
      (a, b) => b.sourced - a.sourced,
    );

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
    ];
    const stageCols = activeStages.map((s) => ({
      header: `${s.label} (${grandStageCounts[s.id] ?? 0})`,
      key: `stage_${s.id}`,
      width: Math.max(s.label.length + 6, 14),
    }));
    const fixedRight = [
      { header: "Placed", key: "placed", width: 12 },
      { header: "Near Close", key: "nearClose", width: 14 },
      { header: "In Pipeline", key: "inPipeline", width: 14 },
      { header: "Off Pipeline", key: "offPipeline", width: 14 },
      { header: "Avg Days to Submit", key: "avgDays", width: 18 },
    ];
    sheet1.columns = [...fixedLeft, ...stageCols, ...fixedRight];
    styleHdr(sheet1.getRow(1));

    let totalSourced = 0,
      totalPlaced = 0,
      totalNearClose = 0,
      totalInPipeline = 0,
      totalOffPipeline = 0;
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
      totalPlaced += r.placed;
      totalNearClose += r.nearClose;
      totalInPipeline += r.inPipeline;
      totalOffPipeline += r.offPipeline;
      r.requirementIds.forEach((id) => totalReqs.add(id));
      sheet1.addRow({
        name: r.name,
        email: r.email,
        reqs: r.requirementIds.size,
        sourced: r.sourced,
        ...dynVals,
        placed: r.placed,
        nearClose: r.nearClose,
        inPipeline: r.inPipeline,
        offPipeline: r.offPipeline,
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
      ...grandDynVals,
      placed: totalPlaced,
      nearClose: totalNearClose,
      inPipeline: totalInPipeline,
      offPipeline: totalOffPipeline,
      avgDays: "",
    });
    styleTotalsRow(totalsRow1);

    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet1.columnCount },
    };

    // ── Sheet 2: Candidates ───────────────────────────────────────────────────
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

    const totalPipelineByReq: Record<string, number> = {};
    for (const p of pipelines) {
      totalPipelineByReq[p.requirementId] =
        (totalPipelineByReq[p.requirementId] ?? 0) + 1;
    }

    const hiddenCandidateCols = new Set(
      (parseIds(q.hiddenCandidateCols) ?? []) as CandidateColKey[],
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
        disposition: q.disposition as string | undefined,
      },
      totalPipelineByReq,
    );

    const dateStr = new Date().toISOString().split("T")[0];
    const scopeTag = selectedIds ? "selected" : "all";
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-report-${scopeTag}-${windowLabel(
        toSingleQ(q),
      )}-${dateStr}.xlsx"`,
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
// 2. REQUIREMENT REPORT — GET /reports/requirements
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const standardOnly = q.standardOnly === "true";

    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin,
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

    const win = resolveDateWindow(toSingleQ(q));
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
          window: windowLabel(toSingleQ(q)),
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
        (s) => s.serviceLineId === null || s.serviceLineId === lineId,
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
        window: windowLabel(toSingleQ(q)),
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

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE REPORT — GET /reports/candidates
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidateReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const reqWhere = buildReqWhere(q);
    const scopedUserIds = resolveScopedUserIds(req);
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
      stages.map((s) => [s.id, 0]),
    );
    const dispositionCounts: Record<string, number> = {};
    let totalAgingMins = 0;

    for (const p of pipelines) {
      if (p.currentStageId in stageCounts) stageCounts[p.currentStageId]++;
      dispositionCounts[p.disposition] =
        (dispositionCounts[p.disposition] ?? 0) + 1;
      const stageAge = Math.floor(
        (Date.now() - new Date(p.stageUpdatedAt).getTime()) / 60000,
      );
      totalAgingMins +=
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0,
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
      meta: { window: windowLabel(toSingleQ(q)) },
    });
  } catch (err) {
    console.error("getCandidateReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate report" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE EXPORT — GET /reports/candidates/export
// ─────────────────────────────────────────────────────────────────────────────

export const exportCandidateReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const reqWhere = buildReqWhere(q);
    const scopedUserIds = resolveScopedUserIds(req);
    const selectedStageIds = parseIds(q.stageIds);

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
      pipelines.map((p) => [p.requirementId, (p as any).requirement]),
    );

    const totalPipelineByReq: Record<string, number> = {};
    for (const p of pipelines) {
      totalPipelineByReq[p.requirementId] =
        (totalPipelineByReq[p.requirementId] ?? 0) + 1;
    }

    const hiddenCandidateCols = new Set(
      (parseIds(q.hiddenCandidateCols) ?? []) as CandidateColKey[],
    );
    buildCandidateSheet(
      workbook,
      pipelines,
      reqLookup,
      {
        hiddenCols: hiddenCandidateCols,
        stageIds: selectedStageIds ?? undefined,
        disposition: q.disposition as string | undefined,
      },
      totalPipelineByReq,
    );

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="candidate-report-${windowLabel(
        toSingleQ(q),
      )}-${dateStr}.xlsx"`,
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
