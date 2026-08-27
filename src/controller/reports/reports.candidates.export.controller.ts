// File: reports.candidates.export.controller.ts
// Path: src/controller/reports/reports.candidates.export.controller.ts
//
//   GET /reports/candidates/export          — xlsx, honours every filter
//   GET /reports/candidates/export/columns  — the column registry for the picker
//
// Four sheets:
//   1. Candidates    — one row per pipeline row, columns the user chose
//   2. Summary       — totals, bucket split, disposition split, MOJ breakdown
//   3. Duplicates    — every person sitting in more than one requirement
//   4. By Recruiter  — per-recruiter rollup
//
// Reuses buildCandidateWhere from the list controller so the export is always
// exactly what the screen shows. No second filter implementation to drift.

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import prisma from "@/utils/prisma/client";
import { resolveOrgTreeDown } from "./reports.controller";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS  (kept local so this file can be dropped in independently)
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_FULL = [
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
];

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

function resolveDateWindow(q: Record<string, string | undefined>) {
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
  const w: { gte?: Date; lte?: Date } = {};
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

function parseIds(raw?: string): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : null;
}

function safeDate(val: any): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function deriveJoiningDate(p: any): Date | null {
  const actual = safeDate(p.actualJoiningDate);
  if (actual) return actual;
  const expected = safeDate(p.expectedJoiningDate);
  if (expected) return expected;
  const lwd = safeDate(p.lastWorkingDate);
  if (lwd) return lwd;
  if (p.noticePeriod) {
    const lower = String(p.noticePeriod).toLowerCase().trim();
    const num = lower.match(/^(\d+)/)?.[1];
    if (num) {
      const n = parseInt(num, 10);
      const base = new Date();
      if (lower.includes("month")) base.setMonth(base.getMonth() + n);
      else base.setDate(base.getDate() + n);
      return base;
    }
  }
  return null;
}

