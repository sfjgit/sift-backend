// File: reports.recruiter.stats.controller.ts
// Path: src/controller/reports/reports.recruiter.stats.controller.ts
//
// GET /reports/recruiters/stats
//
// Single purpose: compute recruiter pipeline stats classified by stage flags.
// Accepts every filter the frontend can send — same params as the main
// recruiter report so filters are universal.
//
// Response shape:
// {
//   success: true,
//   data: {
//     totals: {
//       recruiters: number,   // distinct recruiter count
//       sourced:    number,   // all pipeline rows matched
//       inPipeline: number,   // pipeline=true, !isTerminal, !isNearTerminal, !isSourced
//       nearClose:  number,   // isNearTerminal=true, !isTerminal
//       placed:     number,   // isTerminal=true
//       offPipeline:number,   // pipeline=false (rejected/withdrawn/dup/dropped)
//       sourced_only:number,  // isSourced=true (entry stages — sourced but not yet processed)
//     },
//     byRecruiter: [{
//       id, name, email, serviceLineId, serviceLine,
//       sourced, inPipeline, nearClose, placed, offPipeline, sourced_only,
//       placementRate,   // placed/sourced %
//       conversionRate,  // (placed+nearClose)/sourced %
//       stageCounts: { [stageId]: number }  // every stage broken down
//     }],
//     byServiceLine: [{ id, name, sourced, inPipeline, nearClose, placed, offPipeline }],
//     stages: StageMeta[],   // all stages used — for frontend column rendering
//   },
//   meta: { window, scope, filters }
// }

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW
// ─────────────────────────────────────────────────────────────────────────────

interface DateWindow {
  gte?: Date;
  lte?: Date;
}

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

function resolveDateWindow(
  q: Record<string, string | string[] | undefined>,
): DateWindow {
  const now = new Date();
  const hours = str(q.hours);
  const range = str(q.range);
  const fromDate = str(q.fromDate);
  const toDate = str(q.toDate);
  if (hours) {
    const h = parseInt(hours, 10);
    if (!Number.isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3600000), lte: now };
  }
  switch (range) {
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
  if (fromDate)
    w.gte = isDateOnly(fromDate)
      ? startOfDay(new Date(fromDate))
      : new Date(fromDate);
  if (toDate)
    w.lte = isDateOnly(toDate) ? endOfDay(new Date(toDate)) : new Date(toDate);
  return w;
}

function windowLabel(q: Record<string, string | string[] | undefined>): string {
  const hours = str(q.hours);
  const range = str(q.range);
  const fromDate = str(q.fromDate);
  const toDate = str(q.toDate);
  if (hours) return `last-${hours}h`;
  if (range) return range;
  if (fromDate || toDate) return `${fromDate ?? "start"}_to_${toDate ?? "now"}`;
  return "all-time";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE — reads req.scopeFilter set by middleware
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

function parseIds(raw?: string): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD REQUIREMENT WHERE
// Accepts every requirement-level filter the frontend can send
// ─────────────────────────────────────────────────────────────────────────────

// function buildReqWhere(
//   q: Record<string, string | undefined>
// ): Record<string, any> {
//   const where: Record<string, any> = { deletedAt: null };
//   if (q.clientId) where.clientId = q.clientId;
//   if (q.clientSpocId) where.clientSpocId = q.clientSpocId;
//   if (q.serviceLineId) where.serviceLineId = q.serviceLineId;
//   if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
//   if (q.status) where.status = q.status;
//   if (q.priority) where.priority = q.priority;
//   if (q.createdById) where.createdById = q.createdById;
//   return where;
// }

// ADD this before buildReqWhere
function prismaIn(v: string | string[] | undefined) {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.length) return undefined;
  return arr.length === 1 ? arr[0] : { in: arr };
}

