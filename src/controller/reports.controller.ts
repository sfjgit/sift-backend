// File: reports.controller.ts
// Path: src/controller/reports.controller.ts

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: resolve scoped user IDs from req.scopeFilter
// Middleware already resolved everything — just read it.
// Returns null = entire org (ALL / superAdmin), string[] = scoped list
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: BFS downward from userId — returns self + all reportees recursively
// SuperAdmin → null (no filter, entire org)
// Everyone else → self + full subtree below them in org chart
// Applied uniformly: a recruiter with no reportees gets [userId] only.
// A TL/DM gets themselves + everyone below. Simple, no scope branching.
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOrgTreeDown(
  userId: string,
  isSuperAdmin: boolean
): Promise<string[] | null> {
  if (isSuperAdmin) return null; // superAdmin sees everything

  const visited = new Set<string>([userId]);
  let frontier = [userId];

  while (frontier.length > 0) {
    const children = await prisma.user.findMany({
      where: {
        reportingToId: { in: frontier },
        isActive: true,
        id: { notIn: [...visited] }, // avoid cycles
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

// Wrapper that reads from req — used for pipeline/assignment scope
async function resolveScopedUserIds(req: Request): Promise<string[] | null> {
  return resolveOrgTreeDown(req.user!.id, req.user!.isSuperAdmin);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: build requirement where from query filters (no BU — too complex)
// ─────────────────────────────────────────────────────────────────────────────

function buildReqWhere(q: Record<string, string>): Record<string, any> {
  const where: Record<string, any> = { deletedAt: null };
  if (q.clientId) where.clientId = q.clientId;
  if (q.serviceLineId) where.serviceLineId = q.serviceLineId;
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.fromDate || q.toDate) {
    where.createdAt = {};
    if (q.fromDate) where.createdAt.gte = new Date(q.fromDate);
    if (q.toDate) where.createdAt.lte = new Date(q.toDate);
  }
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: fetch all pipeline stages from DB (never hardcoded)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllStages() {
  return prisma.pipelineStage.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      canonicalStage: true,
    },
    orderBy: { order: "asc" },
  });
}

async function fetchCanonicalKeys() {
  const rows = await prisma.pipelineStage.findMany({
    where: { isActive: true, canonicalStage: { not: null } },
    select: { canonicalStage: true },
    distinct: ["canonicalStage"],
    orderBy: { order: "asc" },
  });
  return [...new Set(rows.map((r) => r.canonicalStage as string))];
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
// UTIL: Excel header styling
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

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT for candidate detail sheet (used in all exports)
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_DETAIL_SELECT = {
  id: true,
  requirementId: true,
  recruiterId: true,
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

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: build candidate detail sheet (Sheet 2 in all exports)
// All new fields included: CTC breakdown, LWD, joining dates, month of joining
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
    { header: "Requirement", key: "reqTitle", width: 36 },
    { header: "Candidate Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Current Title", key: "title", width: 24 },
    { header: "Current Company", key: "company", width: 22 },
    { header: "Exp (yrs)", key: "exp", width: 10 },
    { header: "Top Skills", key: "skills", width: 36 },
    { header: "Recruiter", key: "recruiter", width: 22 },
    { header: "Current Stage", key: "stage", width: 22 },
    { header: "Stage Group", key: "canonical", width: 20 },
    { header: "Status", key: "disposition", width: 14 },
    { header: "Added On", key: "addedOn", width: 16 },
    { header: "Days in Pipeline", key: "pipelineDays", width: 16 },
    { header: "Stage Aging", key: "aging", width: 12 },
    { header: "Submitted At", key: "submittedAt", width: 18 },
    { header: "Offer Status", key: "offerStatus", width: 14 },
    // CTC breakdown — new fields
    { header: "Current CTC", key: "currentCtc", width: 14 },
    { header: "Expected CTC", key: "expectedCtc", width: 14 },
    { header: "Negotiated CTC", key: "negotiatedCtc", width: 14 },
    { header: "Offered CTC", key: "offeredCtc", width: 14 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Salary Type", key: "salaryType", width: 12 },
    // Joining — new fields
    { header: "Last Working Day", key: "lwd", width: 16 },
    { header: "Expected Joining", key: "expectedJoining", width: 16 },
    { header: "Actual Joining", key: "actualJoining", width: 16 },
    { header: "Month of Joining", key: "monthOfJoining", width: 16 },
    { header: "Days to Join", key: "daysToJoin", width: 14 },
    { header: "Rejected?", key: "rejected", width: 10 },
    { header: "Withdrawn?", key: "withdrawn", width: 10 },
    { header: "On Hold?", key: "onHold", width: 10 },
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
      canonical: p.currentStage?.canonicalStage
        ? humanKey(p.currentStage.canonicalStage)
        : "",
      disposition: p.disposition,
      addedOn: new Date(p.createdAt),
      pipelineDays: Math.floor(totalMins / 1440),
      aging: formatAging(stageAgeMins),
      submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
      offerStatus: p.offerStatus ?? "",
      // CTC
      currentCtc: p.currentCtc ?? "",
      expectedCtc: p.expectedCtc ?? "",
      negotiatedCtc: p.negotiatedCtc ?? "",
      offeredCtc: p.offeredCtc ?? "",
      currency: p.salaryCurrency ?? "",
      salaryType: p.salaryType ?? "",
      // Joining
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
    });

    row.height = 18;
    row.getCell("addedOn").numFmt = "dd-mmm-yyyy";
    if (p.submittedAt) row.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
    if (p.lastWorkingDate) row.getCell("lwd").numFmt = "dd-mmm-yyyy";
    if (p.expectedJoiningDate)
      row.getCell("expectedJoining").numFmt = "dd-mmm-yyyy";
    if (p.actualJoiningDate)
      row.getCell("actualJoining").numFmt = "dd-mmm-yyyy";

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

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 1. RECRUITER REPORT
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/recruiters
export const getRecruiterReport = async (req: Request, res: Response) => {
  try {
    const { clientId, serviceLineId, fromDate, toDate, recruiterId } =
      req.query as Record<string, string>;

    const scopedUserIds = await resolveScopedUserIds(req);

    // Optional drill-down into a single recruiter
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

    const reqWhere = buildReqWhere({
      clientId,
      serviceLineId,
      fromDate,
      toDate,
    } as any);
    const allStages = await fetchAllStages();
    const canonicalKeys = [
      ...new Set(
        allStages
          .filter((s) => s.canonicalStage !== null)
          .map((s) => s.canonicalStage as string)
      ),
    ];

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
            businessUnit: { select: { id: true, name: true } },
            serviceLine: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Aggregate per recruiter
    type ReqStats = {
      requirementId: string;
      reqCode: string;
      title: string;
      status: string;
      totalOpenings: number;
      client: { id: string; name: string } | null;
      businessUnit: { id: string; name: string } | null;
      serviceLine: { id: string; name: string } | null;
      sourced: number;
      submitted: number;
      joined: number;
      dropped: number;
      active: number;
      canonicalCounts: Record<string, number>;
    };
    type RecAgg = {
      id: string;
      name: string;
      email: string;
      sourced: number;
      submitted: number;
      joined: number;
      dropped: number;
      active: number;
      submitTimeMins: number[];
      stageCounts: Record<string, number>;
      canonicalCounts: Record<string, number>;
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
          joined: 0,
          dropped: 0,
          active: 0,
          submitTimeMins: [],
          stageCounts: Object.fromEntries(allStages.map((s) => [s.id, 0])),
          canonicalCounts: {},
          reqMap: {},
        };
      }
      const r = map[rid];
      r.sourced++;

      if (p.currentStageId in r.stageCounts) r.stageCounts[p.currentStageId]++;
      const canonical = p.currentStage?.canonicalStage ?? null;
      if (canonical)
        r.canonicalCounts[canonical] = (r.canonicalCounts[canonical] ?? 0) + 1;

      if (p.submittedAt) r.submitted++;
      if (p.disposition === "PLACED" || p.actualJoiningDate) r.joined++;
      if (p.disposition === "DROPPED" || p.isRejected || p.isWithdrawn)
        r.dropped++;
      if (p.disposition === "ACTIVE") r.active++;
      if (p.submittedAt) {
        r.submitTimeMins.push(
          (p.stageHistory ?? []).reduce(
            (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
            0
          )
        );
      }

      // Per-requirement breakdown
      const req = (p as any).requirement;
      const reqId = p.requirementId;
      if (!r.reqMap[reqId]) {
        r.reqMap[reqId] = {
          requirementId: reqId,
          reqCode: req?.reqCode ?? "",
          title: req?.title ?? "",
          status: req?.status ?? "",
          totalOpenings: req?.totalOpenings ?? 0,
          client: req?.client ?? null,
          businessUnit: req?.businessUnit ?? null,
          serviceLine: req?.serviceLine ?? null,
          sourced: 0,
          submitted: 0,
          joined: 0,
          dropped: 0,
          active: 0,
          canonicalCounts: {},
        };
      }
      const rq = r.reqMap[reqId];
      rq.sourced++;
      if (canonical)
        rq.canonicalCounts[canonical] =
          (rq.canonicalCounts[canonical] ?? 0) + 1;
      if (p.submittedAt) rq.submitted++;
      if (p.disposition === "PLACED" || p.actualJoiningDate) rq.joined++;
      if (p.disposition === "DROPPED" || p.isRejected || p.isWithdrawn)
        rq.dropped++;
      if (p.disposition === "ACTIVE") rq.active++;
    }

    const data = Object.values(map).map((r) => {
      const offered =
        (r.canonicalCounts["OFFERED"] ?? 0) +
        (r.canonicalCounts["OFFER_IN_PROGRESS"] ?? 0);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        sourced: r.sourced,
        submitted: r.submitted,
        shortlisted: r.canonicalCounts["SHORTLISTED"] ?? 0,
        offered,
        joined: r.joined,
        dropped: r.dropped,
        active: r.active,
        submissionRate:
          r.sourced > 0 ? +((r.submitted / r.sourced) * 100).toFixed(1) : 0,
        offerRate:
          r.submitted > 0 ? +((offered / r.submitted) * 100).toFixed(1) : 0,
        joinRate: offered > 0 ? +((r.joined / offered) * 100).toFixed(1) : 0,
        avgTimeToSubmitDays:
          r.submitTimeMins.length > 0
            ? +(
                r.submitTimeMins.reduce((a, b) => a + b, 0) /
                r.submitTimeMins.length /
                1440
              ).toFixed(1)
            : null,
        canonicalStageCounts: r.canonicalCounts,
        stageBreakdown: allStages
          .map((s) => ({
            stageId: s.id,
            code: s.code,
            label: s.label,
            order: s.order,
            canonicalStage: s.canonicalStage ?? null,
            count: r.stageCounts[s.id] ?? 0,
          }))
          .filter((s) => s.count > 0),
        requirementBreakdown: Object.values(r.reqMap)
          .sort((a, b) => b.sourced - a.sourced)
          .map((rq) => ({
            ...rq,
            offered:
              (rq.canonicalCounts["OFFERED"] ?? 0) +
              (rq.canonicalCounts["OFFER_IN_PROGRESS"] ?? 0),
            shortlisted: rq.canonicalCounts["SHORTLISTED"] ?? 0,
          })),
      };
    });

    data.sort((a, b) => b.sourced - a.sourced);

    return res.json({
      success: true,
      data,
      total: data.length,
      meta: {
        stages: allStages.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
          order: s.order,
          canonicalStage: s.canonicalStage ?? null,
        })),
        canonicalKeys,
        scope: req.scopeFilter?.type ?? "ALL",
      },
    });
  } catch (err) {
    console.error("getRecruiterReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter report" });
  }
};

