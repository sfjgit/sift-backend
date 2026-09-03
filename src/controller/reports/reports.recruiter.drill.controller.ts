// File: reports.recruiter.drill.controller.ts
// Path: src/controller/reports/reports.recruiter.drill.controller.ts
//
// GET /reports/recruiters/drill
//
// Dedicated drill endpoint for the Recruiters tab.
// Returns candidate rows for a recruiter (or all recruiters in scope).
// Supports every filter the tab uses PLUS:
//   - mojMonth   = "2025-01" (YYYY-MM) — filter by month of joining
//   - mojYear    = "2025"    — filter by year of joining (all months)
//   - type       = recruiter | stage | placed | near_terminal | active_pipeline
//                  | dropped | sourced (filters which candidates to return)
//   - recruiterId = specific recruiter (omit = all in scope)
//   - stageId    = specific stage (required when type=stage)
//
// Response shape exactly matches what RecruiterCandidateDrillDialog expects —
// no field mapping needed in the frontend.

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

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

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE
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
    default:
      return [scope.userId!];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOJ HELPERS — Month of Joining filter
// monthOfJoining stored as "June 2025" string on the pipeline row
// We also support ISO filter: mojMonth=2025-06, mojYear=2025
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
];

function mojToFilter(
  mojMonth?: string,
  mojYear?: string,
): Record<string, any> | null {
  // mojMonth = "2025-01" → "January 2025"
  if (mojMonth) {
    const [yr, mo] = mojMonth.split("-");
    const monthIdx = parseInt(mo, 10) - 1;
    if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return null;
    const label = `${MONTH_NAMES[monthIdx]} ${yr}`;
    return { monthOfJoining: label };
  }
  // mojYear = "2025" → contains "2025"
  if (mojYear) {
    return { monthOfJoining: { contains: mojYear } };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_SELECT = {
  id: true,
  recruiterId: true,
  requirementId: true,
  currentStageId: true,
  disposition: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  noticePeriod: true,
  lastWorkingDate: true,
  expectedJoiningDate: true,
  monthOfJoining: true,
  actualJoiningDate: true,
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
      resumeUrl: true,
    },
  },
  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      status: true,
      totalOpenings: true,
      salaryMin: true,
      salaryMax: true,
      saleValue: true,
      client: { select: { id: true, name: true } },
      clientSpoc: { select: { firstName: true, lastName: true } },
      serviceLine: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true } },
      band: { select: { code: true, name: true, value: true } },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BUILD ROW — maps a pipeline record to the DrillRow shape
// ─────────────────────────────────────────────────────────────────────────────