function monthOfJoiningLabel(d: Date | null): string {
  if (!d) return "";
  return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function joiningSourceLabel(p: any): string {
  if (safeDate(p.actualJoiningDate)) return "Actual";
  if (safeDate(p.expectedJoiningDate)) return "Expected";
  if (safeDate(p.lastWorkingDate)) return "From LWD";
  if (p.noticePeriod) return "From notice period";
  return "";
}

function mojParamToLabel(mojMonth?: string): string | null {
  if (!mojMonth) return null;
  const [yr, mo] = mojMonth.split("-");
  const idx = parseInt(mo, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx > 11 || !yr) return null;
  return `${MONTHS_FULL[idx]} ${yr}`;
}

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

function bucketOf(s: any): string {
  if (!s) return "In pipeline";
  if (s.isTerminal) return "Placed";
  if (s.isNearTerminal) return "Near close";
  if (!s.pipeline) return "Off pipeline";
  if (s.isSourced) return "Sourced";
  return "In pipeline";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE + FILTERS  (mirrors reports.candidates.controller.ts exactly)
// ─────────────────────────────────────────────────────────────────────────────

async function buildScopeFilter(
  req: Request
): Promise<Record<string, any> | null> {
  const orgTree = await resolveOrgTreeDown(
    req.user!.id,
    req.user!.isSuperAdmin
  );
  if (orgTree === null) return null;
  if (orgTree.length === 0) return { id: { in: [] } };

  const assignedRows = await prisma.requirementAssignment.findMany({
    where: { assignedToId: { in: orgTree }, status: "ACTIVE" },
    select: { requirementId: true },
  });
  const assignedReqIds = [...new Set(assignedRows.map((a) => a.requirementId))];

  return {
    OR: [
      { recruiterId: { in: orgTree } },
      { requirement: { createdById: { in: orgTree } } },
      ...(assignedReqIds.length > 0
        ? [{ requirementId: { in: assignedReqIds } }]
        : []),
    ],
  };
}

async function buildCandidateWhere(
  req: Request,
  q: Record<string, string>
): Promise<Record<string, any>> {
  const and: Record<string, any>[] = [];

  const scope = await buildScopeFilter(req);
  if (scope) and.push(scope);

  const reqWhere: Record<string, any> = { deletedAt: null };
  if (q.clientId) reqWhere.clientId = q.clientId;
  if (q.clientSpocId) reqWhere.clientSpocId = q.clientSpocId;
  if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
  if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
  if (q.requirementId) reqWhere.id = q.requirementId;
  if (q.createdById) reqWhere.createdById = q.createdById;
  if (q.priority) reqWhere.priority = q.priority;

  const statusList = parseIds(q.reqStatus);
  if (statusList) reqWhere.status = { in: statusList };
  else if (q.status) reqWhere.status = q.status;
  else if (q.reqActive === "true")
    reqWhere.status = { in: ["ACTIVE", "PENDING_APPROVAL"] };
  else if (q.reqActive === "false")
    reqWhere.status = { in: ["CLOSED", "CANCELLED", "ON_HOLD", "DRAFT"] };

  and.push({ requirement: reqWhere });

  const recruiterIds = parseIds(q.recruiterId);
  if (recruiterIds) and.push({ recruiterId: { in: recruiterIds } });
  const teamIds = parseIds(q.userIds);
  if (teamIds) and.push({ recruiterId: { in: teamIds } });

  const stageIds = parseIds(q.stageIds);
  if (stageIds) and.push({ currentStageId: { in: stageIds } });
  else if (q.stageId) and.push({ currentStageId: q.stageId });

  switch (q.bucket) {
    case "placed":
      and.push({ currentStage: { isTerminal: true } });
      break;
    case "near_terminal":
      and.push({ currentStage: { isNearTerminal: true, isTerminal: false } });
      break;
    case "in_pipeline":
      and.push({
        currentStage: {
          pipeline: true,
          isTerminal: false,
          isNearTerminal: false,
          isSourced: false,
        },
      });
      break;
    case "sourced":
      and.push({ currentStage: { isSourced: true } });
      break;
    case "off_pipeline":
      and.push({ currentStage: { pipeline: false } });
      break;
  }

  const dispositions = parseIds(q.disposition);
  if (dispositions) and.push({ disposition: { in: dispositions as any } });

  if (q.isRejected === "true") and.push({ isRejected: true });
  if (q.isWithdrawn === "true") and.push({ isWithdrawn: true });
  if (q.isOnHold === "true") and.push({ isOnHold: true });
  if (q.hasOffer === "true") and.push({ offerStatus: { not: null } });
  if (q.isSubmitted === "true") and.push({ submittedAt: { not: null } });
  if (q.snapshotType) and.push({ snapshot: { type: q.snapshotType as any } });

  const mojLabel = mojParamToLabel(q.mojMonth);
  if (mojLabel) {
    const [yr, mo] = q.mojMonth.split("-").map(Number);
    const monthStart = new Date(yr, mo - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(yr, mo, 0, 23, 59, 59, 999);
    and.push({
      OR: [
        { monthOfJoining: mojLabel },
        { actualJoiningDate: { gte: monthStart, lte: monthEnd } },
        { expectedJoiningDate: { gte: monthStart, lte: monthEnd } },
        { lastWorkingDate: { gte: monthStart, lte: monthEnd } },
      ],
    });
  } else if (q.mojYear) {
    const yr = parseInt(q.mojYear, 10);
    const yStart = new Date(yr, 0, 1, 0, 0, 0, 0);
    const yEnd = new Date(yr, 11, 31, 23, 59, 59, 999);
    and.push({
      OR: [
        { monthOfJoining: { contains: q.mojYear } },
        { actualJoiningDate: { gte: yStart, lte: yEnd } },
        { expectedJoiningDate: { gte: yStart, lte: yEnd } },
        { lastWorkingDate: { gte: yStart, lte: yEnd } },
      ],
    });
  }

  if (q.joinFrom || q.joinTo) {
    const gte = q.joinFrom ? startOfDay(new Date(q.joinFrom)) : undefined;
    const lte = q.joinTo ? endOfDay(new Date(q.joinTo)) : undefined;
    const range = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    and.push({
      OR: [{ actualJoiningDate: range }, { expectedJoiningDate: range }],
    });
  }
  if (q.hasJoined === "true") and.push({ actualJoiningDate: { not: null } });

  const win = resolveDateWindow(q);
  if (win.gte || win.lte) {
    const range = {
      ...(win.gte ? { gte: win.gte } : {}),
      ...(win.lte ? { lte: win.lte } : {}),
    };
    if (q.dateField === "sourced") and.push({ createdAt: range });
    else if (q.dateField === "stageMoved") and.push({ stageUpdatedAt: range });
    else
      and.push({
        OR: [
          { createdAt: range },
          { updatedAt: range },
          { stageHistory: { some: { createdAt: range } } },
        ],
      });
  }

  if (q.search?.trim()) {
    const s = q.search.trim();
    and.push({
      OR: [
        { snapshot: { fullName: { contains: s, mode: "insensitive" } } },
        { snapshot: { email: { contains: s, mode: "insensitive" } } },
        { snapshot: { phone: { contains: s } } },
        { snapshot: { currentCompany: { contains: s, mode: "insensitive" } } },
        { snapshot: { currentTitle: { contains: s, mode: "insensitive" } } },
        { requirement: { reqCode: { contains: s, mode: "insensitive" } } },
        { requirement: { title: { contains: s, mode: "insensitive" } } },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN REGISTRY — single source of truth for the picker and the sheet
//
// key = what the frontend sends in ?hiddenCandidateCols=key1,key2
// Opt-out: everything is included unless explicitly hidden.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_COLS = [
  // ── Candidate identity ──
  {
    key: "candidateName",
    header: "Candidate Name",
    width: 26,
    group: "candidate",
  },
  {
    key: "candidateCode",
    header: "Candidate Code",
    width: 16,
    group: "candidate",
  },
  { key: "candidateEmail", header: "Email", width: 30, group: "candidate" },
  { key: "candidatePhone", header: "Phone", width: 16, group: "candidate" },
  {
    key: "currentTitle",
    header: "Current Title",
    width: 24,
    group: "candidate",
  },
  {
    key: "currentCompany",
    header: "Current Company",
    width: 24,
    group: "candidate",
  },
  { key: "expYears", header: "Exp (yrs)", width: 10, group: "candidate" },
  { key: "topSkills", header: "Top Skills", width: 40, group: "candidate" },
  { key: "resumeUrl", header: "Resume URL", width: 30, group: "candidate" },
  { key: "snapshotType", header: "Source Type", width: 14, group: "candidate" },
  { key: "sourcedVia", header: "Sourced Via", width: 18, group: "candidate" },
  // ── Stage ──
  { key: "stageLabel", header: "Current Stage", width: 24, group: "stage" },
  { key: "bucket", header: "Bucket", width: 14, group: "stage" },
  { key: "disposition", header: "Disposition", width: 14, group: "stage" },
  { key: "stageAging", header: "Stage Aging", width: 12, group: "stage" },
  {
    key: "pipelineDays",
    header: "Days in Pipeline",
    width: 16,
    group: "stage",
  },
  { key: "addedOn", header: "Added On", width: 16, group: "stage" },
  { key: "submittedAt", header: "Submitted At", width: 18, group: "stage" },
  // ── Flags ──
  { key: "isRejected", header: "Rejected?", width: 10, group: "flags" },
  {
    key: "rejectionReason",
    header: "Rejection Reason",
    width: 26,
    group: "flags",
  },
  { key: "isWithdrawn", header: "Withdrawn?", width: 10, group: "flags" },
  {
    key: "withdrawnReason",
    header: "Withdrawn Reason",
    width: 26,
    group: "flags",
  },
  { key: "isOnHold", header: "On Hold?", width: 10, group: "flags" },
  { key: "dropReason", header: "Drop Reason", width: 20, group: "flags" },
  // ── Duplicates ──
  {
    key: "duplicateCount",
    header: "Also In (# reqs)",
    width: 16,
    group: "duplicate",
  },
  {
    key: "duplicateIn",
    header: "Also In (req codes)",
    width: 32,
    group: "duplicate",
  },
  {
    key: "isDuplicateFlag",
    header: "Flagged Duplicate?",
    width: 16,
    group: "duplicate",
  },
  // ── CTC ──
  { key: "currentCtc", header: "Current CTC", width: 14, group: "ctc" },
  { key: "expectedCtc", header: "Expected CTC", width: 14, group: "ctc" },
  { key: "negotiatedCtc", header: "Negotiated CTC", width: 14, group: "ctc" },
  { key: "offeredCtc", header: "Offered CTC", width: 14, group: "ctc" },
  { key: "salaryCurrency", header: "Currency", width: 10, group: "ctc" },
  { key: "offerStatus", header: "Offer Status", width: 14, group: "ctc" },
  // ── Joining ──
  { key: "noticePeriod", header: "Notice Period", width: 14, group: "joining" },
  {
    key: "lastWorkingDate",
    header: "Last Working Day",
    width: 16,
    group: "joining",
  },
  {
    key: "expectedJoiningDate",
    header: "Expected Joining",
    width: 16,
    group: "joining",
  },
  {
    key: "actualJoiningDate",
    header: "Actual Joining",
    width: 16,
    group: "joining",
  },
  {
    key: "derivedJoiningDate",
    header: "Derived Joining",
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
  {
    key: "joiningSource",
    header: "Joining Date Source",
    width: 18,
    group: "joining",
  },
  // ── Recruiter ──
  { key: "recruiterName", header: "Recruiter", width: 24, group: "recruiter" },
  {
    key: "recruiterEmail",
    header: "Recruiter Email",
    width: 28,
    group: "recruiter",
  },
  // ── Requirement ──
  { key: "reqCode", header: "Req Code", width: 14, group: "requirement" },
  { key: "reqTitle", header: "Requirement", width: 34, group: "requirement" },
  { key: "reqStatus", header: "Req Status", width: 16, group: "requirement" },
  {
    key: "reqPriority",
    header: "Req Priority",
    width: 12,
    group: "requirement",
  },
  {
    key: "totalOpenings",
    header: "Total Openings",
    width: 14,
    group: "requirement",
  },
  { key: "clientName", header: "Client", width: 24, group: "requirement" },
  {
    key: "clientSpocName",
    header: "Client SPOC",
    width: 22,
    group: "requirement",
  },
  {
    key: "serviceLineName",
    header: "Service Line",
    width: 18,
    group: "requirement",
  },
  {
    key: "businessUnitName",
    header: "Business Unit",
    width: 20,
    group: "requirement",
  },
  {
    key: "reqCreatedBy",
    header: "Req Created By",
    width: 22,
    group: "requirement",
  },
] as const;

type ColKey = (typeof ALL_COLS)[number]["key"];

const GROUP_LABELS: Record<string, string> = {
  candidate: "Candidate",
  stage: "Stage",
  flags: "Flags",
  duplicate: "Duplicates",
  ctc: "CTC",
  joining: "Joining",
  recruiter: "Recruiter",
  requirement: "Requirement",
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/export/columns
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidateExportColumns = async (
  _req: Request,
  res: Response
) => {
  const groups: Record<string, { key: string; header: string }[]> = {};
  for (const c of ALL_COLS) {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push({ key: c.key, header: c.header });
  }
  return res.json({
    success: true,
    data: {
      columns: ALL_COLS.map((c) => ({
        key: c.key,
        header: c.header,
        group: c.group,
      })),
      groups,
      groupLabels: GROUP_LABELS,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/export
// ─────────────────────────────────────────────────────────────────────────────

export const exportCandidates = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const where = await buildCandidateWhere(req, q);

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: {
        id: true,
        requirementId: true,
        recruiterId: true,
        currentStageId: true,
        disposition: true,
        dropReason: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        rejectionReason: true,
        withdrawnReason: true,
        submittedAt: true,
        offerStatus: true,
        offeredCtc: true,
        currentCtc: true,
        expectedCtc: true,
        negotiatedCtc: true,
        salaryCurrency: true,
        noticePeriod: true,
        lastWorkingDate: true,
        expectedJoiningDate: true,
        actualJoiningDate: true,
        monthOfJoining: true,
        remainingDaysToJoin: true,
        stageUpdatedAt: true,
        createdAt: true,
        currentStage: {
          select: {
            id: true,
            code: true,
            label: true,
            order: true,
            isTerminal: true,
            isNearTerminal: true,
            isSourced: true,
            pipeline: true,
          },
        },
        recruiter: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        snapshot: {
          select: {
            candidateServiceId: true,
            candidateCode: true,
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            currentCompany: true,
            totalExpYears: true,
            topSkills: true,
            resumeUrl: true,
            type: true,
            sourced: true,
          },
        },
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            client: { select: { id: true, name: true } },
            clientSpoc: { select: { firstName: true, lastName: true } },
            serviceLine: { select: { name: true } },
            businessUnit: { select: { name: true } },
            createdBy: { select: { firstName: true, lastName: true } },
          },
        },
        stageHistory: { select: { timeInPrevStageMins: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50000,
    });

    // ── Duplicate map across the whole export set ────────────────────────────
    const csIds = [
      ...new Set(
        pipelines
          .map((p) => p.snapshot?.candidateServiceId)
          .filter(Boolean) as string[]
      ),
    ];

    const dupRows =
      csIds.length > 0
        ? await prisma.requirementCandidatePipeline.findMany({
            where: { snapshot: { candidateServiceId: { in: csIds } } },
            select: {
              requirementId: true,
              disposition: true,
              currentStage: { select: { label: true } },
              recruiter: { select: { firstName: true, lastName: true } },
              snapshot: {
                select: {
                  candidateServiceId: true,
                  fullName: true,
                  email: true,
                },
              },
              requirement: {
                select: {
                  reqCode: true,
                  title: true,
                  clientId: true,
                  client: { select: { name: true } },
                },
              },
            },
          })
        : [];

    const dupMap = new Map<string, any[]>();
    for (const r of dupRows) {
      const csid = r.snapshot?.candidateServiceId;
      if (!csid) continue;
      if (!dupMap.has(csid)) dupMap.set(csid, []);
      dupMap.get(csid)!.push({
        requirementId: r.requirementId,
        reqCode: r.requirement?.reqCode ?? "",
        reqTitle: r.requirement?.title ?? "",
        clientId: r.requirement?.clientId ?? null,
        clientName: r.requirement?.client?.name ?? "",
        stageLabel: r.currentStage?.label ?? "",
        recruiterName: `${r.recruiter?.firstName ?? ""} ${
          r.recruiter?.lastName ?? ""
        }`.trim(),
        disposition: r.disposition,
        candidateName: r.snapshot?.fullName ?? "",
        candidateEmail: r.snapshot?.email ?? "",
      });
    }

    // ── Column selection ─────────────────────────────────────────────────────
    const hiddenCols = new Set(
      (parseIds(q.hiddenCandidateCols) ?? []) as ColKey[]
    );
    const activeCols = ALL_COLS.filter((c) => !hiddenCols.has(c.key));
    const has = (k: ColKey) => !hiddenCols.has(k);

    // ── Workbook ─────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = "TalentOS";
    wb.created = new Date();

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

    // ══ SHEET 1: Candidates ══════════════════════════════════════════════════
    const s1 = wb.addWorksheet("Candidates", {
      views: [
        { state: "frozen", ySplit: 1, xSplit: has("candidateName") ? 1 : 0 },
      ],
    });
    s1.columns = activeCols.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));
    styleHdr(s1.getRow(1));

    const now = Date.now();
    const bucketTally: Record<string, number> = {};
    const dispTally: Record<string, number> = {};
    const mojTally: Record<string, number> = {};
    const recTally = new Map<string, any>();
    let derivedMojCount = 0;
    let crossReqCount = 0;

    for (const p of pipelines as any[]) {
      const snap = p.snapshot;
      const rq = p.requirement;
      const st = p.currentStage;

      const stageAgeMins = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000
      );
      const totalMins =
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0
        ) + stageAgeMins;

      const derived = deriveJoiningDate(p);
      const moj = p.monthOfJoining || monthOfJoiningLabel(derived);
      if (!p.monthOfJoining && derived) derivedMojCount++;

      const others = (dupMap.get(snap?.candidateServiceId ?? "") ?? []).filter(
        (o: any) => o.requirementId !== p.requirementId
      );
      if (others.length > 0) crossReqCount++;

      const bucket = bucketOf(st);
      bucketTally[bucket] = (bucketTally[bucket] ?? 0) + 1;
      dispTally[p.disposition] = (dispTally[p.disposition] ?? 0) + 1;
      if (moj) mojTally[moj] = (mojTally[moj] ?? 0) + 1;

      // Recruiter rollup for sheet 4
      const rid = p.recruiterId;
      if (!recTally.has(rid)) {
        recTally.set(rid, {
          name: `${p.recruiter?.firstName ?? ""} ${
            p.recruiter?.lastName ?? ""
          }`.trim(),
          email: p.recruiter?.email ?? "",
          total: 0,
          placed: 0,
          nearClose: 0,
          offPipeline: 0,
          joined: 0,
          submitted: 0,
        });
      }
      const ra = recTally.get(rid);
      ra.total++;
      if (bucket === "Placed") ra.placed++;
      if (bucket === "Near close") ra.nearClose++;
      if (bucket === "Off pipeline") ra.offPipeline++;
      if (safeDate(p.actualJoiningDate)) ra.joined++;
      if (p.submittedAt) ra.submitted++;

      const d: Record<string, any> = {};
      if (has("candidateName")) d.candidateName = snap?.fullName ?? "—";
      if (has("candidateCode")) d.candidateCode = snap?.candidateCode ?? "";
      if (has("candidateEmail")) d.candidateEmail = snap?.email ?? "";
      if (has("candidatePhone")) d.candidatePhone = snap?.phone ?? "";
      if (has("currentTitle")) d.currentTitle = snap?.currentTitle ?? "";
      if (has("currentCompany")) d.currentCompany = snap?.currentCompany ?? "";
      if (has("expYears")) d.expYears = snap?.totalExpYears ?? "";
      if (has("topSkills")) d.topSkills = (snap?.topSkills ?? []).join(", ");
      if (has("resumeUrl")) d.resumeUrl = snap?.resumeUrl ?? "";
      if (has("snapshotType")) d.snapshotType = snap?.type ?? "";
      if (has("sourcedVia")) d.sourcedVia = snap?.sourced ?? "";

      if (has("stageLabel")) d.stageLabel = st?.label ?? "";
      if (has("bucket")) d.bucket = bucket;
      if (has("disposition")) d.disposition = p.disposition;
      if (has("stageAging")) d.stageAging = formatAging(stageAgeMins);
      if (has("pipelineDays")) d.pipelineDays = Math.floor(totalMins / 1440);
      if (has("addedOn")) d.addedOn = new Date(p.createdAt);
      if (has("submittedAt")) d.submittedAt = safeDate(p.submittedAt) ?? "";

      if (has("isRejected")) d.isRejected = p.isRejected ? "Yes" : "No";
      if (has("rejectionReason")) d.rejectionReason = p.rejectionReason ?? "";
      if (has("isWithdrawn")) d.isWithdrawn = p.isWithdrawn ? "Yes" : "No";
      if (has("withdrawnReason")) d.withdrawnReason = p.withdrawnReason ?? "";
      if (has("isOnHold")) d.isOnHold = p.isOnHold ? "Yes" : "No";
      if (has("dropReason")) d.dropReason = p.dropReason ?? "";

      if (has("duplicateCount")) d.duplicateCount = others.length;
      if (has("duplicateIn"))
        d.duplicateIn = others.map((o: any) => o.reqCode).join(", ");
      if (has("isDuplicateFlag"))
        d.isDuplicateFlag = p.disposition === "DUPLICATE" ? "Yes" : "No";

      if (has("currentCtc")) d.currentCtc = p.currentCtc ?? "";
      if (has("expectedCtc")) d.expectedCtc = p.expectedCtc ?? "";
      if (has("negotiatedCtc")) d.negotiatedCtc = p.negotiatedCtc ?? "";
      if (has("offeredCtc")) d.offeredCtc = p.offeredCtc ?? "";
      if (has("salaryCurrency")) d.salaryCurrency = p.salaryCurrency ?? "";
      if (has("offerStatus")) d.offerStatus = p.offerStatus ?? "";

      if (has("noticePeriod")) d.noticePeriod = p.noticePeriod ?? "";
      if (has("lastWorkingDate"))
        d.lastWorkingDate = safeDate(p.lastWorkingDate) ?? "";
      if (has("expectedJoiningDate"))
        d.expectedJoiningDate = safeDate(p.expectedJoiningDate) ?? "";
      if (has("actualJoiningDate"))
        d.actualJoiningDate = safeDate(p.actualJoiningDate) ?? "";
      if (has("derivedJoiningDate")) d.derivedJoiningDate = derived ?? "";
      if (has("monthOfJoining")) d.monthOfJoining = moj;
      if (has("daysToJoin"))
        d.daysToJoin =
          p.remainingDaysToJoin ??
          (derived ? Math.floor((derived.getTime() - now) / 86400000) : "");
      if (has("joiningSource")) d.joiningSource = joiningSourceLabel(p);

      if (has("recruiterName")) d.recruiterName = ra.name;
      if (has("recruiterEmail")) d.recruiterEmail = ra.email;

      if (has("reqCode")) d.reqCode = rq?.reqCode ?? "";
      if (has("reqTitle")) d.reqTitle = rq?.title ?? "";
      if (has("reqStatus")) d.reqStatus = rq?.status ?? "";
      if (has("reqPriority")) d.reqPriority = rq?.priority ?? "";
      if (has("totalOpenings")) d.totalOpenings = rq?.totalOpenings ?? "";
      if (has("clientName")) d.clientName = rq?.client?.name ?? "";
      if (has("clientSpocName"))
        d.clientSpocName = rq?.clientSpoc
          ? `${rq.clientSpoc.firstName} ${rq.clientSpoc.lastName}`.trim()
          : "";
      if (has("serviceLineName"))
        d.serviceLineName = rq?.serviceLine?.name ?? "";
      if (has("businessUnitName"))
        d.businessUnitName = rq?.businessUnit?.name ?? "";
      if (has("reqCreatedBy"))
        d.reqCreatedBy = rq?.createdBy
          ? `${rq.createdBy.firstName} ${rq.createdBy.lastName}`.trim()
          : "";

      const row = s1.addRow(d);
      row.height = 18;

      // Date formats
      if (has("addedOn")) row.getCell("addedOn").numFmt = "dd-mmm-yyyy";
      if (has("submittedAt") && p.submittedAt)
        row.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
      for (const k of [
        "lastWorkingDate",
        "expectedJoiningDate",
        "actualJoiningDate",
        "derivedJoiningDate",
      ] as ColKey[]) {
        if (has(k) && d[k]) row.getCell(k).numFmt = "dd-mmm-yyyy";
      }

      // Bucket tint
      if (has("bucket")) {
        const c = row.getCell("bucket");
        if (bucket === "Placed") {
          c.fill = mkFill("FFE2EFDA");
          c.font = { bold: true, color: { argb: "FF1A5C2A" } };
        } else if (bucket === "Near close") {
          c.fill = mkFill("FFFFF3CD");
          c.font = { bold: true };
        } else if (bucket === "Off pipeline") {
          c.fill = mkFill("FFFCE4D6");
          c.font = { color: { argb: "FFDE350B" } };
        }
      }
      if (has("stageLabel") && st?.isTerminal)
        row.getCell("stageLabel").fill = mkFill("FFE2EFDA");

      // Duplicate highlight — amber when the same person sits elsewhere
      if (has("duplicateCount") && others.length > 0) {
        row.getCell("duplicateCount").fill = mkFill("FFFFF3CD");
        row.getCell("duplicateCount").font = {
          bold: true,
          color: { argb: "FF8B5E0A" },
        };
      }

      // Inferred joining dates render italic grey — not confirmed facts
      if (
        has("joiningSource") &&
        d.joiningSource &&
        d.joiningSource !== "Actual"
      ) {
        row.getCell("joiningSource").font = {
          italic: true,
          color: { argb: "FF7A869A" },
        };
      }

      // Rejected / withdrawn rows greyed out
      if (p.isRejected || p.isWithdrawn) {
        row.eachCell((c) => {
          c.font = { ...c.font, color: { argb: "FF9E9E9E" } };
        });
      }
    }

    s1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s1.columnCount },
    };

    // ══ SHEET 2: Summary ═════════════════════════════════════════════════════
    const s2 = wb.addWorksheet("Summary");
    s2.columns = [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 20 },
    ];
    styleHdr(s2.getRow(1));

    const distinctPeople = csIds.length;
    const addSection = (title: string) => {
      s2.addRow({ metric: "", value: "" });
      const r = s2.addRow({ metric: title, value: "" });
      r.font = { bold: true, color: { argb: "FF1E3A5F" } };
      r.fill = mkFill("FFF0F4FF");
    };

    s2.addRow({ metric: "Pipeline rows", value: pipelines.length });
    s2.addRow({ metric: "Distinct candidates", value: distinctPeople });
    s2.addRow({ metric: "Rows in >1 requirement", value: crossReqCount });
    s2.addRow({ metric: "Month of Joining inferred", value: derivedMojCount });

    addSection("BUCKET SPLIT");
    for (const [k, v] of Object.entries(bucketTally).sort(
      (a, b) => b[1] - a[1]
    )) {
      s2.addRow({ metric: `  ${k}`, value: v });
    }

    addSection("DISPOSITION SPLIT");
    for (const [k, v] of Object.entries(dispTally).sort(
      (a, b) => b[1] - a[1]
    )) {
      s2.addRow({ metric: `  ${k}`, value: v });
    }

    addSection("MONTH OF JOINING");
    const mojSorted = Object.entries(mojTally).sort(([a], [b]) => {
      const pa = a.split(" "),
        pb = b.split(" ");
      const ka = parseInt(pa[1], 10) * 100 + MONTHS_FULL.indexOf(pa[0]);
      const kb = parseInt(pb[1], 10) * 100 + MONTHS_FULL.indexOf(pb[0]);
      return ka - kb;
    });
    for (const [k, v] of mojSorted) s2.addRow({ metric: `  ${k}`, value: v });

    addSection("EXPORT CONTEXT");
    s2.addRow({ metric: "  Window", value: windowLabel(q) });
    s2.addRow({
      metric: "  Columns included",
      value: `${activeCols.length} of ${ALL_COLS.length}`,
    });
    s2.addRow({
      metric: "  Generated at",
      value: new Date().toLocaleString("en-IN"),
    });
    if (pipelines.length >= 50000)
      s2.addRow({ metric: "  ⚠ Capped", value: "50000 row limit reached" });

    // ══ SHEET 3: Duplicates ══════════════════════════════════════════════════
    const s3 = wb.addWorksheet("Duplicates", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    s3.columns = [
      { header: "Candidate", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "In # Requirements", key: "count", width: 16 },
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "reqTitle", width: 34 },
      { header: "Client", key: "client", width: 22 },
      { header: "Stage", key: "stage", width: 22 },
      { header: "Disposition", key: "disposition", width: 14 },
      { header: "Recruiter", key: "recruiter", width: 24 },
      { header: "Same Client Across Reqs?", key: "sameClient", width: 22 },
    ];
    styleHdr(s3.getRow(1));

    for (const [csid, entries] of dupMap) {
      if (entries.length < 2) continue; // not a duplicate
      const clientIds = new Set(entries.map((e: any) => e.clientId));
      const sameClient = clientIds.size === 1;
      for (const e of entries) {
        const row = s3.addRow({
          name: e.candidateName,
          email: e.candidateEmail,
          count: entries.length,
          reqCode: e.reqCode,
          reqTitle: e.reqTitle,
          client: e.clientName,
          stage: e.stageLabel,
          disposition: e.disposition,
          recruiter: e.recruiterName,
          sameClient: sameClient
            ? "Yes — same client"
            : "No — different clients",
        });
        row.height = 18;
        // Same client across requirements is the case worth investigating
        if (sameClient) {
          row.getCell("sameClient").fill = mkFill("FFFCE4D6");
          row.getCell("sameClient").font = {
            bold: true,
            color: { argb: "FFDE350B" },
          };
        }
      }
    }
    s3.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s3.columnCount },
    };

    // ══ SHEET 4: By Recruiter ════════════════════════════════════════════════
    const s4 = wb.addWorksheet("By Recruiter", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    s4.columns = [
      { header: "Recruiter", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Candidates", key: "total", width: 12 },
      { header: "Submitted", key: "submitted", width: 12 },
      { header: "Near Close", key: "nearClose", width: 12 },
      { header: "Placed", key: "placed", width: 10 },
      { header: "Joined", key: "joined", width: 10 },
      { header: "Off Pipeline", key: "offPipeline", width: 14 },
      { header: "Placement %", key: "rate", width: 14 },
    ];
    styleHdr(s4.getRow(1));

    const recSorted = [...recTally.values()].sort((a, b) => b.total - a.total);
    for (const r of recSorted) {
      s4.addRow({
        ...r,
        rate:
          r.total > 0 ? `${((r.placed / r.total) * 100).toFixed(1)}%` : "0%",
      }).height = 18;
    }
    const tRow = s4.addRow({
      name: "TOTAL",
      email: "",
      total: recSorted.reduce((s, r) => s + r.total, 0),
      submitted: recSorted.reduce((s, r) => s + r.submitted, 0),
      nearClose: recSorted.reduce((s, r) => s + r.nearClose, 0),
      placed: recSorted.reduce((s, r) => s + r.placed, 0),
      joined: recSorted.reduce((s, r) => s + r.joined, 0),
      offPipeline: recSorted.reduce((s, r) => s + r.offPipeline, 0),
      rate: "",
    });
    tRow.eachCell((c) => {
      c.font = { bold: true };
      c.fill = mkFill("FFF0F4FF");
      c.border = { top: { style: "medium", color: { argb: "FF4F46E5" } } };
    });
    s4.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s4.columnCount },
    };

    // ── Stream ───────────────────────────────────────────────────────────────
    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="candidates-${windowLabel(q)}-${dateStr}.xlsx"`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportCandidates:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export candidates" });
  }
};
