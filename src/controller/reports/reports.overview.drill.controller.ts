// File: reports.overview.drill.controller.ts
// Path: src/controllers/reports.overview.drill.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { format, addDays, addMonths } from "date-fns";
import { resolveOrgTreeDown } from "./reports.controller";
// import { resolveOrgTreeDown } from "@/services/orgTreeService";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type DrillType =
  | "stage"
  | "sourced"
  | "active_pipeline"
  | "placed"
  | "near_terminal"
  | "dropped"
  | "on_hold"
  | "rejected"
  | "withdrawn"
  | "recruiter"
  | "service_line"
  | "department"
  | "business_unit";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SELECT — used by both drill endpoints
// ─────────────────────────────────────────────────────────────────────────────

export const DRILL_PIPELINE_SELECT = {
  id: true,
  requirementId: true,
  stageUpdatedAt: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  lastWorkingDate: true,
  noticePeriod: true,
  createdAt: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      isTerminal: true,
      isNearTerminal: true,
      isSourced: true,
      order: true,
    },
  },
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
      client: { select: { id: true, name: true, percentageValue: true } },
      clientSpoc: { select: { id: true, firstName: true, lastName: true } },
      businessUnit: { select: { id: true, name: true } },
      serviceLine: { select: { id: true, name: true } },
      band: { select: { id: true, code: true, name: true, value: true } },
    },
  },
  stageHistory: { select: { timeInPrevStageMins: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatAgingLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

/**
 * Derive "expected joining date" from available fields.
 * Priority: actualJoiningDate → expectedJoiningDate → lastWorkingDate + noticePeriod
 */
function deriveJoiningDate(
  actualJoiningDate: Date | null,
  expectedJoiningDate: Date | null,
  lastWorkingDate: Date | null,
  noticePeriod: string | null,
): Date | null {
  if (actualJoiningDate) return actualJoiningDate;
  if (expectedJoiningDate) return expectedJoiningDate;
  if (lastWorkingDate) return lastWorkingDate; // LWD itself is effectively joining day

  // Try to parse noticePeriod string like "30 days", "2 months", "1 month", "60"
  if (noticePeriod) {
    const lower = noticePeriod.toLowerCase().trim();
    const numMatch = lower.match(/^(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : null;
    if (num != null) {
      const base = new Date();
      if (lower.includes("month")) return addMonths(base, num);
      return addDays(base, num); // default to days
    }
  }
  return null;
}

/**
 * Shape a pipeline row into the canonical DrillRow format
 */
export function shapeDrillRow(p: any, now: number) {
  const stageAgeMins = Math.floor(
    (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
  );
  const totalPipelineMins =
    (p.stageHistory ?? []).reduce(
      (sum: number, log: any) => sum + (log.timeInPrevStageMins ?? 0),
      0,
    ) + stageAgeMins;

  const derivedJoining = deriveJoiningDate(
    p.actualJoiningDate,
    p.expectedJoiningDate,
    p.lastWorkingDate,
    p.noticePeriod,
  );

  const req = p.requirement ?? {};
  const band = req.band ?? null;
  const client = req.client ?? null;

  // Compute sale value inline (same priority chain as requirementsController)
  let computedSaleValue: number | null = null;
  let saleValueBasis: string = "NOT_FOUND";

  const openings = req.totalOpenings ?? 1;
  if (req.saleValue != null && Number(req.saleValue) > 0) {
    computedSaleValue = Number(req.saleValue) * openings;
    saleValueBasis = "SALE_VALUE";
  } else if (band?.value != null && Number(band.value) > 0) {
    computedSaleValue = Number(band.value) * openings;
    saleValueBasis = "BAND";
  } else {
    const pct =
      client?.percentageValue != null ? Number(client.percentageValue) : null;
    const salMin = req.salaryMin != null ? Number(req.salaryMin) : null;
    if (pct != null && pct > 0 && salMin != null && salMin > 0) {
      computedSaleValue = salMin * (pct / 100) * openings;
      saleValueBasis = "FIXED_PCT";
    }
  }

  return {
    pipelineId: p.id,
    addedOn: p.createdAt?.toISOString() ?? null,
    pipelineDays: Math.floor(totalPipelineMins / 1440),
    stageAging: formatAgingLabel(stageAgeMins),
    stageAgeMins,
    stageLabel: p.currentStage?.label ?? "—",
    stageCode: p.currentStage?.code ?? "",
    stageOrder: p.currentStage?.order ?? 0,
    isTerminal: p.currentStage?.isTerminal ?? false,
    isNearTerminal: p.currentStage?.isNearTerminal ?? false,
    isSourced: p.currentStage?.isSourced ?? false,
    isRejected: p.isRejected ?? false,
    isWithdrawn: p.isWithdrawn ?? false,
    isOnHold: p.isOnHold ?? false,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    offerStatus: p.offerStatus ?? null,
    offeredCtc: p.offeredCtc != null ? Number(p.offeredCtc) : null,
    currentCtc: p.currentCtc != null ? Number(p.currentCtc) : null,
    expectedCtc: p.expectedCtc != null ? Number(p.expectedCtc) : null,
    negotiatedCtc: p.negotiatedCtc != null ? Number(p.negotiatedCtc) : null,
    lastWorkingDate: p.lastWorkingDate?.toISOString() ?? null,
    expectedJoiningDate: p.expectedJoiningDate?.toISOString() ?? null,
    actualJoiningDate: p.actualJoiningDate?.toISOString() ?? null,
    derivedJoiningDate: derivedJoining?.toISOString() ?? null,
    monthOfJoining: derivedJoining ? format(derivedJoining, "MMMM yyyy") : null,
    daysToJoin: derivedJoining
      ? Math.max(0, Math.floor((derivedJoining.getTime() - now) / 86400000))
      : null,
    noticePeriod: p.noticePeriod ?? null,
    candidateName: p.snapshot?.fullName ?? "—",
    candidateEmail: p.snapshot?.email ?? "",
    candidatePhone: p.snapshot?.phone ?? "",
    currentTitle: p.snapshot?.currentTitle ?? "",
    currentCompany: p.snapshot?.currentCompany ?? "",
    expYears: p.snapshot?.totalExpYears ?? null,
    topSkills: Array.isArray(p.snapshot?.topSkills)
      ? p.snapshot.topSkills.join(", ")
      : (p.snapshot?.topSkills ?? ""),
    resumeUrl: p.snapshot?.resumeUrl ?? null,
    recruiterId: p.recruiter?.id ?? "",
    recruiterName:
      [p.recruiter?.firstName, p.recruiter?.lastName]
        .filter(Boolean)
        .join(" ") || "—",
    recruiterEmail: p.recruiter?.email ?? "",
    requirementId: req.id ?? p.requirementId ?? "",
    reqCode: req.reqCode ?? "",
    reqTitle: req.title ?? "",
    reqStatus: req.status ?? "",
    totalOpenings: req.totalOpenings ?? 0,
    salaryMin: req.salaryMin != null ? Number(req.salaryMin) : null,
    salaryMax: req.salaryMax != null ? Number(req.salaryMax) : null,
    computedSaleValue,
    saleValueBasis,
    bandCode: band?.code ?? null,
    bandName: band?.name ?? null,
    bandValue: band?.value != null ? Number(band.value) : null,
    clientPct:
      client?.percentageValue != null ? Number(client.percentageValue) : null,
    clientName: client?.name ?? "",
    clientSpoc: req.clientSpoc
      ? [req.clientSpoc.firstName, req.clientSpoc.lastName]
          .filter(Boolean)
          .join(" ")
      : "",
    serviceLineName: req.serviceLine?.name ?? "",
    businessUnitName: req.businessUnit?.name ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveEffectiveUserIds — shared scope helper
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveEffectiveUserIds(
  req: Request,
  q: Record<string, string | undefined>,
): Promise<string[] | null> {
  if (req.user!.isSuperAdmin) return null;

  // If frontend passes explicit userIds (from TeamTreePicker), respect them
  if (q.userIds) {
    return q.userIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Otherwise BFS down the org tree from this user
  return resolveOrgTreeDown(req.user!.id, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// getOverviewDrill
// GET /reports/overview/drill?type=...&requirementId=...
//
// EXTENDED: now accepts optional `requirementId` to scope to a single requirement.
// All existing drill types still work as before — requirementId is additive filter only.
// ─────────────────────────────────────────────────────────────────────────────

export const getOverviewDrill = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const drillType = q.type as DrillType;

    if (!drillType) {
      return res
        .status(400)
        .json({ success: false, message: "type param is required" });
    }

    const win = resolveDateWindow(q);
    const scopedUserIds = await resolveEffectiveUserIds(req, q);

    // ── Base requirement filter ────────────────────────────────────────────
    const reqWhere: Record<string, any> = { deletedAt: null };
    if (q.clientId) reqWhere.clientId = q.clientId;
    if (q.clientSpocId) reqWhere.clientSpocId = q.clientSpocId; // ← ADD
    if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
    if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
    if (q.status) reqWhere.status = q.status;

    // NOTE: date window on pipeline stageUpdatedAt — not requirement createdAt
    if (q.requirementId) reqWhere.id = q.requirementId;

    // ── Base pipeline filter ───────────────────────────────────────────────
    const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null)
      pipelineWhere.recruiterId = { in: scopedUserIds };
    if (win.gte || win.lte) {
      pipelineWhere.stageUpdatedAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
    }
    // if (win.gte || win.lte) {
    //   reqWhere.createdAt = {
    //     ...(win.gte ? { gte: win.gte } : {}),
    //     ...(win.lte ? { lte: win.lte } : {}),
    //   };
    // }
    // // NEW: scope to a single requirement if provided
    // if (q.requirementId) reqWhere.id = q.requirementId;

    // // ── Base pipeline filter ───────────────────────────────────────────────
    // const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    // if (scopedUserIds !== null)
    //   pipelineWhere.recruiterId = { in: scopedUserIds };

    // ── Stage definitions ──────────────────────────────────────────────────
    const slFilter = q.serviceLineId
      ? { OR: [{ serviceLineId: null }, { serviceLineId: q.serviceLineId }] }
      : {};

    // ── Apply drill-specific filter ────────────────────────────────────────
    switch (drillType) {
      case "stage": {
        if (!q.stageId) {
          return res.status(400).json({
            success: false,
            message: "stageId required for type=stage",
          });
        }
        pipelineWhere.currentStageId = q.stageId;
        break;
      }

      case "sourced": {
        const sourcedStages = await prisma.pipelineStage.findMany({
          where: { isSourced: true, isActive: true },
          select: { id: true },
        });
        pipelineWhere.currentStageId = { in: sourcedStages.map((s) => s.id) };
        break;
      }

      case "active_pipeline": {
        const activeStages = await prisma.pipelineStage.findMany({
          where: {
            pipeline: true,
            isTerminal: false,
            isSourced: false,
            isActive: true,
            ...slFilter,
          },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: activeStages.map((s) => s.id),
        };
        break;
      }

      case "placed": {
        const terminalStages = await prisma.pipelineStage.findMany({
          where: { isTerminal: true, ...slFilter },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: terminalStages.map((s) => s.id),
        };
        break;
      }

      case "near_terminal": {
        const nearStages = await prisma.pipelineStage.findMany({
          where: { isNearTerminal: true, ...slFilter },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: nearStages.map((s) => s.id),
        };
        break;
      }
      case "dropped": {
        const exitStages = await prisma.pipelineStage.findMany({
          where: { pipeline: false, isTerminal: false, isActive: true },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: exitStages.map((s) => s.id),
        };
        break;
      }

      case "on_hold": {
        pipelineWhere.isOnHold = true;
        break;
      }

      case "rejected": {
        pipelineWhere.isRejected = true;
        break;
      }

      case "withdrawn": {
        pipelineWhere.isWithdrawn = true;
        break;
      }

      case "recruiter": {
        if (!q.recruiterId) {
          return res.status(400).json({
            success: false,
            message: "recruiterId required for type=recruiter",
          });
        }
        if (scopedUserIds !== null && !scopedUserIds.includes(q.recruiterId)) {
          return res
            .status(403)
            .json({ success: false, message: "Recruiter not in your scope" });
        }
        pipelineWhere.recruiterId = q.recruiterId;
        break;
      }

      case "service_line": {
        if (!q.drillServiceLineId) {
          return res.status(400).json({
            success: false,
            message: "drillServiceLineId required for type=service_line",
          });
        }
        pipelineWhere.requirement = {
          ...reqWhere,
          serviceLineId: q.drillServiceLineId,
        };
        break;
      }

      case "department": {
        if (!q.departmentId) {
          return res.status(400).json({
            success: false,
            message: "departmentId required for type=department",
          });
        }
        const deptUsers = await prisma.user.findMany({
          where: { departmentId: q.departmentId, isActive: true },
          select: { id: true },
        });
        const deptIds = deptUsers.map((u) => u.id);
        const allowed =
          scopedUserIds !== null
            ? deptIds.filter((id) => scopedUserIds.includes(id))
            : deptIds;
        pipelineWhere.recruiterId = { in: allowed };
        break;
      }

      case "business_unit": {
        if (!q.drillBusinessUnitId) {
          return res.status(400).json({
            success: false,
            message: "drillBusinessUnitId required for type=business_unit",
          });
        }
        pipelineWhere.requirement = {
          ...reqWhere,
          businessUnitId: q.drillBusinessUnitId,
        };
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          message: `Unknown drill type: ${drillType}`,
        });
    }

    // ── Fetch — cap at 500 rows ────────────────────────────────────────────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: DRILL_PIPELINE_SELECT as any,
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const now = Date.now();
    const rows = pipelines.map((p: any) => shapeDrillRow(p, now));

    // ── Label ──────────────────────────────────────────────────────────────
    let label = drillType.replace(/_/g, " ");
    if (drillType === "stage" && q.stageLabel) label = q.stageLabel;
    if (drillType === "recruiter" && q.recruiterName) label = q.recruiterName;
    if (drillType === "service_line" && q.drillServiceLineName)
      label = q.drillServiceLineName;
    if (drillType === "department" && q.departmentName)
      label = q.departmentName;

    return res.json({
      success: true,
      data: rows,
      meta: {
        total: rows.length,
        label,
        drillType,
        capped: rows.length === 500,
      },
    });
  } catch (err) {
    console.error("getOverviewDrill:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch drill data" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementCandidateDrill
// GET /reports/requirements/:requirementId/candidates?stageId=&
//
// NEW — scoped candidate list for a single requirement.
// Used by RequirementTable when a stage count number is clicked.
// No type-based filtering — just requirement + optional stageId.
// Respects user scope (recruiterId).
// ─────────────────────────────────────────────────────────────────────────────
// Bucket → PipelineStage flag filter. Mirrors getFunnelStats classification exactly,
// so the drill count always matches the funnel card count.
const DRILL_BUCKET_STAGE_FILTER = {
  nearTerminal: { isActive: true, isNearTerminal: true, isTerminal: false },
  terminal: { isActive: true, isTerminal: true },
} as const;

type DrillBucket = keyof typeof DRILL_BUCKET_STAGE_FILTER;

const isDrillBucket = (v: unknown): v is DrillBucket =>
  typeof v === "string" && v in DRILL_BUCKET_STAGE_FILTER;
export const getRequirementCandidateDrill = async (
  req: Request,
  res: Response,
) => {
  try {
    const { requirementId } = req.params;
    const q = req.query as Record<string, string | undefined>;
    // const scopedUserIds = await resolveEffectiveUserIds(req, q);

    if (!requirementId) {
      return res
        .status(400)
        .json({ success: false, message: "requirementId is required" });
    }
    if (q.bucket && !isDrillBucket(q.bucket)) {
      return res.status(400).json({
        success: false,
        message: `Invalid bucket. Allowed: ${Object.keys(
          DRILL_BUCKET_STAGE_FILTER,
        ).join(", ")}`,
      });
    }

    const scopedUserIds = await resolveEffectiveUserIds(req, q);
    const pipelineWhere: Record<string, any> = {
      requirementId,
    };

    // Optional stage filter — if stageId provided, only show candidates in that stage
    // if (q.stageId) {
    //   pipelineWhere.currentStageId = q.stageId;
    // }
    // ── Stage filter ───────────────────────────────────────────────────────
    const stageIds = (q.stageId ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (stageIds.length > 0) {
      pipelineWhere.currentStageId =
        stageIds.length === 1 ? stageIds[0] : { in: stageIds };
    } else if (isDrillBucket(q.bucket)) {
      pipelineWhere.currentStage = {
        is: DRILL_BUCKET_STAGE_FILTER[q.bucket],
      };
    }

    // Scope — recruiters only see their own candidates unless elevated
    if (scopedUserIds !== null) {
      pipelineWhere.recruiterId = { in: scopedUserIds };
    }

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: DRILL_PIPELINE_SELECT as any,
      orderBy: [{ currentStage: { order: "asc" } }, { createdAt: "desc" }],
      take: 500,
    });

    const now = Date.now();
    const rows = pipelines.map((p: any) => shapeDrillRow(p, now));

    // ── Stage label for title ──────────────────────────────────────────────
    let stageLabel = q.stageLabel ?? null;
    if (!stageLabel && stageIds.length === 1) {
      const stage = await prisma.pipelineStage.findUnique({
        where: { id: stageIds[0] },
        select: { label: true },
      });
      stageLabel = stage?.label ?? null;
    }

    // ── Quick aggregate stats ──────────────────────────────────────────────
    const stats = {
      total: rows.length,
      terminal: rows.filter((r) => r.isTerminal).length,
      nearTerminal: rows.filter((r) => r.isNearTerminal && !r.isTerminal)
        .length,
      active: rows.filter(
        (r) =>
          !r.isTerminal &&
          !r.isNearTerminal &&
          !r.isRejected &&
          !r.isWithdrawn &&
          !r.isOnHold,
      ).length,
      onHold: rows.filter((r) => r.isOnHold).length,
      rejected: rows.filter((r) => r.isRejected).length,
      withdrawn: rows.filter((r) => r.isWithdrawn).length,
    };

    return res.json({
      success: true,
      data: rows,
      meta: {
        total: rows.length,
        stageLabel,
        requirementId,
        capped: rows.length === 500,
        stats,
      },
    });
  } catch (err) {
    console.error("getRequirementCandidateDrill:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch requirement candidates",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — date window resolver (keep in sync with your existing one)
// ─────────────────────────────────────────────────────────────────────────────

function resolveDateWindow(q: Record<string, string | undefined>): {
  gte?: Date;
  lte?: Date;
} {
  const now = new Date();
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    return { gte: new Date(now.getTime() - h * 3600000) };
  }
  if (q.fromDate || q.toDate) {
    return {
      ...(q.fromDate ? { gte: new Date(q.fromDate) } : {}),
      ...(q.toDate
        ? { lte: new Date(new Date(q.toDate).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }
  if (q.range) {
    const start = new Date(now);
    switch (q.range) {
      case "today":
        start.setHours(0, 0, 0, 0);
        return { gte: start };
      case "yesterday": {
        const s = new Date(now);
        s.setDate(s.getDate() - 1);
        s.setHours(0, 0, 0, 0);
        const e = new Date(s);
        e.setHours(23, 59, 59, 999);
        return { gte: s, lte: e };
      }
      case "last7":
        start.setDate(start.getDate() - 7);
        return { gte: start };
      case "last30":
        start.setDate(start.getDate() - 30);
        return { gte: start };
      case "thisMonth":
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return { gte: start };
    }
  }
  return {};
}