// GET /reports/recruiters/export
export const exportRecruiterReport = async (req: Request, res: Response) => {
  try {
    const { clientId, serviceLineId, fromDate, toDate, recruiterId } =
      req.query as Record<string, string>;
    const view = (req.query.view as string) ?? "summary";

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

    const reqWhere = buildReqWhere({
      clientId,
      serviceLineId,
      fromDate,
      toDate,
    } as any);
    const allStages = await fetchAllStages();
    const canonicalKeys = [
      ...new Set(
        allStages
          .filter((s) => s.canonicalStage !== null)
          .map((s) => s.canonicalStage as string)
      ),
    ];

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirement: reqWhere, ...recruiterFilter },
      select: {
        ...PIPELINE_DETAIL_SELECT,
        requirement: { select: { id: true, reqCode: true, title: true } },
      },
      orderBy: [{ recruiterId: "asc" }, { createdAt: "asc" }],
      take: 5000,
    });

    // Aggregate per recruiter for Sheet 1
    type Agg = {
      name: string;
      email: string;
      sourced: number;
      submitted: number;
      joined: number;
      dropped: number;
      active: number;
      submitTimeMins: number[];
      requirementIds: Set<string>;
      stageCounts: Record<string, number>;
      canonicalCounts: Record<string, number>;
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
          joined: 0,
          dropped: 0,
          active: 0,
          submitTimeMins: [],
          requirementIds: new Set(),
          stageCounts: Object.fromEntries(allStages.map((s) => [s.id, 0])),
          canonicalCounts: {},
        };
      }
      const r = recruiterMap[rid];
      r.requirementIds.add(p.requirementId);
      r.sourced++;
      if (p.currentStageId in r.stageCounts) r.stageCounts[p.currentStageId]++;
      const canonical = p.currentStage?.canonicalStage ?? null;
      if (canonical)
        r.canonicalCounts[canonical] = (r.canonicalCounts[canonical] ?? 0) + 1;
      if (p.submittedAt) r.submitted++;
      if (p.disposition === "PLACED" || p.actualJoiningDate) r.joined++;
      if (p.disposition === "DROPPED" || p.isRejected || p.isWithdrawn)
        r.dropped++;
      if (p.disposition === "ACTIVE") r.active++;
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

    // Active stages for pipeline view
    const activeStageIds = new Set<string>();
    if (view === "pipeline") {
      for (const r of summaryRows) {
        for (const [sid, cnt] of Object.entries(r.stageCounts)) {
          if (cnt > 0) activeStageIds.add(sid);
        }
      }
    }
    const activeStages = allStages.filter((s) => activeStageIds.has(s.id));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // Sheet 1: Recruiter summary
    const sheet1 = workbook.addWorksheet("Recruiter Summary", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const fixedLeft = [
      { header: "Recruiter", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Requirements", key: "reqs", width: 14 },
      { header: "Sourced", key: "sourced", width: 12 },
    ];
    const dynamicCols =
      view === "pipeline"
        ? activeStages.map((s) => ({
            header: s.label,
            key: `stage_${s.id}`,
            width: 16,
          }))
        : canonicalKeys.map((key) => ({
            header: humanKey(key),
            key: `canonical_${key}`,
            width: 16,
          }));
    const fixedRight = [
      { header: "Active", key: "active", width: 12 },
      { header: "Avg Days to Submit", key: "avgDays", width: 18 },
    ];
    sheet1.columns = [...fixedLeft, ...dynamicCols, ...fixedRight];
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
      if (view === "pipeline") {
        for (const s of activeStages)
          dynVals[`stage_${s.id}`] = r.stageCounts[s.id] ?? 0;
      } else {
        for (const key of canonicalKeys)
          dynVals[`canonical_${key}`] = r.canonicalCounts[key] ?? 0;
      }
      sheet1.addRow({
        name: r.name,
        email: r.email,
        reqs: r.requirementIds.size,
        sourced: r.sourced,
        ...dynVals,
        active: r.active,
        avgDays,
      }).height = 18;
    }
    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: 1,
        column: fixedLeft.length + dynamicCols.length + fixedRight.length,
      },
    };

    // Sheet 2: All candidates
    const reqLookup = Object.fromEntries(
      pipelines.map((p) => [p.requirementId, (p as any).requirement])
    );
    buildCandidateSheet(workbook, pipelines, reqLookup);

    const viewLabel =
      view === "pipeline"
        ? "all-stages"
        : view === "funnel"
        ? "stage-funnel"
        : "summary";
    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-report-${viewLabel}-${dateStr}.xlsx"`
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
// 2. REQUIREMENT REPORT
// List all requirements with per-requirement candidate stats
// Per-row download via GET /reports/requirements/:id/export
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/requirements
export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;

    // Scope: only requirements created by self + reportees (full org tree down)
    // SuperAdmin gets all. A recruiter gets only their own.
    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin
    );
    const baseReqWhere = buildReqWhere(q);
    const reqWhere =
      creatorIds !== null
        ? { ...baseReqWhere, createdById: { in: creatorIds } }
        : baseReqWhere;

    const canonicalKeys = await fetchCanonicalKeys();
    const allStages = await fetchAllStages();
    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    const page = parseInt(q.page ?? "1");
    const limit = Math.min(parseInt(q.limit ?? "25"), 100);
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
          client: { select: { id: true, name: true } },
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
        meta: { total, page, limit, pages: Math.ceil(total / limit) },
        canonicalKeys,
      });
    }

    const reqIds = requirements.map((r) => r.id);

    // Pipeline stage counts per requirement
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      const stage = stageById[sc.currentStageId];
      if (!stage?.canonicalStage) continue;
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][stage.canonicalStage] =
        (countsByReq[sc.requirementId][stage.canonicalStage] ?? 0) +
        sc._count.id;
    }

    const data = requirements.map((r) => {
      const canonical = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(canonical).reduce(
        (s, n) => s + n,
        0
      );
      return {
        ...r,
        totalCandidates,
        canonicalStageCounts: Object.fromEntries(
          canonicalKeys.map((k) => [k, canonical[k] ?? 0])
        ),
      };
    });

    return res.json({
      success: true,
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
      canonicalKeys,
    });
  } catch (err) {
    console.error("getRequirementReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement report" });
  }
};

