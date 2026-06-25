// File: reports.controller.ts
// Path: src/controller/reports.controller.ts

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import puppeteer from "puppeteer";
import { PermissionScope } from "@prisma/client";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface GlobalReportFilters {
  clientId?: string;
  buId?: string;
  serviceLineId?: string;
  fromDate?: string;
  toDate?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: buildGlobalWhere
// ─────────────────────────────────────────────────────────────────────────────

function buildGlobalWhere(filters: GlobalReportFilters): Record<string, any> {
  const where: Record<string, any> = {};
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.serviceLineId) where.serviceLineId = filters.serviceLineId;
  if (filters.buId) where.businessUnit = { ancestorIds: { has: filters.buId } };
  if (filters.fromDate || filters.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = new Date(filters.fromDate);
    if (filters.toDate) where.createdAt.lte = new Date(filters.toDate);
  }
  return where;
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

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FFFFFFFF" },
  bold: true,
  size: 11,
};

function styleHeaderRow(row: ExcelJS.Row, fill = HEADER_FILL) {
  row.eachCell((cell) => {
    cell.fill = fill;
    cell.font = HEADER_FONT;
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FF4A90D9" } } };
  });
  row.height = 28;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: Puppeteer PDF
// ─────────────────────────────────────────────────────────────────────────────

async function renderPDF(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdf = await page.pdf({
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
  });
  await browser.close();
  return Buffer.from(pdf);
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT — same pattern as assignment.controller.ts
// canonicalStage lives on currentStage.canonicalStage — never a stored field
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_SELECT_FOR_REPORTS = {
  id: true,
  recruiterId: true,
  requirementId: true,
  currentStageId: true,
  disposition: true,
  submittedAt: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  offerStatus: true,
  actualJoiningDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      canonicalStage: true, // ← single source of truth, same as assignment.controller
    },
  },
  stageHistory: {
    select: { timeInPrevStageMins: true },
  },
  recruiter: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: computeRecruiterStats
//
// Takes pipeline rows (already fetched) and computes per-recruiter stats.
// Mirrors computePipelineStats from assignment.controller but keyed by recruiter.
// byPipelineStage and byCanonicalStage are built from currentStage.canonicalStage
// — never from a hardcoded enum or stored field.
// ─────────────────────────────────────────────────────────────────────────────

function computeRecruiterStats(pipelines: any[], allStages: any[]) {
  // Build per-recruiter aggregation map
  type RecruiterAgg = {
    id: string;
    name: string;
    email: string;
    sourced: number;
    submitted: number;
    joined: number;
    dropped: number;
    active: number;
    requirementIds: Set<string>;
    submitTimeMins: number[];
    // keyed by stageId
    stageCounts: Record<string, number>;
    // keyed by canonicalStage string
    canonicalCounts: Record<string, number>;
  };

  const recruiterMap: Record<string, RecruiterAgg> = {};

  for (const p of pipelines) {
    const rid = p.recruiter.id;
    if (!recruiterMap[rid]) {
      recruiterMap[rid] = {
        id: rid,
        name: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
        email: p.recruiter.email,
        sourced: 0,
        submitted: 0,
        joined: 0,
        dropped: 0,
        active: 0,
        requirementIds: new Set(),
        submitTimeMins: [],
        // initialise all stage slots at 0 so we always return full map
        stageCounts: Object.fromEntries(allStages.map((s: any) => [s.id, 0])),
        canonicalCounts: {},
      };
    }

    const r = recruiterMap[rid];
    r.requirementIds.add(p.requirementId);
    r.sourced++;

    // ── Per pipeline stage count (same pattern as byPipelineStage in assignment.controller)
    if (p.currentStageId && p.currentStageId in r.stageCounts) {
      r.stageCounts[p.currentStageId]++;
    }

    // ── Canonical stage count — read from currentStage.canonicalStage (single source of truth)
    const canonical = p.currentStage?.canonicalStage ?? null;
    if (canonical) {
      r.canonicalCounts[canonical] = (r.canonicalCounts[canonical] ?? 0) + 1;
    }

    if (p.submittedAt) r.submitted++;
    if (p.disposition === "PLACED" || p.actualJoiningDate) r.joined++;
    if (p.disposition === "DROPPED" || p.isRejected || p.isWithdrawn)
      r.dropped++;
    if (p.disposition === "ACTIVE") r.active++;

    if (p.submittedAt) {
      const mins = (p.stageHistory ?? []).reduce(
        (s: number, log: any) => s + (log.timeInPrevStageMins ?? 0),
        0
      );
      r.submitTimeMins.push(mins);
    }
  }

  return Object.values(recruiterMap).map((r) => {
    // shortlisted + offered derived from canonical counts — same as computePipelineStats
    const shortlisted = r.canonicalCounts["SHORTLISTED"] ?? 0;
    const offered =
      (r.canonicalCounts["OFFERED"] ?? 0) +
      (r.canonicalCounts["OFFER_IN_PROGRESS"] ?? 0);

    // ── stageBreakdown — same shape as byPipelineStage in assignment.controller
    const stageBreakdown = allStages
      .map((s: any) => ({
        stageId: s.id,
        code: s.code,
        label: s.label,
        order: s.order,
        canonicalStage: s.canonicalStage ?? null,
        count: r.stageCounts[s.id] ?? 0,
      }))
      .filter((s: any) => s.count > 0);

    return {
      id: r.id,
      name: r.name,
      email: r.email,
      requirementsCount: r.requirementIds.size,
      sourced: r.sourced,
      submitted: r.submitted,
      shortlisted,
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
      // ── canonical rollup — keys are whatever the DB has, never hardcoded
      canonicalStageCounts: r.canonicalCounts,
      // ── per-stage detail — only stages with at least 1 candidate
      stageBreakdown,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: resolveVisibleRecruiterIds
//
// Mirrors the scope logic used in requirement/assignment controllers.
// Returns null for superAdmin / ALL — meaning no filter (entire org).
// ─────────────────────────────────────────────────────────────────────────────

async function resolveVisibleRecruiterIds(
  userId: string,
  isSuperAdmin: boolean,
  scope: PermissionScope,
  userDepartmentId?: string | null
): Promise<string[] | null> {
  // superAdmin or ALL → no filter, entire org
  if (isSuperAdmin || scope === PermissionScope.ALL) return null;

  if (scope === PermissionScope.OWN) return [userId];

  if (scope === PermissionScope.TEAM) {
    const members = await prisma.user.findMany({
      where: { teamLeadId: userId, isActive: true },
      select: { id: true },
    });
    return [userId, ...members.map((u) => u.id)];
  }

  if (scope === PermissionScope.REPORTING) {
    const reportees = await prisma.user.findMany({
      where: { reportingToId: userId, isActive: true },
      select: { id: true },
    });
    return [userId, ...reportees.map((u) => u.id)];
  }

  if (scope === PermissionScope.REPORTING_LINE) {
    // Recursive BFS down the full reporting tree
    const collected = new Set<string>([userId]);
    const queue = [userId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = await prisma.user.findMany({
        where: { reportingToId: current, isActive: true },
        select: { id: true },
      });
      for (const c of children) {
        if (!collected.has(c.id)) {
          collected.add(c.id);
          queue.push(c.id);
        }
      }
    }
    return [...collected];
  }

  if (scope === PermissionScope.DEPARTMENT) {
    if (!userDepartmentId) return [userId];
    const deptUsers = await prisma.user.findMany({
      where: { departmentId: userDepartmentId, isActive: true },
      select: { id: true },
    });
    return deptUsers.map((u) => u.id);
  }

  if (scope === PermissionScope.BU) {
    const callerAssignments = await prisma.requirementAssignment.findMany({
      where: { assignedToId: userId, status: "ACTIVE" },
      select: { assigneeBUId: true },
      distinct: ["assigneeBUId"],
    });
    const buIds = callerAssignments
      .map((a) => a.assigneeBUId)
      .filter(Boolean) as string[];
    if (buIds.length === 0) return [userId];
    const buUsers = await prisma.requirementAssignment.findMany({
      where: { assigneeBUId: { in: buIds }, status: "ACTIVE" },
      select: { assignedToId: true },
      distinct: ["assignedToId"],
    });
    return buUsers.map((a) => a.assignedToId);
  }

  return [userId]; // safe fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 1. RECRUITER REPORTS
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters
//
// Scope-aware. isSuperAdmin → null filter → entire org.
// All pipeline stages fetched from DB upfront.
// Per-recruiter stats computed in-memory from pipeline rows
// (same approach as computePipelineStats in assignment.controller).
// ─────────────────────────────────────────────────────────────────────────────
// File: reports.controller.ts (partial)
// Path: src/controller/reports.controller.ts
// Replace only getRecruiterReport

export const getRecruiterReport = async (req: Request, res: Response) => {
  try {
    const { clientId, buId, serviceLineId, fromDate, toDate, recruiterId } =
      req.query as Record<string, string>;

    // ── scopeFilter middleware already resolved req.scopeFilter — read it directly
    const sf = req.scopeFilter;

    // Resolve visible recruiter IDs from already-resolved scope
    // null = entire org (ALL / superAdmin), string[] = scoped list
    let scopedRecruiterIds: string[] | null = null;

    if (!sf || sf.type === "ALL") {
      scopedRecruiterIds = null; // entire org, no filter
    } else if (sf.type === "OWN") {
      scopedRecruiterIds = [sf.userId];
    } else if (sf.type === "TEAM") {
      scopedRecruiterIds = sf.teamMemberIds ?? [sf.userId];
    } else if (sf.type === "REPORTING") {
      scopedRecruiterIds = sf.subordinateIds ?? [sf.userId];
    } else if (sf.type === "BU") {
      scopedRecruiterIds = sf.subordinateIds ?? [sf.userId];
    } else if (sf.type === "DEPARTMENT") {
      if (!sf.departmentId) {
        scopedRecruiterIds = [sf.userId];
      } else {
        const users = await prisma.user.findMany({
          where: { departmentId: sf.departmentId, isActive: true },
          select: { id: true },
        });
        scopedRecruiterIds = users.map((u) => u.id);
      }
    } else if (sf.type === "REPORTING_LINE") {
      // Middleware resolves manager IDs. Walk the FULL tree downward via
      // recursive SQL to capture every recruiter at every depth under them.
      const seedIds: string[] = sf.reportingLineIds ?? [sf.userId];

      const rows: { id: string }[] = await prisma.$queryRaw`
        WITH RECURSIVE full_tree AS (
          SELECT id FROM "User"
          WHERE id = ANY(${seedIds}::uuid[])
            AND "isActive" = true

          UNION ALL

          SELECT u.id FROM "User" u
          INNER JOIN full_tree ft ON u."reportingToId" = ft.id
          WHERE u."isActive" = true
        )
        SELECT DISTINCT id::text FROM full_tree
      `;

      scopedRecruiterIds = rows.map((r) => r.id);
    }

    const globalWhere = buildGlobalWhere({
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
    });

    // Optional drill-down into a single recruiter
    let recruiterFilter: Record<string, any> = {};
    if (recruiterId) {
      if (
        scopedRecruiterIds !== null &&
        !scopedRecruiterIds.includes(recruiterId)
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      }
      recruiterFilter = { recruiterId };
    } else if (scopedRecruiterIds !== null) {
      recruiterFilter = { recruiterId: { in: scopedRecruiterIds } };
    }
    // null → no recruiter filter → entire org

    const allStages = await prisma.pipelineStage.findMany({
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

    const allCanonicalKeys = [
      ...new Set(
        allStages
          .filter((s) => s.canonicalStage !== null)
          .map((s) => s.canonicalStage as string)
      ),
    ];

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: {
        requirement: { ...globalWhere, deletedAt: null },
        ...recruiterFilter,
      },
      select: PIPELINE_SELECT_FOR_REPORTS,
    });

    const data = computeRecruiterStats(pipelines, allStages);
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
        canonicalKeys: allCanonicalKeys,
        scope: sf?.type ?? "ALL",
      },
    });
  } catch (err) {
    console.error("getRecruiterReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter report" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/export — XLSX
// Sheet 1: Recruiter summary
// Sheet 2: All candidate details per recruiter
// ─────────────────────────────────────────────────────────────────────────────

export const exportRecruiterReport = async (req: Request, res: Response) => {
  try {
    const { clientId, buId, serviceLineId, fromDate, toDate, recruiterId } =
      req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope: PermissionScope = isSuperAdmin
      ? PermissionScope.ALL
      : req.modulePermission?.canViewScope ?? PermissionScope.OWN;

    const callerUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true },
    });

    const scopedRecruiterIds = await resolveVisibleRecruiterIds(
      userId,
      isSuperAdmin,
      canViewScope,
      callerUser?.departmentId
    );

    const globalWhere = buildGlobalWhere({
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
    });

    let recruiterFilter: Record<string, any> = {};
    if (recruiterId) {
      if (
        scopedRecruiterIds !== null &&
        !scopedRecruiterIds.includes(recruiterId)
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      }
      recruiterFilter = { recruiterId };
    } else if (scopedRecruiterIds !== null) {
      recruiterFilter = { recruiterId: { in: scopedRecruiterIds } };
    }

    const allStages = await prisma.pipelineStage.findMany({
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

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: {
        requirement: { ...globalWhere, deletedAt: null },
        ...recruiterFilter,
      },
      select: {
        ...PIPELINE_SELECT_FOR_REPORTS,
        requirement: { select: { reqCode: true, title: true } },
        snapshot: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            currentCompany: true,
            totalExpYears: true,
          },
        },
      },
      orderBy: [{ recruiterId: "asc" }, { createdAt: "asc" }],
      take: 5000,
    });

    // Build summary using same computeRecruiterStats
    const summaryData = computeRecruiterStats(pipelines, allStages);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // ── Sheet 1: Recruiter Summary
    const sheet1 = workbook.addWorksheet("Recruiter Summary", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet1.columns = [
      { header: "Recruiter", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Requirements", key: "reqs", width: 14 },
      { header: "Sourced", key: "sourced", width: 12 },
      { header: "Submitted", key: "submitted", width: 12 },
      { header: "Submission %", key: "subRate", width: 14 },
      { header: "Shortlisted", key: "shortlisted", width: 14 },
      { header: "Offered", key: "offered", width: 12 },
      { header: "Offer %", key: "offerRate", width: 12 },
      { header: "Joined", key: "joined", width: 12 },
      { header: "Join %", key: "joinRate", width: 12 },
      { header: "Dropped", key: "dropped", width: 12 },
      { header: "Active", key: "active", width: 12 },
      { header: "Avg Days to Submit", key: "avgDays", width: 18 },
    ];
    styleHeaderRow(sheet1.getRow(1));

    for (const s of summaryData) {
      sheet1.addRow({
        name: s.name,
        email: s.email,
        reqs: s.requirementsCount,
        sourced: s.sourced,
        submitted: s.submitted,
        subRate: s.submissionRate,
        shortlisted: s.shortlisted,
        offered: s.offered,
        offerRate: s.offerRate,
        joined: s.joined,
        joinRate: s.joinRate,
        dropped: s.dropped,
        active: s.active,
        avgDays: s.avgTimeToSubmitDays ?? "",
      }).height = 18;
    }
    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 14 },
    };

    // ── Sheet 2: Candidate Details
    const sheet2 = workbook.addWorksheet("Candidate Details", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet2.columns = [
      { header: "Recruiter", key: "recruiter", width: 24 },
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "reqTitle", width: 36 },
      { header: "Candidate Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Current Title", key: "title", width: 26 },
      { header: "Current Company", key: "company", width: 24 },
      { header: "Exp (yrs)", key: "exp", width: 10 },
      { header: "Current Stage", key: "stage", width: 22 },
      { header: "Canonical Stage", key: "canonical", width: 20 },
      { header: "Disposition", key: "disposition", width: 14 },
      { header: "Added On", key: "addedOn", width: 16 },
      { header: "Days in Pipeline", key: "pipelineDays", width: 16 },
      { header: "Submitted At", key: "submittedAt", width: 18 },
      { header: "Offer Status", key: "offerStatus", width: 14 },
      { header: "Joining Date", key: "joiningDate", width: 16 },
    ];
    styleHeaderRow(sheet2.getRow(1));

    const now = Date.now();
    for (const p of pipelines) {
      const totalMins =
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0
        ) + Math.floor((now - new Date(p.stageUpdatedAt).getTime()) / 60000);

      const row = sheet2.addRow({
        recruiter: `${p.recruiter.firstName} ${p.recruiter.lastName}`,
        reqCode: (p as any).requirement?.reqCode ?? "",
        reqTitle: (p as any).requirement?.title ?? "",
        name: (p as any).snapshot?.fullName ?? "",
        email: (p as any).snapshot?.email ?? "",
        phone: (p as any).snapshot?.phone ?? "",
        title: (p as any).snapshot?.currentTitle ?? "",
        company: (p as any).snapshot?.currentCompany ?? "",
        exp: (p as any).snapshot?.totalExpYears ?? "",
        stage: p.currentStage?.label ?? "",
        canonical: p.currentStage?.canonicalStage ?? "",
        disposition: p.disposition,
        addedOn: new Date(p.createdAt),
        pipelineDays: Math.floor(totalMins / 1440),
        submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
        offerStatus: p.offerStatus ?? "",
        joiningDate: p.actualJoiningDate ? new Date(p.actualJoiningDate) : "",
      });
      row.height = 18;
      row.getCell("addedOn").numFmt = "dd-mmm-yyyy";
      if (p.submittedAt)
        row.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (p.actualJoiningDate)
        row.getCell("joiningDate").numFmt = "dd-mmm-yyyy";

      if (p.disposition === "DROPPED" || p.isRejected || p.isWithdrawn) {
        row.eachCell((c) => {
          c.font = { ...c.font, color: { argb: "FF7A869A" } };
        });
      }
    }
    sheet2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 17 },
    };

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-report-${dateStr}.xlsx"`
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
// 2. CANDIDATE REPORTS
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates
//
// Funnel by canonical stage + disposition summary.
// Canonical stage read from currentStage.canonicalStage — same as assignment.controller.
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidateReport = async (req: Request, res: Response) => {
  try {
    const { clientId, buId, serviceLineId, fromDate, toDate } =
      req.query as Record<string, string>;

    const globalWhere = buildGlobalWhere({
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
    });

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirement: { ...globalWhere, deletedAt: null } },
      select: {
        disposition: true,
        isRejected: true,
        isWithdrawn: true,
        stageUpdatedAt: true,
        currentStage: { select: { canonicalStage: true, order: true } },
        stageHistory: { select: { timeInPrevStageMins: true } },
      },
    });

    // Fetch canonical keys from DB in order — never hardcoded
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true, canonicalStage: { not: null } },
      select: { canonicalStage: true, order: true },
      distinct: ["canonicalStage"],
      orderBy: { order: "asc" },
    });
    const canonicalKeys = allStages.map((s) => s.canonicalStage as string);

    // Build funnel counts from pipeline rows (same in-memory approach as assignment.controller)
    const funnelCounts: Record<string, number> = Object.fromEntries(
      canonicalKeys.map((k) => [k, 0])
    );
    const dispositionCounts: Record<string, number> = {};
    let totalAgingMins = 0;

    for (const p of pipelines) {
      const canonical = p.currentStage?.canonicalStage;
      if (canonical && canonical in funnelCounts) funnelCounts[canonical]++;

      // disposition keys come from actual data — never hardcoded
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/export — XLSX
// ─────────────────────────────────────────────────────────────────────────────

export const exportCandidateReport = async (req: Request, res: Response) => {
  try {
    const {
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
      canonicalStage,
      disposition,
    } = req.query as Record<string, string>;

    const globalWhere = buildGlobalWhere({
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
    });

    const stageFilter = canonicalStage
      ? { currentStage: { canonicalStage: canonicalStage as any } }
      : {};
    const dispositionFilter = disposition
      ? { disposition: disposition as any }
      : {};

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: {
        requirement: { ...globalWhere, deletedAt: null },
        ...stageFilter,
        ...dispositionFilter,
      },
      select: {
        disposition: true,
        submittedAt: true,
        offerStatus: true,
        actualJoiningDate: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        createdAt: true,
        stageUpdatedAt: true,
        currentStage: { select: { label: true, canonicalStage: true } },
        recruiter: { select: { firstName: true, lastName: true } },
        requirement: {
          select: {
            reqCode: true,
            title: true,
            client: { select: { name: true } },
            businessUnit: { select: { name: true } },
            serviceLine: { select: { name: true } },
          },
        },
        snapshot: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            currentCompany: true,
            totalExpYears: true,
          },
        },
        stageHistory: { select: { timeInPrevStageMins: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Candidates", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "reqTitle", width: 36 },
      { header: "Client", key: "client", width: 24 },
      { header: "Business Unit", key: "bu", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "Candidate Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Exp (yrs)", key: "exp", width: 10 },
      { header: "Current Stage", key: "stage", width: 22 },
      { header: "Canonical Stage", key: "canonical", width: 20 },
      { header: "Disposition", key: "disposition", width: 14 },
      { header: "Recruiter", key: "recruiter", width: 22 },
      { header: "Added On", key: "addedOn", width: 16 },
      { header: "Days in Pipeline", key: "days", width: 16 },
      { header: "Aging", key: "aging", width: 12 },
      { header: "Submitted At", key: "submittedAt", width: 18 },
      { header: "Offer Status", key: "offerStatus", width: 14 },
      { header: "Joining Date", key: "joiningDate", width: 16 },
    ];
    styleHeaderRow(sheet.getRow(1));

    const now = Date.now();
    for (const p of pipelines) {
      const stageAge = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000
      );
      const totalMins =
        (p.stageHistory ?? []).reduce(
          (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
          0
        ) + stageAge;

      const row = sheet.addRow({
        reqCode: (p as any).requirement?.reqCode ?? "",
        reqTitle: (p as any).requirement?.title ?? "",
        client: (p as any).requirement?.client?.name ?? "",
        bu: (p as any).requirement?.businessUnit?.name ?? "",
        sl: (p as any).requirement?.serviceLine?.name ?? "",
        name: (p as any).snapshot?.fullName ?? "",
        email: (p as any).snapshot?.email ?? "",
        phone: (p as any).snapshot?.phone ?? "",
        exp: (p as any).snapshot?.totalExpYears ?? "",
        stage: p.currentStage?.label ?? "",
        canonical: p.currentStage?.canonicalStage ?? "",
        disposition: p.disposition,
        recruiter: p.recruiter
          ? `${p.recruiter.firstName} ${p.recruiter.lastName}`
          : "",
        addedOn: new Date(p.createdAt),
        days: Math.floor(totalMins / 1440),
        aging: formatAging(totalMins),
        submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
        offerStatus: p.offerStatus ?? "",
        joiningDate: p.actualJoiningDate ? new Date(p.actualJoiningDate) : "",
      });
      row.height = 18;
      row.getCell("addedOn").numFmt = "dd-mmm-yyyy";
      if (p.submittedAt)
        row.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (p.actualJoiningDate)
        row.getCell("joiningDate").numFmt = "dd-mmm-yyyy";
      if (p.isRejected || p.isWithdrawn) {
        row.eachCell((c) => {
          c.font = { ...c.font, color: { argb: "FF7A869A" } };
        });
      }
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 19 },
    };

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

// ─────────────────────────────────────────────────────────────────────────────
// ███████████████████████████████████████████████████████████████████████████
// 3. REQUIREMENT REPORTS
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const { clientId, buId, serviceLineId, fromDate, toDate } =
      req.query as Record<string, string>;

    const globalWhere = buildGlobalWhere({
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
    });
    const baseWhere = { ...globalWhere, deletedAt: null };

    const [
      byStatus,
      byPriority,
      byClient,
      byBU,
      byServiceLine,
      byJobType,
      byRemote,
      respondByBreachedCount,
      turnaroundBreachedCount,
      totalOpeningsAgg,
      placedCount,
    ] = await Promise.all([
      prisma.requirement.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.requirement.groupBy({
        by: ["priority"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.requirement.groupBy({
        by: ["clientId"],
        where: baseWhere,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      prisma.requirement.groupBy({
        by: ["businessUnitId"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.requirement.groupBy({
        by: ["serviceLineId"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.requirement.groupBy({
        by: ["jobType"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.requirement.groupBy({
        by: ["remoteType"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.requirement.count({
        where: { ...baseWhere, isRespondByBreached: true },
      }),
      prisma.requirement.count({
        where: { ...baseWhere, isTurnaroundBreached: true },
      }),
      prisma.requirement.aggregate({
        where: baseWhere,
        _sum: { totalOpenings: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { requirement: baseWhere, disposition: "PLACED" },
      }),
    ]);

    // Resolve display names in parallel
    const clientIds = byClient
      .map((r) => r.clientId)
      .filter(Boolean) as string[];
    const buIds = byBU.map((r) => r.businessUnitId).filter(Boolean) as string[];
    const slIds = byServiceLine
      .map((r) => r.serviceLineId)
      .filter(Boolean) as string[];

    const [clients, bus, sls] = await Promise.all([
      prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
      }),
      prisma.businessUnit.findMany({
        where: { id: { in: buIds } },
        select: { id: true, name: true },
      }),
      prisma.serviceLine.findMany({
        where: { id: { in: slIds } },
        select: { id: true, name: true },
      }),
    ]);

    const clientNameMap = Object.fromEntries(
      clients.map((c) => [c.id, c.name])
    );
    const buNameMap = Object.fromEntries(bus.map((b) => [b.id, b.name]));
    const slNameMap = Object.fromEntries(sls.map((s) => [s.id, s.name]));

    const totalReqs = byStatus.reduce((s, r) => s + r._count.id, 0);
    const totalOpen = totalOpeningsAgg._sum.totalOpenings ?? 0;
    const fillRate =
      totalOpen > 0 ? +((placedCount / totalOpen) * 100).toFixed(1) : 0;

    return res.json({
      success: true,
      data: {
        summary: {
          total: totalReqs,
          totalOpenings: totalOpen,
          totalPlaced: placedCount,
          fillRate,
          respondByBreached: respondByBreachedCount,
          turnaroundBreached: turnaroundBreachedCount,
        },
        byStatus: byStatus.map((r) => ({
          status: r.status,
          count: r._count.id,
        })),
        byPriority: byPriority.map((r) => ({
          priority: r.priority,
          count: r._count.id,
        })),
        byClient: byClient.map((r) => ({
          clientId: r.clientId,
          clientName: clientNameMap[r.clientId!] ?? "Unknown",
          count: r._count.id,
        })),
        byBU: byBU.map((r) => ({
          buId: r.businessUnitId,
          buName: buNameMap[r.businessUnitId!] ?? "Unknown",
          count: r._count.id,
        })),
        byServiceLine: byServiceLine.map((r) => ({
          serviceLineId: r.serviceLineId,
          serviceLineName: slNameMap[r.serviceLineId!] ?? "Unknown",
          count: r._count.id,
        })),
        byJobType: byJobType.map((r) => ({
          jobType: r.jobType,
          count: r._count.id,
        })),
        byRemoteType: byRemote.map((r) => ({
          remoteType: r.remoteType,
          count: r._count.id,
        })),
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
// ███████████████████████████████████████████████████████████████████████████
// 4. PDF EXPORT — Puppeteer + Chart.js
// ███████████████████████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────────

export const exportReportPDF = async (req: Request, res: Response) => {
  try {
    const { type } = req.params as { type: string };
    const { clientId, buId, serviceLineId, fromDate, toDate } =
      req.query as Record<string, string>;

    const globalWhere = buildGlobalWhere({
      clientId,
      buId,
      serviceLineId,
      fromDate,
      toDate,
    });

    let chartData: {
      labels: string[];
      values: number[];
      title: string;
      subtitle: string;
    };

    if (type === "recruiters") {
      const allStages = await prisma.pipelineStage.findMany({
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
      const pipelines = await prisma.requirementCandidatePipeline.findMany({
        where: { requirement: { ...globalWhere, deletedAt: null } },
        select: PIPELINE_SELECT_FOR_REPORTS,
        take: 5000,
      });
      const stats = computeRecruiterStats(pipelines, allStages)
        .sort((a, b) => b.sourced - a.sourced)
        .slice(0, 15);
      chartData = {
        title: "Recruiter Performance",
        subtitle: "Top 15 recruiters by candidates sourced",
        labels: stats.map((r) => r.name),
        values: stats.map((r) => r.sourced),
      };
    } else if (type === "candidates") {
      const allStages = await prisma.pipelineStage.findMany({
        where: { isActive: true, canonicalStage: { not: null } },
        select: { canonicalStage: true },
        distinct: ["canonicalStage"],
        orderBy: { order: "asc" },
      });
      const canonicalKeys = allStages.map((s) => s.canonicalStage as string);

      const counts = await prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: { requirement: { ...globalWhere, deletedAt: null } },
        _count: { id: true },
      });
      const stages = await prisma.pipelineStage.findMany({
        where: { isActive: true },
        select: { id: true, canonicalStage: true },
        orderBy: { order: "asc" },
      });
      const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]));
      const funnelMap: Record<string, number> = Object.fromEntries(
        canonicalKeys.map((k) => [k, 0])
      );
      for (const c of counts) {
        const s = stageMap[(c as any).currentStageId];
        if (s?.canonicalStage) {
          funnelMap[s.canonicalStage] =
            (funnelMap[s.canonicalStage] ?? 0) + (c as any)._count.id;
        }
      }
      chartData = {
        title: "Candidate Pipeline Funnel",
        subtitle: "Candidates by canonical stage",
        labels: canonicalKeys,
        values: canonicalKeys.map((k) => funnelMap[k]),
      };
    } else if (type === "requirements") {
      const byStatus = await prisma.requirement.groupBy({
        by: ["status"],
        where: { ...globalWhere, deletedAt: null },
        _count: { id: true },
      });
      chartData = {
        title: "Requirements by Status",
        subtitle: "All requirements across the system",
        labels: byStatus.map((r) => r.status),
        values: byStatus.map((r) => r._count.id),
      };
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Invalid report type. Use: recruiters | candidates | requirements",
      });
    }

    const html = buildChartHTML(chartData);
    const pdf = await renderPDF(html);

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${type}-report-${dateStr}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error("exportReportPDF:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export PDF" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: buildChartHTML — Chart.js via CDN for Puppeteer
// ─────────────────────────────────────────────────────────────────────────────

function buildChartHTML(data: {
  title: string;
  subtitle: string;
  labels: string[];
  values: number[];
}): string {
  const palette = [
    "#1E3A5F",
    "#2D5986",
    "#4A90D9",
    "#00875A",
    "#FF991F",
    "#DE350B",
    "#6B778C",
    "#0052CC",
    "#5E6C84",
    "#403294",
    "#0065FF",
    "#00C7E6",
    "#57D9A3",
    "#FF8B00",
    "#BF2600",
  ];
  const colors = data.labels.map((_, i) => palette[i % palette.length]);
  const chartJson = JSON.stringify({
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [
        {
          label: data.title,
          data: data.values,
          backgroundColor: colors,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: data.title,
          font: { size: 20, weight: "bold" },
          color: "#1E3A5F",
          padding: { bottom: 8 },
        },
        subtitle: {
          display: true,
          text: data.subtitle,
          font: { size: 13 },
          color: "#6B778C",
          padding: { bottom: 24 },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { maxRotation: 40, minRotation: 20 } },
      },
    },
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #fff; padding: 32px; }
    h1 { color: #1E3A5F; font-size: 22px; margin-bottom: 4px; }
    p.sub { color: #6B778C; font-size: 13px; margin-bottom: 24px; }
    .meta { font-size: 11px; color: #999; margin-top: 20px; text-align: right; }
    canvas { max-width: 100%; }
  </style>
</head>
<body>
  <h1>${data.title}</h1>
  <p class="sub">${data.subtitle}</p>
  <canvas id="chart" width="1100" height="480"></canvas>
  <p class="meta">Generated by TalentOS · ${new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  })}</p>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script>new Chart(document.getElementById('chart'), ${chartJson});</script>
</body>
</html>`;
}
