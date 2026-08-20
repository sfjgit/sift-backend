// File: reports.overview.drill.controller.ts
// Path: src/controller/reports/reports.overview.drill.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW (same as overview controller)
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

function resolveEffectiveUserIds(
  req: Request,
  q: Record<string, string | undefined>
): string[] | null {
  const scopedUserIds = resolveScopedUserIds(req);
  if (!q.userIds) return scopedUserIds;
  const teamIds = q.userIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!teamIds.length) return scopedUserIds;
  if (scopedUserIds === null) return teamIds;
  const allowed = new Set(scopedUserIds);
  const intersected = teamIds.filter((id) => allowed.has(id));
  if (!intersected.length) return [req.user!.id];
  return intersected;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT — full candidate detail for drill view
// ─────────────────────────────────────────────────────────────────────────────

const DRILL_PIPELINE_SELECT = {
  id: true,
  requirementId: true,
  recruiterId: true,
  currentStageId: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  actualJoiningDate: true,
  expectedJoiningDate: true,
  lastWorkingDate: true,
  noticePeriod: true,
  stageUpdatedAt: true,
  createdAt: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      isTerminal: true,
      isSourced: true,
      pipeline: true,
    },
  },
  stageHistory: { select: { timeInPrevStageMins: true } },
  recruiter: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
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
      client: { select: { id: true, name: true } },
      clientSpoc: { select: { id: true, firstName: true, lastName: true } },
      serviceLine: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true } },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE the pipeline row into a clean drill row the frontend can use directly
// and SheetJS can iterate without any further transformation
// ─────────────────────────────────────────────────────────────────────────────

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

function shapePipeline(p: any) {
  const now = Date.now();
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
    // Pipeline identity
    pipelineId: p.id,
    addedOn: p.createdAt,
    pipelineDays: Math.floor(totalMins / 1440),
    stageAging: formatAging(stageAgeMins),
    stageAgeMins,

    // Stage
    stageId: p.currentStageId,
    stageCode: p.currentStage?.code ?? "",
    stageLabel: p.currentStage?.label ?? "",
    isTerminal: p.currentStage?.isTerminal ?? false,
    isSourced: p.currentStage?.isSourced ?? false,

    // Status flags
    isRejected: p.isRejected,
    isWithdrawn: p.isWithdrawn,
    isOnHold: p.isOnHold,

    // Submission / offer
    submittedAt: p.submittedAt ?? null,
    offerStatus: p.offerStatus ?? null,
    offeredCtc: p.offeredCtc ?? null,
    currentCtc: p.currentCtc ?? null,
    expectedCtc: p.expectedCtc ?? null,
    negotiatedCtc: p.negotiatedCtc ?? null,

    // Joining
    expectedJoiningDate: p.expectedJoiningDate ?? null,
    actualJoiningDate: p.actualJoiningDate ?? null,
    lastWorkingDate: p.lastWorkingDate ?? null,
    noticePeriod: p.noticePeriod ?? null,

    // Candidate snapshot
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
    clientName: rq?.client?.name ?? "",
    clientSpoc: rq?.clientSpoc
      ? `${rq.clientSpoc.firstName} ${rq.clientSpoc.lastName}`.trim()
      : "",
    serviceLineName: rq?.serviceLine?.name ?? "",
    businessUnitName: rq?.businessUnit?.name ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DRILL TYPES
//
// type=stage          → stageId required — candidates in that stage
// type=sourced        → candidates in isSourced=true stages
// type=active_pipeline→ pipeline=true, isTerminal=false, isSourced=false
// type=placed         → isTerminal=true
// type=near_terminal  → isNearTerminal=true
// type=dropped        → pipeline=false, isTerminal=false
// type=on_hold        → isOnHold=true
// type=rejected       → isRejected=true
// type=withdrawn      → isWithdrawn=true
// type=recruiter      → recruiterId required — all candidates for that recruiter
// type=service_line   → serviceLineId required — all candidates for that SL
// type=department     → departmentId required — resolve to recruiter ids first
// type=business_unit  → businessUnitId required
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
// GET /reports/overview/drill
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
    const scopedUserIds = resolveEffectiveUserIds(req, q);

    // ── Base requirement filter ────────────────────────────────────────────
    const reqWhere: Record<string, any> = { deletedAt: null };
    if (q.clientId) reqWhere.clientId = q.clientId;
    if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
    if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
    if (q.status) reqWhere.status = q.status;
    if (win.gte || win.lte) {
      reqWhere.createdAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
    }

    // ── Base pipeline filter ───────────────────────────────────────────────
    const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null)
      pipelineWhere.recruiterId = { in: scopedUserIds };

    // ── Stage definitions (needed for type-based filters) ─────────────────
    const slFilter = q.serviceLineId
      ? { OR: [{ serviceLineId: null }, { serviceLineId: q.serviceLineId }] }
      : {};

    // ── Apply drill-specific filter ────────────────────────────────────────
    switch (drillType) {
      case "stage": {
        if (!q.stageId) {
          return res
            .status(400)
            .json({
              success: false,
              message: "stageId required for type=stage",
            });
        }
        pipelineWhere.currentStageId = q.stageId;
        break;
      }

      case "sourced": {
        // candidates in isSourced=true stages
        const sourcedStages = await prisma.pipelineStage.findMany({
          where: { isSourced: true, isActive: true },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: sourcedStages.map((s) => s.id),
        };
        break;
      }

      case "active_pipeline": {
        // pipeline=true, isTerminal=false, isSourced=false
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
          where: { isTerminal: true, isActive: true, ...slFilter },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: terminalStages.map((s) => s.id),
        };
        break;
      }

      case "near_terminal": {
        const nearStages = await prisma.pipelineStage.findMany({
          where: { isNearTerminal: true, isActive: true, ...slFilter },
          select: { id: true },
        });
        pipelineWhere.currentStageId = {
          in: nearStages.map((s) => s.id),
        };
        break;
      }

      case "dropped": {
        // pipeline=false, isTerminal=false — fell out
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
          return res
            .status(400)
            .json({
              success: false,
              message: "recruiterId required for type=recruiter",
            });
        }
        // Respect scope — don't allow drilling into out-of-scope recruiters
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
          return res
            .status(400)
            .json({
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
          return res
            .status(400)
            .json({
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
          return res
            .status(400)
            .json({
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
        return res
          .status(400)
          .json({
            success: false,
            message: `Unknown drill type: ${drillType}`,
          });
    }

    // ── Fetch — cap at 500 rows for performance, frontend exports this ─────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: DRILL_PIPELINE_SELECT as any,
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const rows = pipelines.map(shapePipeline);

    // ── Label for drawer title ─────────────────────────────────────────────
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