// GET /reports/requirements/export  OR  /reports/requirements/:id/export
export const exportRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const singleId = req.params.id ?? null; // set when /requirements/:id/export

    // Single requirement export — no scope filter needed (direct ID access)
    // Bulk export — scope to requirements created by self + reportees
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
    }

    const canonicalKeys = await fetchCanonicalKeys();
    const allStages = await fetchAllStages();
    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

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
        client: { select: { name: true } },
        businessUnit: { select: { name: true } },
        serviceLine: { select: { name: true } },
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

    // Stage counts for Sheet 1
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });
    const canonicalByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      const stage = stageById[sc.currentStageId];
      if (!stage?.canonicalStage) continue;
      if (!canonicalByReq[sc.requirementId])
        canonicalByReq[sc.requirementId] = {};
      canonicalByReq[sc.requirementId][stage.canonicalStage] =
        (canonicalByReq[sc.requirementId][stage.canonicalStage] ?? 0) +
        sc._count.id;
    }

    // All pipeline rows for Sheet 2
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirementId: { in: reqIds } },
      select: PIPELINE_DETAIL_SELECT,
      orderBy: { createdAt: "asc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // Sheet 1: Requirements
    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    const fixedCols = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Title", key: "title", width: 40 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Client", key: "client", width: 24 },
      { header: "Business Unit", key: "bu", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "City", key: "city", width: 16 },
      { header: "Country", key: "country", width: 14 },
      { header: "Job Type", key: "jobType", width: 16 },
      { header: "Remote", key: "remote", width: 12 },
      { header: "Total Openings", key: "openings", width: 14 },
      { header: "Created By", key: "createdBy", width: 22 },
      { header: "Created Date", key: "createdAt", width: 18 },
      { header: "Days Open", key: "daysOpen", width: 12 },
      { header: "Respond By", key: "respondBy", width: 18 },
      { header: "SLA Breached?", key: "breached", width: 14 },
      { header: "Total Candidates", key: "total", width: 16 },
    ];
    const canonicalCols = canonicalKeys.map((key) => ({
      header: humanKey(key),
      key: `cs_${key}`,
      width: 14,
    }));
    sheet1.columns = [...fixedCols, ...canonicalCols];

    // Group header row 1
    const groupRow = sheet1.getRow(1);
    groupRow.getCell(1).value = "Requirement Details";
    if (canonicalCols.length > 0) {
      groupRow.getCell(fixedCols.length + 1).value = "Pipeline Stages";
      sheet1.mergeCells(1, 1, 1, fixedCols.length);
      sheet1.mergeCells(
        1,
        fixedCols.length + 1,
        1,
        fixedCols.length + canonicalCols.length
      );
    }
    styleHdr(groupRow);
    if (canonicalCols.length > 0)
      groupRow.getCell(fixedCols.length + 1).fill = SUB_FILL;

    // Column header row 2
    const colHdr = sheet1.getRow(2);
    [...fixedCols, ...canonicalCols].forEach((col, i) => {
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

    for (const req of requirements) {
      const canonical = canonicalByReq[req.id] ?? {};
      const totalCandidates = Object.values(canonical).reduce(
        (s, n) => s + n,
        0
      );
      const daysOpen = Math.floor(
        (now - new Date(req.createdAt).getTime()) / 86400000
      );

      const rowData: Record<string, any> = {
        reqCode: req.reqCode,
        title: req.title,
        status: req.status,
        priority: req.priority,
        client: req.client?.name ?? "",
        bu: req.businessUnit?.name ?? "",
        sl: req.serviceLine?.name ?? "",
        city: req.city ?? "",
        country: req.country ?? "",
        jobType: req.jobType,
        remote: req.remoteType,
        openings: req.totalOpenings,
        createdBy: `${req.createdBy.firstName} ${req.createdBy.lastName}`,
        createdAt: new Date(req.createdAt),
        daysOpen,
        respondBy: req.respondBy ? new Date(req.respondBy) : "",
        breached:
          req.isRespondByBreached || req.isTurnaroundBreached ? "Yes" : "No",
        total: totalCandidates,
      };
      for (const key of canonicalKeys)
        rowData[`cs_${key}`] = canonical[key] ?? 0;

      const dataRow = sheet1.addRow(rowData);
      dataRow.height = 20;
      dataRow.getCell("createdAt").numFmt = "dd-mmm-yyyy";
      if (req.respondBy) dataRow.getCell("respondBy").numFmt = "dd-mmm-yyyy";

      const sc = STATUS_COLORS[req.status];
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
      if (req.isRespondByBreached || req.isTurnaroundBreached) {
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
      to: { row: 2, column: fixedCols.length + canonicalCols.length },
    };

    // Sheet 2: Candidates
    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));
    buildCandidateSheet(workbook, pipelines, reqLookup);

    const suffix = singleId ? requirements[0]?.reqCode ?? singleId : "all";
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
// 3. ASSIGNMENT REPORT
// Same pattern as requirement report — list assignments with candidate stats
// Per-row download via GET /reports/assignments/:id/export
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/assignments
export const getAssignmentReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const scopedUserIds = await resolveScopedUserIds(req);
    const canonicalKeys = await fetchCanonicalKeys();
    const allStages = await fetchAllStages();
    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    const page = parseInt(q.page ?? "1");
    const limit = Math.min(parseInt(q.limit ?? "25"), 100);
    const skip = (page - 1) * limit;

    const assignmentWhere: Record<string, any> = { status: "ACTIVE" };
    if (scopedUserIds !== null)
      assignmentWhere.assignedToId = { in: scopedUserIds };
    if (q.requirementId) assignmentWhere.requirementId = q.requirementId;
    if (q.status) assignmentWhere.status = q.status;

    const [total, assignments] = await Promise.all([
      prisma.requirementAssignment.count({ where: assignmentWhere }),
      prisma.requirementAssignment.findMany({
        where: assignmentWhere,
        select: {
          id: true,
          depth: true,
          status: true,
          allocatedOpenings: true,
          deadline: true,
          assignedAt: true,
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
              role: { select: { name: true } },
            },
          },
          assignedBy: { select: { id: true, firstName: true, lastName: true } },
          requirement: {
            select: {
              id: true,
              reqCode: true,
              title: true,
              status: true,
              priority: true,
              totalOpenings: true,
              client: { select: { id: true, name: true } },
              serviceLine: { select: { id: true, name: true } },
              businessUnit: { select: { id: true, name: true } },
            },
          },
          _count: { select: { pipelines: true } },
        },
        orderBy: { assignedAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    if (!assignments.length) {
      return res.json({
        success: true,
        data: [],
        meta: { total, page, limit, pages: Math.ceil(total / limit) },
        canonicalKeys,
      });
    }

    const assignmentIds = assignments.map((a) => a.id);

    // Pipeline stage counts per assignment
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["assignmentId", "currentStageId"],
      where: { assignmentId: { in: assignmentIds } },
      _count: { id: true },
    });

    const countsByAssignment: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!sc.assignmentId) continue;
      const stage = stageById[sc.currentStageId];
      if (!stage?.canonicalStage) continue;
      if (!countsByAssignment[sc.assignmentId])
        countsByAssignment[sc.assignmentId] = {};
      countsByAssignment[sc.assignmentId][stage.canonicalStage] =
        (countsByAssignment[sc.assignmentId][stage.canonicalStage] ?? 0) +
        sc._count.id;
    }

    const data = assignments.map((a) => {
      const canonical = countsByAssignment[a.id] ?? {};
      const totalCandidates = Object.values(canonical).reduce(
        (s, n) => s + n,
        0
      );
      return {
        ...a,
        totalCandidates,
        canonicalStageCounts: Object.fromEntries(
          canonicalKeys.map((k) => [k, canonical[k] ?? 0])
        ),
      };
    });

    return res.json({
      success: true,
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
      canonicalKeys,
    });
  } catch (err) {
    console.error("getAssignmentReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignment report" });
  }
};

