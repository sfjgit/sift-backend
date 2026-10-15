// File: reports.overview.drill.controller.ts
// Path: src/controller/reports/reports.overview.drill.controller.ts
//
// Two candidate drills:
//   GET /reports/overview/drill                       getOverviewDrill
//   GET /reports/requirements/:requirementId/candidates  getRequirementCandidateDrill
//
// New flow, same as every other report:
//   - scope        = org tree (resolveRequirementScope). Team picker can only narrow.
//   - status       = stage flags only (placed / pipeline / dropped). No disposition,
//                    no isRejected / isWithdrawn.
//   - joining      = LWD, else today + noticePeriodDays (resolveJoining).
//   - sale value   = shared computeSaleValue.
//   - moved by     = latest real move INTO the current stage (skips same-stage logs).
//
// Response field names are kept so the existing drawers keep working; new fields
// (isDropped, joiningDate, joiningSource, noticeDays, stageReachedAt, stageMovedBy)
// are added alongside.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  Q,
  str,
  toArr,
  personName,
  computeSaleValue,
  buildReqFieldWhere,
  buildActivityPipelineWhere,
  resolveRequirementScope,
  buildRequirementWhere,
} from "./reports.requirements.shared";
import { resolveJoining, JOINING_SOURCE_LABELS } from "./reports.joining";

const DRILL_CAP = 500;

// ─────────────────────────────────────────────────────────────────────────────
// SELECT + ROW SHAPE — shared by both drills
// ─────────────────────────────────────────────────────────────────────────────

export const DRILL_PIPELINE_SELECT = {
  id: true,
  requirementId: true,
  recruiterId: true,
  currentStageId: true,
  stageUpdatedAt: true,
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
  noticePeriodDays: true,
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
      perOpeningValue: true,
      saleValueBasis: true,
      client: { select: { id: true, name: true, percentageValue: true } },
      clientSpoc: { select: { id: true, firstName: true, lastName: true } },
      businessUnit: { select: { id: true, name: true } },
      serviceLine: { select: { id: true, name: true } },
      band: { select: { id: true, code: true, name: true, value: true } },
    },
  },
  // newest first → latest real move into the current stage
  stageHistory: {
    select: {
      createdAt: true,
      fromStageId: true,
      toStageId: true,
      timeInPrevStageMins: true,
      changedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  },
} as const;

type DrillPipe = Prisma.RequirementCandidatePipelineGetPayload<{
  select: typeof DRILL_PIPELINE_SELECT;
}>;

function formatAgingLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

export function shapeDrillRow(p: DrillPipe, now: Date) {
  const stageAgeMins = Math.max(
    0,
    Math.floor((now.getTime() - new Date(p.stageUpdatedAt).getTime()) / 60_000)
  );
  const totalPipelineMins =
    p.stageHistory.reduce((s, l) => s + (l.timeInPrevStageMins ?? 0), 0) +
    stageAgeMins;
  const move = p.stageHistory.find(
    (l) => l.toStageId === p.currentStageId && l.fromStageId !== l.toStageId
  );

  const j = resolveJoining(p, now);
  const req = p.requirement;
  const sale = computeSaleValue(req);
  const stage = p.currentStage;
  const isTerminal = !!stage?.isTerminal;
  const isDropped = !isTerminal && stage?.pipeline === false;

  return {
    pipelineId: p.id,
    addedOn: p.createdAt.toISOString(),
    pipelineDays: Math.floor(totalPipelineMins / 1440),
    stageAging: formatAgingLabel(stageAgeMins),
    stageAgeMins,

    // Stage — the only source of truth for status
    stageId: p.currentStageId,
    stageLabel: stage?.label ?? "—",
    stageCode: stage?.code ?? "",
    stageOrder: stage?.order ?? 0,
    isTerminal,
    isNearTerminal: !!stage?.isNearTerminal && !isTerminal,
    isSourced: !!stage?.isSourced,
    isDropped,
    isOnHold: p.isOnHold ?? false,
    // kept for older drawers — derived from the stage, never from dead columns
    isRejected: isDropped,
    isWithdrawn: false,
    stageReachedAt: (move?.createdAt ?? p.stageUpdatedAt).toISOString(),
    stageMovedBy: move?.changedBy ? personName(move.changedBy) : null,

    submittedAt: p.submittedAt?.toISOString() ?? null,
    offerStatus: p.offerStatus ?? null,
    offeredCtc: p.offeredCtc ?? null,
    currentCtc: p.currentCtc ?? null,
    expectedCtc: p.expectedCtc ?? null,
    negotiatedCtc: p.negotiatedCtc ?? null,

    // Joining — LWD, else today + notice period days
    lastWorkingDate: p.lastWorkingDate?.toISOString() ?? null,
    noticeDays: j.noticeDays,
    noticePeriod: j.noticeDays != null ? `${j.noticeDays} days` : null,
    joiningDate: j.date?.toISOString() ?? null,
    joiningSource: j.source,
    joiningSourceLabel: j.source ? JOINING_SOURCE_LABELS[j.source] : null,
    derivedJoiningDate: j.date?.toISOString() ?? null,
    monthOfJoining: j.mojLabel,
    mojKey: j.mojKey,
    daysToJoin: j.daysToJoin,
    // informational only — not used for MOJ
    expectedJoiningDate: p.expectedJoiningDate?.toISOString() ?? null,
    actualJoiningDate: p.actualJoiningDate?.toISOString() ?? null,

    candidateName: p.snapshot?.fullName ?? "—",
    candidateEmail: p.snapshot?.email ?? "",
    candidatePhone: p.snapshot?.phone ?? "",
    currentTitle: p.snapshot?.currentTitle ?? "",
    currentCompany: p.snapshot?.currentCompany ?? "",
    expYears: p.snapshot?.totalExpYears ?? null,
    topSkills: (p.snapshot?.topSkills ?? []).join(", "),
    resumeUrl: p.snapshot?.resumeUrl ?? null,

    recruiterId: p.recruiterId,
    recruiterName: personName(p.recruiter) || "—",
    recruiterEmail: p.recruiter?.email ?? "",

    requirementId: req.id,
    reqCode: req.reqCode,
    reqTitle: req.title,
    reqStatus: req.status,
    totalOpenings: req.totalOpenings,
    salaryMin: req.salaryMin ?? null,
    salaryMax: req.salaryMax ?? null,
    computedSaleValue: sale.value,
    saleValueBasis: sale.basis,
    bandCode: req.band?.code ?? null,
    bandName: req.band?.name ?? null,
    bandValue: req.band?.value != null ? Number(req.band.value) : null,
    clientPct:
      req.client?.percentageValue != null
        ? Number(req.client.percentageValue)
        : null,
    clientName: req.client?.name ?? "",
    clientSpoc: personName(req.clientSpoc),
    serviceLineName: req.serviceLine?.name ?? "",
    businessUnitName: req.businessUnit?.name ?? "",
  };
}