function buildRow(p: any, now: number): Record<string, any> {
  const stageAgeMins = Math.floor(
    (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
  );
  const totalMins =
    (p.stageHistory ?? []).reduce(
      (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
      0,
    ) + stageAgeMins;
  const rq = p.requirement;

  return {
    pipelineId: p.id,
    addedOn: p.createdAt,
    pipelineDays: Math.floor(totalMins / 1440),
    stageAging: formatAging(stageAgeMins),
    stageAgeMins,

    // Stage
    stageId: p.currentStageId,
    stageLabel: p.currentStage?.label ?? "—",
    stageCode: p.currentStage?.code ?? "",
    stageOrder: p.currentStage?.order ?? 0,
    isTerminal: p.currentStage?.isTerminal ?? false,
    isNearTerminal: p.currentStage?.isNearTerminal ?? false,
    isSourced: p.currentStage?.isSourced ?? false,

    // Flags
    isRejected: p.isRejected,
    isWithdrawn: p.isWithdrawn,
    isOnHold: p.isOnHold,

    // Offer / submission
    submittedAt: p.submittedAt ?? null,
    offerStatus: p.offerStatus ?? null,
    offeredCtc: p.offeredCtc != null ? Number(p.offeredCtc) : null,
    currentCtc: p.currentCtc != null ? Number(p.currentCtc) : null,
    expectedCtc: p.expectedCtc != null ? Number(p.expectedCtc) : null,
    negotiatedCtc: p.negotiatedCtc != null ? Number(p.negotiatedCtc) : null,

    // Joining
    noticePeriod: p.noticePeriod ?? null,
    lastWorkingDate: p.lastWorkingDate ?? null,
    expectedJoiningDate: p.expectedJoiningDate ?? null,
    actualJoiningDate: p.actualJoiningDate ?? null,
    monthOfJoining: p.monthOfJoining ?? null,
    daysToJoin: p.remainingDaysToJoin ?? null,

    // Candidate
    candidateName: p.snapshot?.fullName ?? "—",
    candidateEmail: p.snapshot?.email ?? "",
    candidatePhone: p.snapshot?.phone ?? "",
    currentTitle: p.snapshot?.currentTitle ?? "",
    currentCompany: p.snapshot?.currentCompany ?? "",
    expYears: p.snapshot?.totalExpYears ?? null,
    topSkills: (p.snapshot?.topSkills ?? []).join(", "),
    resumeUrl: p.snapshot?.resumeUrl ?? null,

    // Recruiter
    recruiterId: p.recruiterId,
    recruiterName: `${p.recruiter?.firstName ?? ""} ${
      p.recruiter?.lastName ?? ""
    }`.trim(),
    recruiterEmail: p.recruiter?.email ?? "",

    // Requirement
    requirementId: rq?.id ?? "",
    reqCode: rq?.reqCode ?? "",
    reqTitle: rq?.title ?? "",
    reqStatus: rq?.status ?? "",
    totalOpenings: rq?.totalOpenings ?? 0,
    salaryMin: rq?.salaryMin != null ? Number(rq.salaryMin) : null,
    salaryMax: rq?.salaryMax != null ? Number(rq.salaryMax) : null,
    clientName: rq?.client?.name ?? "",
    clientSpoc: rq?.clientSpoc
      ? `${rq.clientSpoc.firstName} ${rq.clientSpoc.lastName}`.trim()
      : "",
    serviceLineName: rq?.serviceLine?.name ?? "",
    businessUnitName: rq?.businessUnit?.name ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/drill
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterDrill = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;

    // ── Scope ───────────────────────────────────────────────────────────────
    const scopedIds = resolveScopedUserIds(req);

    // Team picker narrows scope
    let effectiveIds: string[] | null = scopedIds;
    if (q.userIds) {
      const teamIds = q.userIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (teamIds.length > 0) {
        effectiveIds =
          scopedIds === null
            ? teamIds
            : teamIds.filter((id) => scopedIds.includes(id));
      }
    }

    // Single recruiter drill (from RecruiterTable click)
    if (q.recruiterId && q.recruiterId !== "__all__") {
      if (effectiveIds !== null && !effectiveIds.includes(q.recruiterId)) {
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      }
      effectiveIds = [q.recruiterId];
    }

    // ── Build pipeline where ─────────────────────────────────────────────────
    const pipelineWhere: Record<string, any> = {};

    // Recruiter scope
    if (effectiveIds !== null) {
      pipelineWhere.recruiterId = { in: effectiveIds };
    }

    // Requirement filters
    const reqWhere: Record<string, any> = { deletedAt: null };
    if (q.clientId) reqWhere.clientId = q.clientId;
    if (q.clientSpocId) reqWhere.clientSpocId = q.clientSpocId;
    if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
    if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
    if (q.status) reqWhere.status = q.status;
    pipelineWhere.requirement = reqWhere;

    // Date window — activity-based
    const win = resolveDateWindow(q);
    if (win.gte || win.lte) {
      const range = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
      pipelineWhere.OR = [
        { createdAt: range },
        { updatedAt: range },
        { stageHistory: { some: { createdAt: range } } },
      ];
    }

    // MOJ filter
    // const mojFilter = mojToFilter(q.mojMonth, q.mojYear);
    // if (mojFilter) {
    //   Object.assign(pipelineWhere, mojFilter);
    // }
    // MOJ filter — frontend sends "2026-05", filter by actualJoiningDate range
    if (q.mojMonth) {
      const parts = q.mojMonth.split("-");
      const year = Number(parts[0] ?? 0);
      const month = Number(parts[1] ?? 0);

      if (year && month) {
        const start = new Date(year, month - 1, 1); // 2026-05-01
        const end = new Date(year, month, 1); // 2026-06-01 (exclusive)
        pipelineWhere.actualJoiningDate = { gte: start, lt: end };
      }
    }

    // ── Type filter — what kind of candidates ───────────────────────────────
    const type = q.type ?? "recruiter";

    if (q.stageId && type === "stage") {
      pipelineWhere.currentStageId = q.stageId;
    } else {
      switch (type) {
        case "placed":
          pipelineWhere.currentStage = { isTerminal: true };
          break;
        case "near_terminal":
          pipelineWhere.currentStage = {
            isNearTerminal: true,
            isTerminal: false,
          };
          break;
        case "active_pipeline":
          pipelineWhere.currentStage = {
            pipeline: true,
            isTerminal: false,
            isNearTerminal: false,
            isSourced: false,
          };
          break;
        case "dropped":
          // off pipeline — rejected OR withdrawn OR pipeline=false stage
          pipelineWhere.OR = [
            ...(pipelineWhere.OR ?? []),
            ...(win.gte || win.lte ? [] : []), // preserve existing OR if no date window
          ];
          // simpler: filter in memory after fetch
          break;
        case "sourced":
          pipelineWhere.currentStage = { isSourced: true };
          break;
        // "recruiter" = no extra stage filter, show all
      }
    }

    // ── Fetch ────────────────────────────────────────────────────────────────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: PIPELINE_SELECT as any,
      orderBy: { createdAt: "desc" },
      take: 1000, // hard cap — export covers larger sets
    });

    const now = Date.now();

    // Post-filter for "dropped" (rejected/withdrawn/off-pipeline stage)
    const filtered =
      type === "dropped"
        ? pipelines.filter(
            (p: any) =>
              p.isRejected ||
              p.isWithdrawn ||
              p.currentStage?.pipeline === false,
          )
        : pipelines;

    const rows = filtered.map((p: any) => buildRow(p, now));

    // ── Stats ────────────────────────────────────────────────────────────────
    const stats = {
      total: rows.length,
      placed: rows.filter((r: any) => r.isTerminal).length,
      nearTerminal: rows.filter((r: any) => r.isNearTerminal && !r.isTerminal)
        .length,
      active: rows.filter(
        (r: any) =>
          !r.isTerminal &&
          !r.isNearTerminal &&
          !r.isRejected &&
          !r.isWithdrawn &&
          !r.isOnHold,
      ).length,
      onHold: rows.filter((r: any) => r.isOnHold).length,
      rejected: rows.filter((r: any) => r.isRejected).length,
      withdrawn: rows.filter((r: any) => r.isWithdrawn).length,
      capped: pipelines.length >= 1000,
    };

    return res.json({
      success: true,
      data: rows,
      meta: { stats, capped: stats.capped },
    });
  } catch (err) {
    console.error("getRecruiterDrill:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch drill data" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/drill/moj-options
//
// Returns the distinct months of joining available for the current scope+filters.
// Used to populate the MOJ filter dropdown.
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterDrillMojOptions = async (
  req: Request,
  res: Response,
) => {
  try {
    const q = req.query as Record<string, string>;
    const scopedIds = resolveScopedUserIds(req);

    let effectiveIds: string[] | null = scopedIds;
    if (q.userIds) {
      const teamIds = q.userIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (teamIds.length > 0) {
        effectiveIds =
          scopedIds === null
            ? teamIds
            : teamIds.filter((id) => scopedIds.includes(id));
      }
    }

    const where: Record<string, any> = {
      monthOfJoining: { not: null },
    };
    if (effectiveIds !== null) where.recruiterId = { in: effectiveIds };
    if (q.serviceLineId)
      where.requirement = { serviceLineId: q.serviceLineId, deletedAt: null };

    const rows = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: { monthOfJoining: true },
      distinct: ["monthOfJoining"],
      orderBy: { monthOfJoining: "asc" },
    });

    // monthOfJoining is stored as "June 2025" — parse and sort chronologically
    const months = rows
      .map((r) => r.monthOfJoining!)
      .filter(Boolean)
      .map((label) => {
        const parts = label.split(" ");
        const monthIdx = MONTH_NAMES.indexOf(parts[0]);
        const year = parseInt(parts[1], 10);
        return { label, monthIdx, year, sortKey: year * 100 + monthIdx };
      })
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ label, monthIdx, year }) => ({
        label,
        value: `${year}-${String(monthIdx + 1).padStart(2, "0")}`, // "2025-06"
      }));

    return res.json({ success: true, data: months });
  } catch (err) {
    console.error("getRecruiterDrillMojOptions:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch MOJ options" });
  }
};