// GET /reports/assignments/export  OR  /reports/assignments/:id/export
export const exportAssignmentReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const singleId = req.params.id ?? null;
    const scopedUserIds = await resolveScopedUserIds(req);

    const canonicalKeys = await fetchCanonicalKeys();

    const assignmentWhere: Record<string, any> = {};
    if (singleId) {
      assignmentWhere.id = singleId;
    } else {
      assignmentWhere.status = "ACTIVE";
      if (scopedUserIds !== null)
        assignmentWhere.assignedToId = { in: scopedUserIds };
      if (q.requirementId) assignmentWhere.requirementId = q.requirementId;
    }

    const assignments = await prisma.requirementAssignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        depth: true,
        status: true,
        allocatedOpenings: true,
        deadline: true,
        assignedAt: true,
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            role: { select: { name: true } },
          },
        },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            totalOpenings: true,
            client: { select: { name: true } },
            serviceLine: { select: { name: true } },
            businessUnit: { select: { name: true } },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
      take: 1000,
    });

    if (!assignments.length) {
      return res
        .status(404)
        .json({ success: false, message: "No assignments found" });
    }

    const assignmentIds = assignments.map((a) => a.id);

    // Stage counts for Sheet 1
    const allStages = await fetchAllStages();
    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["assignmentId", "currentStageId"],
      where: { assignmentId: { in: assignmentIds } },
      _count: { id: true },
    });
    const canonicalByAssignment: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!sc.assignmentId) continue;
      const stage = stageById[sc.currentStageId];
      if (!stage?.canonicalStage) continue;
      if (!canonicalByAssignment[sc.assignmentId])
        canonicalByAssignment[sc.assignmentId] = {};
      canonicalByAssignment[sc.assignmentId][stage.canonicalStage] =
        (canonicalByAssignment[sc.assignmentId][stage.canonicalStage] ?? 0) +
        sc._count.id;
    }

    // All pipeline rows for Sheet 2
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { assignmentId: { in: assignmentIds } },
      select: PIPELINE_DETAIL_SELECT,
      orderBy: { createdAt: "asc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // Sheet 1: Assignment summary
    const sheet1 = workbook.addWorksheet("Assignments", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const canonicalCols = canonicalKeys.map((key) => ({
      header: humanKey(key),
      key: `cs_${key}`,
      width: 14,
    }));
    sheet1.columns = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "reqTitle", width: 36 },
      { header: "Req Status", key: "reqStatus", width: 14 },
      { header: "Client", key: "client", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "Business Unit", key: "bu", width: 20 },
      { header: "Assigned To", key: "assignedTo", width: 24 },
      { header: "Employee ID", key: "empId", width: 14 },
      { header: "Role", key: "role", width: 18 },
      { header: "Assigned By", key: "assignedBy", width: 22 },
      { header: "Depth", key: "depth", width: 10 },
      { header: "Status", key: "status", width: 14 },
      { header: "Allocated Openings", key: "allocated", width: 16 },
      { header: "Total Openings", key: "totalOpen", width: 14 },
      { header: "Deadline", key: "deadline", width: 16 },
      { header: "Assigned On", key: "assignedAt", width: 16 },
      { header: "Total Candidates", key: "total", width: 16 },
      ...canonicalCols,
    ];
    styleHdr(sheet1.getRow(1));

    for (const a of assignments) {
      const canonical = canonicalByAssignment[a.id] ?? {};
      const totalCandidates = Object.values(canonical).reduce(
        (s, n) => s + n,
        0
      );
      const dynVals: Record<string, number> = {};
      for (const key of canonicalKeys)
        dynVals[`cs_${key}`] = canonical[key] ?? 0;

      const row = sheet1.addRow({
        reqCode: (a as any).requirement?.reqCode ?? "",
        reqTitle: (a as any).requirement?.title ?? "",
        reqStatus: (a as any).requirement?.status ?? "",
        client: (a as any).requirement?.client?.name ?? "",
        sl: (a as any).requirement?.serviceLine?.name ?? "",
        bu: (a as any).requirement?.businessUnit?.name ?? "",
        assignedTo: `${a.assignedTo.firstName} ${a.assignedTo.lastName}`,
        empId: a.assignedTo.employeeId ?? "",
        role: (a.assignedTo as any).role?.name ?? "",
        assignedBy: `${a.assignedBy.firstName} ${a.assignedBy.lastName}`,
        depth: a.depth,
        status: a.status,
        allocated: a.allocatedOpenings ?? "",
        totalOpen: (a as any).requirement?.totalOpenings ?? "",
        deadline: a.deadline ? new Date(a.deadline) : "",
        assignedAt: new Date(a.assignedAt),
        total: totalCandidates,
        ...dynVals,
      });
      row.height = 18;
      row.getCell("assignedAt").numFmt = "dd-mmm-yyyy";
      if (a.deadline) row.getCell("deadline").numFmt = "dd-mmm-yyyy";
    }
    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet1.columnCount },
    };

    // Sheet 2: Candidates
    const reqLookup: Record<string, any> = {};
    for (const a of assignments) {
      const req = (a as any).requirement;
      if (req) reqLookup[req.id] = req;
    }
    buildCandidateSheet(workbook, pipelines, reqLookup);

    const suffix = singleId ?? "all";
    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="assignments-${suffix}-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportAssignmentReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export assignment report" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 4. CANDIDATE FUNNEL REPORT
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// GET /reports/candidates
export const getCandidateReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const reqWhere = buildReqWhere(q);
    const canonicalKeys = await fetchCanonicalKeys();

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirement: reqWhere },
      select: {
        disposition: true,
        isRejected: true,
        isWithdrawn: true,
        stageUpdatedAt: true,
        currentStage: { select: { canonicalStage: true } },
        stageHistory: { select: { timeInPrevStageMins: true } },
      },
    });

    const funnelCounts: Record<string, number> = Object.fromEntries(
      canonicalKeys.map((k) => [k, 0])
    );
    const dispositionCounts: Record<string, number> = {};
    let totalAgingMins = 0;

    for (const p of pipelines) {
      const canonical = p.currentStage?.canonicalStage;
      if (canonical && canonical in funnelCounts) funnelCounts[canonical]++;
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
        funnelByCanonicalStage: canonicalKeys.map((stage) => ({
          stage,
          count: funnelCounts[stage],
          pct:
            total > 0 ? +((funnelCounts[stage] / total) * 100).toFixed(1) : 0,
        })),
        dispositionSummary: dispositionCounts,
        avgPipelineDays:
          total > 0 ? +(totalAgingMins / total / 1440).toFixed(1) : 0,
      },
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

    const stageFilter = q.canonicalStage
      ? { currentStage: { canonicalStage: q.canonicalStage as any } }
      : {};
    const dispositionFilter = q.disposition
      ? { disposition: q.disposition as any }
      : {};

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirement: reqWhere, ...stageFilter, ...dispositionFilter },
      select: {
        ...PIPELINE_DETAIL_SELECT,
        requirement: { select: { id: true, reqCode: true, title: true } },
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
      `attachment; filename="candidate-report-${dateStr}.xlsx"`
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