function str(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function buildReqWhere(
  q: Record<string, string | string[] | undefined>,
): Record<string, any> {
  const where: Record<string, any> = { deletedAt: null };

  // ── Multi-select (checkbox) filters — can be array or single string ──
  const clientId = prismaIn(q.clientId);
  const clientSpocId = prismaIn(q.clientSpocId);
  const serviceLineId = prismaIn(q.serviceLineId);
  const status = prismaIn(q.status);
  const departmentId = prismaIn(q.departmentId);

  if (clientId) where.clientId = clientId;
  if (clientSpocId) where.clientSpocId = clientSpocId;
  if (serviceLineId) where.serviceLineId = serviceLineId;
  if (status) where.status = status;
  if (departmentId) where.departmentId = departmentId;

  // ── Single-value filters — always a plain string ──
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
  if (q.priority) where.priority = q.priority;
  if (q.createdById) where.createdById = q.createdById;

  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD PIPELINE WHERE
// Accepts every pipeline-level filter + date window activity filter
// ─────────────────────────────────────────────────────────────────────────────

function buildPipelineWhere(
  q: Record<string, string | string[] | undefined>,
  effectiveUserIds: string[] | null,
): Record<string, any> {
  const where: Record<string, any> = {};

  // ── Recruiter scope ───────────────────────────────────────────────────────
  if (effectiveUserIds !== null) {
    where.recruiterId = { in: effectiveUserIds };
  }

  // ── Direct pipeline filters ───────────────────────────────────────────────
  if (q.disposition) where.disposition = q.disposition;
  if (q.currentStageId) where.currentStageId = q.currentStageId;
  if (q.assignmentId) where.assignmentId = q.assignmentId;

  // ── Requirement filters ───────────────────────────────────────────────────
  const reqWhere = buildReqWhere(q);
  // always attach — even if just { deletedAt: null } to exclude deleted reqs
  where.requirement = reqWhere;

  // ── Date window — activity-based: sourced OR updated OR stage moved in window
  const win = resolveDateWindow(q);
  if (win.gte || win.lte) {
    const range = {
      ...(win.gte ? { gte: win.gte } : {}),
      ...(win.lte ? { lte: win.lte } : {}),
    };
    where.OR = [
      { createdAt: range },
      { updatedAt: range },
      { stageHistory: { some: { createdAt: range } } },
    ];
  }

  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE EFFECTIVE USER IDS
// RBAC scope ∩ team picker — team picker can only narrow, never expand
// ─────────────────────────────────────────────────────────────────────────────

function resolveEffectiveUserIds(
  req: Request,
  q: Record<string, string | string[] | undefined>,
): string[] | null {
  const scopedIds = resolveScopedUserIds(req);
  // const teamIds = parseIds(q.userIds);
  const teamIds = parseIds(
    Array.isArray(q.userIds) ? q.userIds.join(",") : q.userIds,
  );

  if (!teamIds) return scopedIds; // no team filter — use RBAC scope as-is

  // Team picker present — intersect with RBAC scope
  if (scopedIds === null) return teamIds; // RBAC = ALL, team picker narrows

  const allowed = new Set(scopedIds);
  const intersected = teamIds.filter((id) => allowed.has(id));
  return intersected.length > 0 ? intersected : [req.user!.id]; // fallback to self
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFY — given stage flags, return which bucket this row falls into
// ─────────────────────────────────────────────────────────────────────────────

type Bucket =
  | "placed"
  | "nearClose"
  | "offPipeline"
  | "sourcedOnly"
  | "inPipeline";

function classify(
  stage: {
    isTerminal: boolean;
    isNearTerminal: boolean;
    isSourced: boolean;
    pipeline: boolean;
  } | null,
): Bucket {
  if (!stage) return "inPipeline"; // safe fallback if stage not loaded
  if (stage.isTerminal) return "placed";
  if (stage.isNearTerminal) return "nearClose";
  if (!stage.pipeline) return "offPipeline";
  if (stage.isSourced) return "sourcedOnly";
  return "inPipeline";
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/stats
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterStats = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const standardOnly = q.standardOnly === "true";
    const effectiveUserIds = resolveEffectiveUserIds(req, q);

    // ── Fetch pipeline rows ───────────────────────────────────────────────────
    const pipelineWhere = buildPipelineWhere(q, effectiveUserIds);

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: {
        id: true,
        recruiterId: true,
        currentStageId: true,
        requirementId: true,
        // ── Stage flags — this is what makes classification work ──────────────
        currentStage: {
          select: {
            id: true,
            label: true,
            order: true,
            isStandard: true,
            isTerminal: true,
            isNearTerminal: true,
            isSourced: true,
            pipeline: true,
            serviceLineId: true,
          },
        },
        // ── Recruiter info ────────────────────────────────────────────────────
        recruiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            servicelineId: true,
            serviceline: { select: { id: true, name: true } },
            departmentId: true,
            department: { select: { id: true, name: true } },
            buId: true,
          },
        },
        // ── Requirement context for service-line grouping ─────────────────────
        requirement: {
          select: {
            serviceLineId: true,
            serviceLine: { select: { id: true, name: true } },
          },
        },
      },
      // No take() — stats need the full set. Date window bounds it.
    });

    // ── Fetch all stages for column metadata ─────────────────────────────────
    const stageFilter: Record<string, any> = { isActive: true };
    if (q.serviceLineId) {
      const slArr = Array.isArray(q.serviceLineId)
        ? q.serviceLineId
        : [q.serviceLineId];

      stageFilter.OR = [
        { serviceLineId: null },
        { serviceLineId: { in: slArr } },
      ];
    }

    const allStages = await prisma.pipelineStage.findMany({
      where: stageFilter,
      select: {
        id: true,
        label: true,
        order: true,
        isStandard: true,
        isTerminal: true,
        isNearTerminal: true,
        isSourced: true,
        pipeline: true,
        serviceLineId: true,
        serviceLine: { select: { id: true, name: true } },
      },
      orderBy: { order: "asc" },
    });

    const activeStages = standardOnly
      ? allStages.filter((s) => s.isStandard)
      : allStages;

    // ── Empty state ───────────────────────────────────────────────────────────
    if (!pipelines.length) {
      return res.json({
        success: true,
        data: {
          totals: {
            recruiters: 0,
            sourced: 0,
            inPipeline: 0,
            nearClose: 0,
            placed: 0,
            offPipeline: 0,
            sourcedOnly: 0,
          },
          byRecruiter: [],
          byServiceLine: [],
          stages: activeStages,
        },
        meta: {
          window: windowLabel(q),
          scope: req.scopeFilter?.type ?? "ALL",
          filters: {
            clientId: q.clientId,
            clientSpocId: q.clientSpocId,
            serviceLineId: q.serviceLineId,
            businessUnitId: q.businessUnitId,
            status: q.status,
            priority: q.priority,
          },
        },
      });
    }

    // ── Aggregate ─────────────────────────────────────────────────────────────
    type RecAgg = {
      id: string;
      name: string;
      email: string;
      serviceLineId: string | null;
      serviceLine: { id: string; name: string } | null;
      sourced: number;
      placed: number;
      nearClose: number;
      offPipeline: number;
      sourcedOnly: number;
      inPipeline: number;
      stageCounts: Record<string, number>;
    };

    const recruiterMap = new Map<string, RecAgg>();

    // Service line agg (by requirement's service line — source of truth)
    type SlAgg = {
      id: string | null;
      name: string;
      sourced: number;
      placed: number;
      nearClose: number;
      offPipeline: number;
      sourcedOnly: number;
      inPipeline: number;
    };
    const slMap = new Map<string, SlAgg>();

    // Grand totals
    let totalPlaced = 0,
      totalNearClose = 0,
      totalOffPipeline = 0,
      totalSourcedOnly = 0,
      totalInPipeline = 0;

    for (const p of pipelines) {
      const rec = p.recruiter;
      const rid = rec.id;

      if (!recruiterMap.has(rid)) {
        recruiterMap.set(rid, {
          id: rid,
          name: `${rec.firstName} ${rec.lastName}`.trim(),
          email: rec.email,
          serviceLineId: rec.servicelineId ?? null,
          serviceLine: rec.serviceline ?? null,
          sourced: 0,
          placed: 0,
          nearClose: 0,
          offPipeline: 0,
          sourcedOnly: 0,
          inPipeline: 0,
          stageCounts: {},
        });
      }

      const ragg = recruiterMap.get(rid)!;
      ragg.sourced++;
      ragg.stageCounts[p.currentStageId] =
        (ragg.stageCounts[p.currentStageId] ?? 0) + 1;

      const bucket = classify(p.currentStage);
      ragg[bucket]++;

      // Service line from requirement
      const reqSl = (p.requirement as any)?.serviceLine ?? null;
      const reqSlId = (p.requirement as any)?.serviceLineId ?? null;
      const slKey = reqSlId ?? "__none__";

      if (!slMap.has(slKey)) {
        slMap.set(slKey, {
          id: reqSlId,
          name: reqSl?.name ?? "Unassigned",
          sourced: 0,
          placed: 0,
          nearClose: 0,
          offPipeline: 0,
          sourcedOnly: 0,
          inPipeline: 0,
        });
      }
      const sagg = slMap.get(slKey)!;
      sagg.sourced++;
      sagg[bucket]++;

      // Grand totals
      if (bucket === "placed") totalPlaced++;
      else if (bucket === "nearClose") totalNearClose++;
      else if (bucket === "offPipeline") totalOffPipeline++;
      else if (bucket === "sourcedOnly") totalSourcedOnly++;
      else totalInPipeline++;
    }

    // ── Build output ──────────────────────────────────────────────────────────
    const byRecruiter = [...recruiterMap.values()]
      .map((r) => ({
        ...r,
        placementRate:
          r.sourced > 0 ? +((r.placed / r.sourced) * 100).toFixed(1) : 0,
        conversionRate:
          r.sourced > 0
            ? +(((r.placed + r.nearClose) / r.sourced) * 100).toFixed(1)
            : 0,
      }))
      .sort((a, b) => b.sourced - a.sourced);

    const byServiceLine = [...slMap.values()].sort(
      (a, b) => b.sourced - a.sourced,
    );

    const totalSourced = pipelines.length;

    return res.json({
      success: true,
      data: {
        totals: {
          recruiters: recruiterMap.size,
          sourced: totalSourced,
          inPipeline: totalInPipeline,
          nearClose: totalNearClose,
          placed: totalPlaced,
          offPipeline: totalOffPipeline,
          sourcedOnly: totalSourcedOnly,
        },
        byRecruiter,
        byServiceLine,
        stages: activeStages,
      },
      meta: {
        window: windowLabel(q),
        scope: req.scopeFilter?.type ?? "ALL",
        filters: {
          clientId: q.clientId ?? null,
          clientSpocId: q.clientSpocId ?? null,
          serviceLineId: q.serviceLineId ?? null,
          businessUnitId: q.businessUnitId ?? null,
          status: q.status ?? null,
          priority: q.priority ?? null,
          createdById: q.createdById ?? null,
          disposition: q.disposition ?? null,
        },
      },
    });
  } catch (err) {
    console.error("getRecruiterStats:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter stats" });
  }
};
