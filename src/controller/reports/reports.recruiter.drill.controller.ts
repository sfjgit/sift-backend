// File: reports.recruiter.drill.controller.ts
// Path: src/controller/reports/reports.recruiter.drill.controller.ts

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
// MOJ HELPERS
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

function mojMonthToLabel(mojMonth: string): string | null {
  const parts = mojMonth.split("-");
  const year = parts[0];
  const monthIdx = parseInt(parts[1] ?? "0", 10) - 1;
  if (!year || monthIdx < 0 || monthIdx > 11) return null;
  return `${MONTH_NAMES[monthIdx]} ${year}`;
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
  monthOfJoining: true,
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
      // Include creator for CSM filter context
      createdById: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BUILD ROW
// ─────────────────────────────────────────────────────────────────────────────

function buildRow(p: any, now: number): Record<string, any> {
  const stageAgeMins = Math.floor(
    (now - new Date(p.stageUpdatedAt).getTime()) / 60000
  );
  const totalMins =
    (p.stageHistory ?? []).reduce(
      (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
      0
    ) + stageAgeMins;
  const rq = p.requirement;

  return {
    pipelineId: p.id,
    addedOn: p.createdAt,
    pipelineDays: Math.floor(totalMins / 1440),
    stageAging: formatAging(stageAgeMins),
    stageAgeMins,

    stageId: p.currentStageId,
    stageLabel: p.currentStage?.label ?? "—",
    stageCode: p.currentStage?.code ?? "",
    stageOrder: p.currentStage?.order ?? 0,
    isTerminal: p.currentStage?.isTerminal ?? false,
    isNearTerminal: p.currentStage?.isNearTerminal ?? false,
    isSourced: p.currentStage?.isSourced ?? false,

    isRejected: p.isRejected,
    isWithdrawn: p.isWithdrawn,
    isOnHold: p.isOnHold,

    submittedAt: p.submittedAt ?? null,
    offerStatus: p.offerStatus ?? null,
    offeredCtc: p.offeredCtc != null ? Number(p.offeredCtc) : null,
    currentCtc: p.currentCtc != null ? Number(p.currentCtc) : null,
    expectedCtc: p.expectedCtc != null ? Number(p.expectedCtc) : null,
    negotiatedCtc: p.negotiatedCtc != null ? Number(p.negotiatedCtc) : null,

    noticePeriod: p.noticePeriod ?? null,
    lastWorkingDate: p.lastWorkingDate ?? null,
    monthOfJoining: p.monthOfJoining ?? null,

    candidateName: p.snapshot?.fullName ?? "—",
    candidateEmail: p.snapshot?.email ?? "",
    candidatePhone: p.snapshot?.phone ?? "",
    currentTitle: p.snapshot?.currentTitle ?? "",
    currentCompany: p.snapshot?.currentCompany ?? "",
    expYears: p.snapshot?.totalExpYears ?? null,
    topSkills: (p.snapshot?.topSkills ?? []).join(", "),
    resumeUrl: p.snapshot?.resumeUrl ?? null,

    recruiterId: p.recruiterId,
    recruiterName: `${p.recruiter?.firstName ?? ""} ${
      p.recruiter?.lastName ?? ""
    }`.trim(),
    recruiterEmail: p.recruiter?.email ?? "",

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

    // Creator context — useful when CSM filter is active
    createdById: rq?.createdById ?? null,
    createdByName: rq?.createdBy
      ? `${rq.createdBy.firstName} ${rq.createdBy.lastName}`.trim()
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD PIPELINE WHERE — shared between drill + moj-options
// ─────────────────────────────────────────────────────────────────────────────

function buildDrillPipelineWhere(
  q: Record<string, string>,
  effectiveIds: string[] | null
): Record<string, any> {
  const pipelineWhere: Record<string, any> = {};

  // Recruiter scope
  if (effectiveIds !== null) {
    pipelineWhere.recruiterId = { in: effectiveIds };
  }

  // Requirement filters — includes createdById for CSM filter
  const reqWhere: Record<string, any> = { deletedAt: null };
  if (q.clientId) reqWhere.clientId = q.clientId;
  if (q.clientSpocId) reqWhere.clientSpocId = q.clientSpocId;
  if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
  if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
  if (q.status) reqWhere.status = q.status;

  // ── CSM / creator filter ──────────────────────────────────────────────────
  // createdById can be comma-separated for multi-select
  if (q.createdById) {
    const ids = q.createdById
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    reqWhere.createdById = ids.length === 1 ? ids[0] : { in: ids };
  }

  pipelineWhere.requirement = reqWhere;

  // ── MOJ filter ────────────────────────────────────────────────────────────
  // mojMonth = "2025-09" → monthOfJoining = "September 2025" (stored string, indexed)
  if (q.mojMonth) {
    const label = mojMonthToLabel(q.mojMonth);
    if (label) pipelineWhere.monthOfJoining = label;
  } else if (q.mojYear) {
    pipelineWhere.monthOfJoining = { contains: q.mojYear };
  }

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

  return pipelineWhere;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/drill
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterDrill = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;

    // ── Scope ────────────────────────────────────────────────────────────────
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

    // Single recruiter drill
    if (q.recruiterId && q.recruiterId !== "__all__") {
      if (effectiveIds !== null && !effectiveIds.includes(q.recruiterId)) {
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      }
      effectiveIds = [q.recruiterId];
    }

    // ── Build where ──────────────────────────────────────────────────────────
    const pipelineWhere = buildDrillPipelineWhere(q, effectiveIds);

    // ── Type filter ──────────────────────────────────────────────────────────
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
        case "sourced":
          pipelineWhere.currentStage = { isSourced: true };
          break;
        // "dropped" and "recruiter" — no extra stage filter, handle post-fetch
      }
    }

    // ── Fetch ────────────────────────────────────────────────────────────────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: PIPELINE_SELECT as any,
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const now = Date.now();

    // Post-filter for "dropped"
    const filtered =
      type === "dropped"
        ? pipelines.filter(
            (p: any) =>
              p.isRejected ||
              p.isWithdrawn ||
              p.currentStage?.pipeline === false
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
          !r.isOnHold
      ).length,
      onHold: rows.filter((r: any) => r.isOnHold).length,
      rejected: rows.filter((r: any) => r.isRejected).length,
      withdrawn: rows.filter((r: any) => r.isWithdrawn).length,
      capped: pipelines.length >= 1000,
    };

    return res.json({
      success: true,
      data: rows,
      meta: {
        stats,
        capped: stats.capped,
        // Echo active filters so frontend can show "filtered by Sep 2025 MOJ" etc.
        filters: {
          mojMonth: q.mojMonth ?? null,
          mojYear: q.mojYear ?? null,
          createdById: q.createdById ?? null,
        },
      },
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
// Returns distinct months of joining for the current scope + filters.
// Respects createdById filter so the MOJ dropdown only shows months
// relevant to the selected CSM's requirements.
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterDrillMojOptions = async (
  req: Request,
  res: Response
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

    // ── Requirement filters including createdById ─────────────────────────────
    const reqWhere: Record<string, any> = { deletedAt: null };
    if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
    if (q.clientId) reqWhere.clientId = q.clientId;
    if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;

    // CSM filter: only show MOJ months for requirements this CSM created
    if (q.createdById) {
      const ids = q.createdById
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      reqWhere.createdById = ids.length === 1 ? ids[0] : { in: ids };
    }

    where.requirement = reqWhere;

    const rows = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: { monthOfJoining: true },
      distinct: ["monthOfJoining"],
      orderBy: { monthOfJoining: "asc" },
    });

    // Parse "September 2025" → sort chronologically → return with ISO value
    const months = rows
      .map((r) => r.monthOfJoining!)
      .filter(Boolean)
      .map((label) => {
        const parts = label.split(" ");
        const monthIdx = MONTH_NAMES.indexOf(parts[0] ?? "");
        const year = parseInt(parts[1] ?? "0", 10);
        return { label, monthIdx, year, sortKey: year * 100 + monthIdx };
      })
      .filter((m) => m.monthIdx >= 0) // skip unparseable entries
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ label, monthIdx, year }) => ({
        label,
        value: `${year}-${String(monthIdx + 1).padStart(2, "0")}`, // "2025-09"
      }));

    return res.json({ success: true, data: months });
  } catch (err) {
    console.error("getRecruiterDrillMojOptions:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch MOJ options" });
  }
};
