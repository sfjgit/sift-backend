// File: reports.recruiter.stats.controller.ts
// Path: src/controller/reports/reports.recruiter.stats.controller.ts

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

function str(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
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

function parseIds(raw?: string): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : null;
}

function prismaIn(v: string | string[] | undefined) {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.length) return undefined;
  return arr.length === 1 ? arr[0] : { in: arr };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOJ HELPERS
// mojMonth = "2025-09" → monthOfJoining = "September 2025"
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
// REQUIREMENT WHERE
// ─────────────────────────────────────────────────────────────────────────────

function buildReqWhere(
  q: Record<string, string | string[] | undefined>,
): Record<string, any> {
  const where: Record<string, any> = { deletedAt: null };

  const clientId = prismaIn(q.clientId);
  const clientSpocId = prismaIn(q.clientSpocId);
  const serviceLineId = prismaIn(q.serviceLineId);
  const status = prismaIn(q.status);

  if (clientId) where.clientId = clientId;
  if (clientSpocId) where.clientSpocId = clientSpocId;
  if (serviceLineId) where.serviceLineId = serviceLineId;
  if (status) where.status = status;
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
  if (q.priority) where.priority = q.priority;

  // ── CSM / creator filter ──────────────────────────────────────────────────
  // Super manager picks a CSM → filter requirements created by that CSM.
  // createdById can be a single ID or comma-separated list.
  const createdById = prismaIn(q.createdById);
  if (createdById) where.createdById = createdById;

  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE WHERE
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

  // ── Department filter on recruiter ────────────────────────────────────────
  const departmentId = prismaIn(q.departmentId);
  if (departmentId) {
    where.recruiter = { is: { departmentId } };
  }

  // ── Direct pipeline filters ───────────────────────────────────────────────
  if (q.disposition) where.disposition = q.disposition;
  if (q.currentStageId) where.currentStageId = q.currentStageId;
  if (q.assignmentId) where.assignmentId = q.assignmentId;

  // ── MOJ filter ────────────────────────────────────────────────────────────
  // mojMonth = "2025-09" → filter by stored monthOfJoining string "September 2025"
  // mojYear  = "2025"    → filter all months in that year
  //
  // monthOfJoining is indexed — this is just a WHERE on an indexed string column,
  // no reverse lookup into candidate service needed.
  const rawMoj = q.mojMonth;
  const mojMonths: string[] = Array.isArray(rawMoj)
    ? rawMoj
    : rawMoj
      ? [rawMoj]
      : [];
  const mojYear = str(q.mojYear);

  if (mojMonths.length === 1) {
    const label = mojMonthToLabel(mojMonths[0]);
    if (label) where.monthOfJoining = label;
  } else if (mojMonths.length > 1) {
    const labels = mojMonths.map((m) => mojMonthToLabel(m)).filter(Boolean);
    if (labels.length) where.monthOfJoining = { in: labels };
  } else if (mojYear) {
    where.monthOfJoining = { contains: mojYear };
  }

  // ── Requirement filters (includes createdById for CSM filter) ─────────────
  const reqWhere = buildReqWhere(q);
  where.requirement = { is: reqWhere };

  // ── Date window — activity-based ──────────────────────────────────────────
  // NOTE: when mojMonth is active, date window still applies on top.
  // Both conditions must match — candidates joining in Sep AND activity in window.
  // If that's too restrictive, skip date window when mojMonth is set.
  // For now: apply both (stricter, more correct for "who worked in this period").
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
// ─────────────────────────────────────────────────────────────────────────────

function resolveEffectiveUserIds(
  req: Request,
  q: Record<string, string | string[] | undefined>,
): string[] | null {
  const scopedIds = resolveScopedUserIds(req);
  const teamIds = parseIds(
    Array.isArray(q.userIds) ? q.userIds.join(",") : q.userIds,
  );

  if (!teamIds) return scopedIds;
  if (scopedIds === null) return teamIds;

  const allowed = new Set(scopedIds);
  const intersected = teamIds.filter((id) => allowed.has(id));
  return intersected.length > 0 ? intersected : [req.user!.id];
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFY
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
  if (!stage) return "inPipeline";
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

    const pipelineWhere = buildPipelineWhere(q, effectiveUserIds);
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: {
        id: true,
        recruiterId: true,
        currentStageId: true,
        requirementId: true,
        monthOfJoining: true,
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
        requirement: {
          select: {
            serviceLineId: true,
            serviceLine: { select: { id: true, name: true } },
            // Include creator info so frontend can group/display CSM context
            createdById: true,
            createdBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
    // ── Filters echo (shared by empty + main response) ───────────────────────
    const mojMonthsEcho = (
      Array.isArray(q.mojMonth) ? q.mojMonth : q.mojMonth ? [q.mojMonth] : []
    )
      .flatMap((m) => m.split(","))
      .map((m) => m.trim())
      .filter(Boolean);

    const filtersEcho = {
      clientId: q.clientId ?? null,
      clientSpocId: q.clientSpocId ?? null,
      serviceLineId: q.serviceLineId ?? null,
      businessUnitId: q.businessUnitId ?? null,
      status: q.status ?? null,
      priority: q.priority ?? null,
      createdById: q.createdById ?? null,
      disposition: q.disposition ?? null,
      mojMonths: mojMonthsEcho,
      mojYear: str(q.mojYear) ?? null,
    };
    // ── Stage metadata ────────────────────────────────────────────────────────
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
          // Echo active filters back so frontend knows what's applied
          filters: {
            clientId: q.clientId ?? null,
            clientSpocId: q.clientSpocId ?? null,
            serviceLineId: q.serviceLineId ?? null,
            businessUnitId: q.businessUnitId ?? null,
            status: q.status ?? null,
            priority: q.priority ?? null,
            createdById: q.createdById ?? null,
            disposition: q.disposition ?? null,
            mojMonths: Array.isArray(q.mojMonth)
              ? q.mojMonth
              : q.mojMonth
                ? [q.mojMonth]
                : [],
            mojYear: str(q.mojYear) ?? null,
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
      total: number;
      stageCounts: Record<string, number>;
    };

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

    const recruiterMap = new Map<string, RecAgg>();
    const slMap = new Map<string, SlAgg>();

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
          total: 0,
          stageCounts: {},
        });
      }

      const ragg = recruiterMap.get(rid)!;
      ragg.sourced++;
      ragg.stageCounts[p.currentStageId] =
        (ragg.stageCounts[p.currentStageId] ?? 0) + 1;
      ragg.total++;

      const bucket = classify(p.currentStage);
      ragg[bucket]++;

      // Service line from requirement (source of truth)
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

      if (bucket === "placed") totalPlaced++;
      else if (bucket === "nearClose") totalNearClose++;
      else if (bucket === "offPipeline") totalOffPipeline++;
      else if (bucket === "sourcedOnly") totalSourcedOnly++;
      else totalInPipeline++;
    }

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
        // filters: {
        //   clientId: q.clientId ?? null,
        //   clientSpocId: q.clientSpocId ?? null,
        //   serviceLineId: q.serviceLineId ?? null,
        //   businessUnitId: q.businessUnitId ?? null,
        //   status: q.status ?? null,
        //   priority: q.priority ?? null,
        //   createdById: q.createdById ?? null,
        //   disposition: q.disposition ?? null,
        //   mojMonth: str(q.mojMonth) ?? null,
        //   mojYear: str(q.mojYear) ?? null,
        // },
        filetrs: filtersEcho,
      },
    });
  } catch (err) {
    console.error("getRecruiterStats:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch recruiter stats" });
  }
};