type DrillRow = ReturnType<typeof shapeDrillRow>;

function drillStats(rows: DrillRow[]) {
  return {
    total: rows.length,
    terminal: rows.filter((r) => r.isTerminal).length,
    nearTerminal: rows.filter((r) => r.isNearTerminal).length,
    dropped: rows.filter((r) => r.isDropped).length,
    onHold: rows.filter((r) => r.isOnHold).length,
    active: rows.filter(
      (r) => !r.isTerminal && !r.isNearTerminal && !r.isDropped && !r.isOnHold
    ).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic report window (range | hours | from/to) — overview drill only
// ─────────────────────────────────────────────────────────────────────────────

function resolveDateWindow(q: Q): { gte?: Date; lte?: Date } | null {
  const now = new Date();
  const hours = str(q.hours);
  if (hours) {
    const h = parseInt(hours, 10);
    if (!Number.isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3_600_000) };
  }
  const from = str(q.fromDate);
  const to = str(q.toDate);
  if (from || to)
    return {
      ...(from ? { gte: new Date(new Date(from).setHours(0, 0, 0, 0)) } : {}),
      ...(to ? { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } : {}),
    };
  const range = str(q.range);
  if (!range) return null;
  const start = new Date(now);
  switch (range) {
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
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill type → stage-flag filter (no dead columns)
// rejected / withdrawn map to "dropped" (off-pipeline stage)
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_STAGE_WHERE: Record<
  string,
  Prisma.RequirementCandidatePipelineWhereInput
> = {
  sourced: { currentStage: { isSourced: true } },
  active_pipeline: {
    currentStage: {
      pipeline: true,
      isTerminal: false,
      isNearTerminal: false,
      isSourced: false,
    },
  },
  placed: { currentStage: { isTerminal: true } },
  near_terminal: { currentStage: { isNearTerminal: true, isTerminal: false } },
  dropped: { currentStage: { pipeline: false, isTerminal: false } },
  rejected: { currentStage: { pipeline: false, isTerminal: false } },
  withdrawn: { currentStage: { pipeline: false, isTerminal: false } },
  on_hold: { isOnHold: true },
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/overview/drill?type=...
// ─────────────────────────────────────────────────────────────────────────────

export const getOverviewDrill = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const type = str(q.type);
    if (!type)
      return res
        .status(400)
        .json({ success: false, message: "type param is required" });

    const scope = await resolveRequirementScope(req, q);
    const AND: Prisma.RequirementCandidatePipelineWhereInput[] = [
      {
        requirement: { is: { AND: [buildReqFieldWhere(q), scope.scopeWhere] } },
      },
      scope.pipelineOwnerWhere,
    ];
    const reqId = str(q.requirementId);
    if (reqId) AND.push({ requirementId: reqId });

    const win = resolveDateWindow(q);
    if (win) AND.push({ stageUpdatedAt: win });

    let label = type.replace(/_/g, " ");

    if (TYPE_STAGE_WHERE[type]) {
      AND.push(TYPE_STAGE_WHERE[type]);
    } else if (type === "stage") {
      const stageId = str(q.stageId);
      if (!stageId)
        return res
          .status(400)
          .json({ success: false, message: "stageId required for type=stage" });
      AND.push({ currentStageId: stageId });
      label = str(q.stageLabel) ?? label;
    } else if (type === "recruiter") {
      const rid = str(q.recruiterId);
      if (!rid)
        return res
          .status(400)
          .json({
            success: false,
            message: "recruiterId required for type=recruiter",
          });
      if (scope.treeUserIds !== null && !scope.treeUserIds.includes(rid))
        return res
          .status(403)
          .json({ success: false, message: "Recruiter not in your scope" });
      AND.push({ recruiterId: rid });
      label = str(q.recruiterName) ?? label;
    } else if (type === "service_line") {
      const sl = str(q.drillServiceLineId);
      if (!sl)
        return res
          .status(400)
          .json({ success: false, message: "drillServiceLineId required" });
      AND.push({ requirement: { is: { serviceLineId: sl } } });
      label = str(q.drillServiceLineName) ?? label;
    } else if (type === "business_unit") {
      const bu = str(q.drillBusinessUnitId);
      if (!bu)
        return res
          .status(400)
          .json({ success: false, message: "drillBusinessUnitId required" });
      AND.push({ requirement: { is: { businessUnitId: bu } } });
    } else if (type === "department") {
      const depts = toArr(q.departmentId);
      if (!depts.length)
        return res
          .status(400)
          .json({ success: false, message: "departmentId required" });
      AND.push({ recruiter: { is: { departmentId: { in: depts } } } });
      label = str(q.departmentName) ?? label;
    } else {
      return res
        .status(400)
        .json({ success: false, message: `Unknown drill type: ${type}` });
    }

    const where: Prisma.RequirementCandidatePipelineWhereInput = { AND };
    const [total, pipes] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: DRILL_PIPELINE_SELECT,
        orderBy: { createdAt: "desc" },
        take: DRILL_CAP,
      }),
    ]);

    const now = new Date();
    const rows = pipes.map((p) => shapeDrillRow(p, now));

    return res.json({
      success: true,
      data: rows,
      meta: {
        total,
        label,
        drillType: type,
        capped: total > DRILL_CAP,
        stats: drillStats(rows),
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
// GET /reports/requirements/:requirementId/candidates?stageId=&bucket=
// The candidates behind one requirement row / one stage cell.
// Same ownership + activity filter as the table's counts, so the drill count
// always equals the number that was clicked.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_STAGE_WHERE: Record<
  string,
  Prisma.RequirementCandidatePipelineWhereInput
> = {
  nearTerminal: { currentStage: { isNearTerminal: true, isTerminal: false } },
  terminal: { currentStage: { isTerminal: true } },
  dropped: { currentStage: { pipeline: false, isTerminal: false } },
};

export const getRequirementCandidateDrill = async (
  req: Request,
  res: Response
) => {
  try {
    const { requirementId } = req.params;
    const q = req.query as Q;
    if (!requirementId)
      return res
        .status(400)
        .json({ success: false, message: "requirementId is required" });

    const bucket = str(q.bucket);
    if (bucket && !BUCKET_STAGE_WHERE[bucket])
      return res.status(400).json({
        success: false,
        message: `Invalid bucket. Allowed: ${Object.keys(
          BUCKET_STAGE_WHERE
        ).join(", ")}`,
      });

    // Requirement must be inside the caller's scope
    const scope = await resolveRequirementScope(req, q);
    const visible = await prisma.requirement.findFirst({
      where: await buildRequirementWhere(q, scope, { singleId: requirementId }),
      select: { id: true },
    });
    if (!visible)
      return res
        .status(404)
        .json({
          success: false,
          message: "Requirement not found in your scope",
        });

    const stageIds = toArr(q.stageId);
    const AND: Prisma.RequirementCandidatePipelineWhereInput[] = [
      { requirementId },
      scope.pipelineOwnerWhere,
      buildActivityPipelineWhere(q), // same as the table counts
    ];
    if (stageIds.length) AND.push({ currentStageId: { in: stageIds } });
    else if (bucket) AND.push(BUCKET_STAGE_WHERE[bucket]);

    const where: Prisma.RequirementCandidatePipelineWhereInput = { AND };
    const [total, pipes] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: DRILL_PIPELINE_SELECT,
        orderBy: [{ currentStage: { order: "asc" } }, { createdAt: "desc" }],
        take: DRILL_CAP,
      }),
    ]);

    let stageLabel = str(q.stageLabel) ?? null;
    if (!stageLabel && stageIds.length === 1) {
      const stage = await prisma.pipelineStage.findUnique({
        where: { id: stageIds[0] },
        select: { label: true },
      });
      stageLabel = stage?.label ?? null;
    }

    const now = new Date();
    const rows = pipes.map((p) => shapeDrillRow(p, now));

    return res.json({
      success: true,
      data: rows,
      meta: {
        total,
        stageLabel,
        requirementId,
        capped: total > DRILL_CAP,
        stats: drillStats(rows),
      },
    });
  } catch (err) {
    console.error("getRequirementCandidateDrill:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch requirement candidates",
      });
  }
};
