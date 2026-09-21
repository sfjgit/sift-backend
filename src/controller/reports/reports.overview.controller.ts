// File: reports.overview.controller.ts
// Path: src/controller/reports/reports.overview.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW HELPERS  (same pattern as reports.controller.ts)
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

function windowLabel(q: Record<string, string | undefined>): string {
  if (q.hours) return `last-${q.hours}h`;
  if (q.range) return q.range;
  if (q.fromDate || q.toDate)
    return `${q.fromDate ?? "start"}_to_${q.toDate ?? "now"}`;
  return "all-time";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE HELPER  (reads from req.scopeFilter set by middleware)
// Returns null = no restriction (ALL / super admin)
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

// Merges RBAC scope with optional team filter from tree picker.
// Team filter can only NARROW scope, never expand it — security guarantee.
function resolveEffectiveUserIds(
  req: Request,
  q: Record<string, string | undefined>,
): string[] | null {
  const scopedUserIds = resolveScopedUserIds(req);

  if (!q.userIds) return scopedUserIds;

  const teamIds = q.userIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!teamIds.length) return scopedUserIds;

  // RBAC says ALL — team filter alone narrows
  if (scopedUserIds === null) return teamIds;

  // Intersect — team filter can only narrow, never expand
  const allowed = new Set(scopedUserIds);
  const intersected = teamIds.filter((id) => allowed.has(id));

  // Empty intersection = someone tried to see outside their scope → fallback to self
  if (!intersected.length) return [req.user!.id];

  return intersected;
}

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE COMPUTATION  (pure fn, no DB — same priority chain as main controller)
// 1. SALE_VALUE  — req.saleValue > 0
// 2. BAND        — band.value > 0
// 3. FIXED_PCT   — client.percentageValue > 0 AND salaryMin > 0
// 4. NOT_FOUND   — null
// ─────────────────────────────────────────────────────────────────────────────

function computeSaleValue(input: {
  saleValue?: number | null;
  totalOpenings: number;
  salaryMin?: number | null;
  band?: { value?: number | null } | null;
  client?: { percentageValue?: number | null } | null;
}): number | null {
  const open = input.totalOpenings ?? 1;
  if (input.saleValue != null && input.saleValue > 0)
    return input.saleValue * open;
  const bv = input.band?.value != null ? Number(input.band.value) : null;
  if (bv != null && bv > 0) return bv * open;
  const pct =
    input.client?.percentageValue != null
      ? Number(input.client.percentageValue)
      : null;
  const sm = input.salaryMin != null ? Number(input.salaryMin) : null;
  if (pct != null && pct > 0 && sm != null && sm > 0)
    return sm * (pct / 100) * open;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BFS: get all descendant user IDs (both reportingToId AND teamLeadId trees)
// Used to build the team hierarchy breakdown.
// ─────────────────────────────────────────────────────────────────────────────

async function getDescendantsWithDepth(
  rootId: string,
): Promise<{ id: string; depth: number }[]> {
  const result: { id: string; depth: number }[] = [];
  const visited = new Set<string>([rootId]);
  let frontier = [{ id: rootId, depth: 0 }];

  while (frontier.length > 0) {
    const ids = frontier.map((f) => f.id);
    const children = await prisma.user.findMany({
      where: {
        OR: [{ reportingToId: { in: ids } }, { teamLeadId: { in: ids } }],
        isActive: true,
        id: { notIn: [...visited] },
      },
      select: { id: true, reportingToId: true, teamLeadId: true },
    });

    const nextFrontier: { id: string; depth: number }[] = [];
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        // depth = parent depth + 1
        const parentDepth =
          frontier.find(
            (f) => f.id === child.reportingToId || f.id === child.teamLeadId,
          )?.depth ?? 0;
        const entry = { id: child.id, depth: parentDepth + 1 };
        result.push(entry);
        nextFrontier.push(entry);
      }
    }
    frontier = nextFrontier;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/overview
//
// Returns:
//   kpis          — total candidates, pipeline (non-terminal), placed (terminal),
//                   total sale value, achieved value, avg pipeline days
//   funnelStages  — pipeline stages (isTerminal=false, pipeline=true) with counts
//   terminalStages— terminal stages (isTerminal=true) with counts + achieved value
//   byServiceLine — per-SL breakdown with their own funnel + terminal data
//   byBusinessUnit— per-BU breakdown
//   byDepartment  — per-dept breakdown
//   timeSeries    — candidate additions over time (hourly or daily)
//   dispositionCounts — ACTIVE/DROPPED/PLACED breakdown
//   leaderboard   — top recruiters by sourced count
//   teamTree      — immediate direct reports with their team stats (for managers)
//   saleValueBreakdown — by basis (SALE_VALUE / BAND / FIXED_PCT / NOT_FOUND)
// ─────────────────────────────────────────────────────────────────────────────

export const getReportsOverview = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const win = resolveDateWindow(q);
    const scopedUserIds = resolveEffectiveUserIds(req, q);
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // ── Build requirement filter ──────────────────────────────────────────────
    const reqWhere: Record<string, any> = { deletedAt: null };
    // if (q.clientId) reqWhere.clientId = q.clientId;
    // if (q.clientSpocId) reqWhere.clientSpocId = q.clientSpocId; // ← ADD
    // if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
    // fix — handle both single and array
    const toArray = (v: any): string[] =>
      !v ? [] : Array.isArray(v) ? v : [v];

    const clientIds = toArray(q.clientId);
    const spocIds = toArray(q.clientSpocId);
    const slIds = toArray(q.serviceLineId);

    if (clientIds.length)
      reqWhere.clientId =
        clientIds.length === 1 ? clientIds[0] : { in: clientIds };
    if (spocIds.length)
      reqWhere.clientSpocId =
        spocIds.length === 1 ? spocIds[0] : { in: spocIds };
    if (slIds.length)
      reqWhere.serviceLineId = slIds.length === 1 ? slIds[0] : { in: slIds };
    if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
    // if (q.status) reqWhere.status = q.status;
    const statuses = toArray(q.status);
    if (statuses.length)
      reqWhere.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    // if (win.gte || win.lte) {
    //   reqWhere.createdAt = {
    //     ...(win.gte ? { gte: win.gte } : {}),
    //     ...(win.lte ? { lte: win.lte } : {}),
    //   };
    // }
    // if (win.gte || win.lte) {
    //   reqWhere.createdAt = {
    //     ...(win.gte ? { gte: win.gte } : {}),
    //     ...(win.lte ? { lte: win.lte } : {}),
    //   };
    // }

    // ── Resolve which users to scope requirements to ──────────────────────────
    // 1. Team picker selected → use those ids (already RBAC-intersected)
    // 2. Not super admin     → use RBAC scope (their subtree)
    // 3. Super admin, no filter → null = see everything
    const teamUserIds: string[] | null = (() => {
      if (q.userIds) return scopedUserIds; // already intersected
      if (isSuperAdmin) return null;
      return scopedUserIds ?? [userId];
    })();

    // ── Scope requirements: created by OR assigned to team ────────────────────
    // Collect UNIQUE requirementIds — no double counting ever
    if (teamUserIds !== null) {
      const [assignedRows, createdRows] = await Promise.all([
        prisma.requirementAssignment.findMany({
          where: { assignedToId: { in: teamUserIds }, status: "ACTIVE" },
          select: { requirementId: true },
        }),
        prisma.requirement.findMany({
          where: { createdById: { in: teamUserIds }, deletedAt: null },
          select: { id: true },
        }),
        // prisma.requirement.findMany({
        //   where: {
        //     createdById: { in: teamUserIds },
        //     deletedAt: null,
        //     ...(win.gte || win.lte
        //       ? {
        //           createdAt: {
        //             ...(win.gte ? { gte: win.gte } : {}),
        //             ...(win.lte ? { lte: win.lte } : {}),
        //           },
        //         }
        //       : {}),
        //   },
        //   select: { id: true },
        // }),
      ]);

      const uniqueReqIds = new Set<string>([
        ...assignedRows.map((a) => a.requirementId),
        ...createdRows.map((r) => r.id),
      ]);

      reqWhere.id =
        uniqueReqIds.size > 0 ? { in: [...uniqueReqIds] } : { in: [] };
    }

    // ── Build pipeline filter ─────────────────────────────────────────────────
    // const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    // if (scopedUserIds !== null)
    //   pipelineWhere.recruiterId = { in: scopedUserIds };
    // changed
    const pipelineWhere: Record<string, any> = { requirement: reqWhere };
    if (scopedUserIds !== null)
      pipelineWhere.recruiterId = { in: scopedUserIds };

    // Date window filters on when the pipeline row was last stage-updated
    // (covers "moved to Training Started today" even if req is old)
    if (win.gte || win.lte) {
      pipelineWhere.stageUpdatedAt = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
    }
    if (q.createdById) pipelineWhere.recruiterId = q.createdById;

    // Department filter — resolve department members first
    if (q.departmentId) {
      const deptIds = toArray(q.departmentId);
      const deptUsers = await prisma.user.findMany({
        where: {
          departmentId: deptIds.length === 1 ? deptIds[0] : { in: deptIds },
          isActive: true,
        },
        select: { id: true },
      });
      // const deptIds = deptUsers.map((u) => u.id);
      // Intersect with scope if already scoped
      if (scopedUserIds !== null) {
        pipelineWhere.recruiterId = {
          in: deptIds.filter((id) => scopedUserIds.includes(id)),
        };
      } else {
        pipelineWhere.recruiterId = { in: deptIds };
      }
    }

    // ── Fetch all relevant pipeline stages from DB ─────────────────────────────
    // NO canonical stage dependency — pure isTerminal + pipeline flags
    const slFilter = q.serviceLineId
      ? { OR: [{ serviceLineId: null }, { serviceLineId: q.serviceLineId }] }
      : {};

    const [allStages, requirements] = await Promise.all([
      prisma.pipelineStage.findMany({
        where: { isActive: true, ...slFilter },
        select: {
          id: true,
          code: true,
          label: true,
          order: true,
          isTerminal: true,
          isNearTerminal: true,
          isSourced: true,
          pipeline: true,
          isStandard: true,
          serviceLineId: true,
          serviceLine: { select: { id: true, name: true } },
        },
        orderBy: { order: "asc" },
      }),
      // Fetch requirements for sale value computation
      prisma.requirement.findMany({
        where: reqWhere,
        select: {
          id: true,
          totalOpenings: true,
          serviceLineId: true,
          businessUnitId: true,
          saleValue: true,
          salaryMin: true,
          band: { select: { value: true } },
          client: {
            select: {
              percentageValue: true,
              agreementType: true,
            },
          },
          serviceLine: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
        },
      }),
    ]);

    // Separate pipeline stages (in-progress) vs terminal stages (placed/achieved)
    const pipelineStages = allStages.filter(
      (s) => s.pipeline === true && s.isTerminal === false,
    );
    const terminalStages = allStages.filter((s) => s.isTerminal === true);
    const allTrackedIds = allStages.map((s) => s.id);
    const stageById = new Map(allStages.map((s) => [s.id, s]));

    // ── Fetch pipeline rows ───────────────────────────────────────────────────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: pipelineWhere,
      select: {
        id: true,
        recruiterId: true,
        requirementId: true,
        currentStageId: true,
        disposition: true,
        isRejected: true,
        isWithdrawn: true,
        submittedAt: true,
        offerStatus: true,
        actualJoiningDate: true,
        stageUpdatedAt: true,
        createdAt: true,
        stageHistory: { select: { timeInPrevStageMins: true } },
        recruiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            departmentId: true,
            department: { select: { id: true, name: true } },
            buId: true,
            bu: { select: { id: true, name: true } },
            servicelineId: true,
            serviceline: { select: { id: true, name: true } },
            reportingToId: true,
            teamLeadId: true,
          },
        },
        requirement: {
          select: {
            serviceLineId: true,
            businessUnitId: true,
            serviceLine: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
            totalOpenings: true,
          },
        },
      },
    });

    if (!pipelines.length && !requirements.length) {
      return res.json({
        success: true,
        data: buildEmptyOverview(),
        meta: { window: windowLabel(q), scope: req.scopeFilter?.type ?? "ALL" },
      });
    }

    const now = Date.now();

    // ── Compute sale value stats from requirements ─────────────────────────────
    let totalSaleValue = 0;
    let saleValueIncluded = 0;
    let saleValueOmitted = 0;
    const byBasis: Record<string, { count: number; total: number }> = {
      SALE_VALUE: { count: 0, total: 0 },
      BAND: { count: 0, total: 0 },
      FIXED_PCT: { count: 0, total: 0 },
      NOT_FOUND: { count: 0, total: 0 },
    };

    // Terminal counts per requirement for achieved value
    const reqIds = requirements.map((r) => r.id);
    const terminalStageIds = terminalStages.map((s) => s.id);

    const terminalCountsRaw =
      terminalStageIds.length > 0 && reqIds.length > 0
        ? await prisma.requirementCandidatePipeline.groupBy({
            by: ["requirementId", "currentStageId"],
            where: {
              requirementId: { in: reqIds },
              currentStageId: { in: terminalStageIds },
              ...(win.gte || win.lte
                ? {
                    stageUpdatedAt: {
                      ...(win.gte ? { gte: win.gte } : {}),
                      ...(win.lte ? { lte: win.lte } : {}),
                    },
                  }
                : {}),
            },
            _count: { id: true },
          })
        : [];

    // Build: reqId → { stageId → count }
    const terminalByReq: Record<string, Record<string, number>> = {};
    for (const tc of terminalCountsRaw as any[]) {
      if (!terminalByReq[tc.requirementId])
        terminalByReq[tc.requirementId] = {};
      terminalByReq[tc.requirementId][tc.currentStageId] = tc._count.id;
    }

    let totalAchievedValue = 0;

    for (const r of requirements) {
      const sv = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
        band: r.band
          ? { value: r.band.value != null ? Number(r.band.value) : null }
          : null,
        client: r.client
          ? {
              percentageValue:
                r.client.percentageValue != null
                  ? Number(r.client.percentageValue)
                  : null,
            }
          : null,
      });

      let basis = "NOT_FOUND";
      if (sv != null) {
        saleValueIncluded++;
        totalSaleValue += sv;
        // Determine basis
        if (r.saleValue != null && r.saleValue > 0) basis = "SALE_VALUE";
        else if (r.band?.value != null && Number(r.band.value) > 0)
          basis = "BAND";
        else basis = "FIXED_PCT";
        byBasis[basis].count++;
        byBasis[basis].total += sv;

        // Achieved value
        const reqTerminal = terminalByReq[r.id] ?? {};
        let termCount = 0;
        for (const ts of terminalStages) {
          if (ts.serviceLineId && ts.serviceLineId !== r.serviceLineId)
            continue;
          termCount += reqTerminal[ts.id] ?? 0;
        }
        if (r.totalOpenings > 0) {
          totalAchievedValue += (termCount / r.totalOpenings) * sv;
        }
      } else {
        saleValueOmitted++;
        byBasis["NOT_FOUND"].count++;
      }
    }

    // ── Aggregate pipeline data ───────────────────────────────────────────────
    const NONE = "__none__";
    const total = pipelines.length;

    // KPI accumulators
    let placed = 0; // candidates in terminal stages
    let dropped = 0; // isRejected || isWithdrawn
    let active = 0; // ACTIVE disposition

    // Stage counts — split into pipeline vs terminal
    const pipelineStageCounts: Record<string, number> = Object.fromEntries(
      pipelineStages.map((s) => [s.id, 0]),
    );
    const terminalStageCounts: Record<string, number> = Object.fromEntries(
      terminalStages.map((s) => [s.id, 0]),
    );

    const nearTerminalStageCounts: Record<string, number> = Object.fromEntries(
      allStages
        .filter((s) => s.isNearTerminal && !s.isTerminal)
        .map((s) => [s.id, 0]),
    );
    let inProgressCount = 0;

    const dispositionCounts: Record<string, number> = {};

    // Recruiter leaderboard
    const recruiterAgg: Record<
      string,
      {
        id: string;
        name: string;
        email: string;
        sourced: number;
        placed: number;
        active: number;
        dropped: number;
        avgPipelineDays: number;
        totalMins: number;
      }
    > = {};

    // Service line breakdown
    type SlAgg = {
      id: string | null;
      name: string;
      total: number;
      placed: number;
      active: number;
      dropped: number;
      pipelineCounts: Record<string, number>;
      terminalCounts: Record<string, number>;
    };
    const slAgg: Record<string, SlAgg> = {};

    // Business unit breakdown
    type BuAgg = {
      id: string | null;
      name: string;
      total: number;
      placed: number;
    };
    const buAgg: Record<string, BuAgg> = {};

    // Department breakdown
    type DeptAgg = {
      id: string | null;
      name: string;
      recruiters: Set<string>;
      total: number;
      placed: number;
      active: number;
    };
    const deptAgg: Record<string, DeptAgg> = {};

    // Time series
    const spanMs =
      win.gte && win.lte ? win.lte.getTime() - win.gte.getTime() : Infinity;
    const bucketByHour = spanMs <= 2 * 24 * 60 * 60 * 1000;
    const series: Record<string, number> = {};

    const bucketKey = (d: Date): string => {
      if (bucketByHour) {
        const x = new Date(d);
        x.setMinutes(0, 0, 0);
        return x.toISOString();
      }
      return startOfDay(d).toISOString();
    };

    // Avg pipeline days
    let totalPipelineMins = 0;

    for (const p of pipelines) {
      const stage = stageById.get(p.currentStageId);
      const isTerminal = stage?.isTerminal ?? false;
      const isPipeline = stage?.pipeline ?? false;

      // Stage counts
      if (isTerminal && p.currentStageId in terminalStageCounts) {
        terminalStageCounts[p.currentStageId]++;
        placed++;
      } else if (!isTerminal && p.currentStageId in pipelineStageCounts) {
        pipelineStageCounts[p.currentStageId]++;
        // near-terminal sub-count
        if (stage?.isNearTerminal) {
          nearTerminalStageCounts[p.currentStageId] =
            (nearTerminalStageCounts[p.currentStageId] ?? 0) + 1;
        }
        // in-progress = pipeline=true, isTerminal=false, isSourced=false
        if (stage?.pipeline === true && !stage?.isSourced) {
          inProgressCount++;
        }
      }
      // Disposition
      dispositionCounts[p.disposition] =
        (dispositionCounts[p.disposition] ?? 0) + 1;

      if (p.disposition === "ACTIVE") active++;
      if (p.isRejected || p.isWithdrawn || p.disposition === "DROPPED")
        dropped++;

      // Time series bucket
      const bk = bucketKey(new Date(p.createdAt));
      series[bk] = (series[bk] ?? 0) + 1;

      // Pipeline days
      const stageAgeMins = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
      );
      const candidateMins =
        (p.stageHistory ?? []).reduce(
          (sum: number, l: any) => sum + (l.timeInPrevStageMins ?? 0),
          0,
        ) + stageAgeMins;
      totalPipelineMins += candidateMins;

      // Recruiter agg
      const rid = p.recruiterId;
      const rec = p.recruiter;
      if (!recruiterAgg[rid]) {
        recruiterAgg[rid] = {
          id: rid,
          name: `${rec.firstName} ${rec.lastName}`,
          email: rec.email,
          sourced: 0,
          placed: 0,
          active: 0,
          dropped: 0,
          avgPipelineDays: 0,
          totalMins: 0,
        };
      }
      recruiterAgg[rid].sourced++;
      recruiterAgg[rid].totalMins += candidateMins;
      if (isTerminal) recruiterAgg[rid].placed++;
      if (p.disposition === "ACTIVE") recruiterAgg[rid].active++;
      if (p.isRejected || p.isWithdrawn) recruiterAgg[rid].dropped++;

      // Service line agg — use requirement's SL as source of truth
      const rq = p.requirement as any;
      const slId: string | null = rq?.serviceLineId ?? null;
      const slKey = slId ?? NONE;
      if (!slAgg[slKey]) {
        slAgg[slKey] = {
          id: slId,
          name: rq?.serviceLine?.name ?? "Unassigned",
          total: 0,
          placed: 0,
          active: 0,
          dropped: 0,
          pipelineCounts: Object.fromEntries(
            pipelineStages.map((s) => [s.id, 0]),
          ),
          terminalCounts: Object.fromEntries(
            terminalStages.map((s) => [s.id, 0]),
          ),
        };
      }
      slAgg[slKey].total++;
      if (isTerminal) slAgg[slKey].placed++;
      if (p.disposition === "ACTIVE") slAgg[slKey].active++;
      if (p.isRejected || p.isWithdrawn) slAgg[slKey].dropped++;
      if (isTerminal && p.currentStageId in slAgg[slKey].terminalCounts)
        slAgg[slKey].terminalCounts[p.currentStageId]++;
      else if (!isTerminal && p.currentStageId in slAgg[slKey].pipelineCounts)
        slAgg[slKey].pipelineCounts[p.currentStageId]++;

      // Business unit agg
      const buId: string | null = rq?.businessUnitId ?? null;
      const buKey = buId ?? NONE;
      if (!buAgg[buKey]) {
        buAgg[buKey] = {
          id: buId,
          name: rq?.businessUnit?.name ?? "Unassigned",
          total: 0,
          placed: 0,
        };
      }
      buAgg[buKey].total++;
      if (isTerminal) buAgg[buKey].placed++;

      // Department agg
      const deptId = rec.departmentId ?? null;
      const deptKey = deptId ?? NONE;
      if (!deptAgg[deptKey]) {
        deptAgg[deptKey] = {
          id: deptId,
          name: rec.department?.name ?? "No Department",
          recruiters: new Set(),
          total: 0,
          placed: 0,
          active: 0,
        };
      }
      deptAgg[deptKey].recruiters.add(rid);
      deptAgg[deptKey].total++;
      if (isTerminal) deptAgg[deptKey].placed++;
      if (p.disposition === "ACTIVE") deptAgg[deptKey].active++;
    }

    // ── Team tree — immediate subordinates of the current user ────────────────
    // Only built when user is NOT super admin (would be massive), or when explicitly
    // scoped. Shows direct reports + their team stats.
    let teamTree: any[] = [];

    if (!isSuperAdmin || q.teamRootId) {
      const treeRootId = q.teamRootId ?? userId;
      const directReports = await prisma.user.findMany({
        where: {
          OR: [{ reportingToId: treeRootId }, { teamLeadId: treeRootId }],
          isActive: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: { select: { name: true } },
          department: { select: { name: true } },
          serviceline: { select: { name: true } },
        },
      });

      // For each direct report get their pipeline stats
      for (const dr of directReports) {
        // BFS to get all their descendants
        const descendants = await getDescendantsWithDepth(dr.id);
        const teamIds = [dr.id, ...descendants.map((d) => d.id)];

        const teamStats = await prisma.requirementCandidatePipeline.aggregate({
          where: {
            ...pipelineWhere,
            recruiterId: { in: teamIds },
          },
          _count: { id: true },
        });

        const teamPlaced =
          terminalStageIds.length > 0
            ? await prisma.requirementCandidatePipeline.count({
                where: {
                  ...pipelineWhere,
                  recruiterId: { in: teamIds },
                  currentStageId: { in: terminalStageIds },
                },
              })
            : 0;

        const teamActive = await prisma.requirementCandidatePipeline.count({
          where: {
            ...pipelineWhere,
            recruiterId: { in: teamIds },
            disposition: "ACTIVE",
          },
        });

        teamTree.push({
          id: dr.id,
          name: `${dr.firstName} ${dr.lastName}`,
          email: dr.email,
          role: dr.role?.name,
          department: dr.department?.name,
          serviceLine: dr.serviceline?.name,
          teamSize: teamIds.length,
          stats: {
            total: teamStats._count.id,
            placed: teamPlaced,
            active: teamActive,
            placementRate:
              teamStats._count.id > 0
                ? +((teamPlaced / teamStats._count.id) * 100).toFixed(1)
                : 0,
          },
        });
      }

      teamTree.sort((a, b) => b.stats.total - a.stats.total);
    }

    // ── Finalize leaderboard ──────────────────────────────────────────────────
    const leaderboard = Object.values(recruiterAgg)
      .map((r) => ({
        ...r,
        avgPipelineDays:
          r.sourced > 0 ? +(r.totalMins / r.sourced / 1440).toFixed(1) : 0,
        placementRate:
          r.sourced > 0 ? +((r.placed / r.sourced) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.sourced - a.sourced)
      .slice(0, 15);

    // ── Time series ───────────────────────────────────────────────────────────
    const timeSeries = Object.entries(series)
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    // ── Pipeline funnel (non-terminal, in-progress stages) ────────────────────
    const funnelStages = pipelineStages
      .map((s) => ({
        stageId: s.id,
        code: s.code,
        label: s.label,
        order: s.order,
        isStandard: s.isStandard,
        serviceLineId: s.serviceLineId,
        serviceLine: s.serviceLine ?? null,
        count: pipelineStageCounts[s.id] ?? 0,
        pct:
          total > 0
            ? +(((pipelineStageCounts[s.id] ?? 0) / total) * 100).toFixed(1)
            : 0,
      }))
      .filter((s) => s.count > 0);

    // ── Terminal / placed stages ───────────────────────────────────────────────
    const terminalBreakdown = terminalStages
      .map((s) => ({
        stageId: s.id,
        code: s.code,
        label: s.label,
        order: s.order,
        serviceLineId: s.serviceLineId,
        serviceLine: s.serviceLine ?? null,
        count: terminalStageCounts[s.id] ?? 0,
      }))
      .filter((s) => s.count > 0);

    // ── SL breakdown ──────────────────────────────────────────────────────────
    const byServiceLine = Object.values(slAgg)
      .sort((a, b) => b.total - a.total)
      .map((sl) => ({
        serviceLineId: sl.id,
        name: sl.name,
        total: sl.total,
        placed: sl.placed,
        active: sl.active,
        dropped: sl.dropped,
        placementRate:
          sl.total > 0 ? +((sl.placed / sl.total) * 100).toFixed(1) : 0,
        funnelStages: pipelineStages
          .map((s) => ({
            stageId: s.id,
            label: s.label,
            count: sl.pipelineCounts[s.id] ?? 0,
          }))
          .filter((s) => s.count > 0),
        terminalStages: terminalStages
          .map((s) => ({
            stageId: s.id,
            label: s.label,
            count: sl.terminalCounts[s.id] ?? 0,
          }))
          .filter((s) => s.count > 0),
      }));

    const byBusinessUnit = Object.values(buAgg).sort(
      (a, b) => b.total - a.total,
    );

    const byDepartment = Object.values(deptAgg)
      .sort((a, b) => b.total - a.total)
      .map((d) => ({
        id: d.id,
        name: d.name,
        recruiterCount: d.recruiters.size,
        total: d.total,
        placed: d.placed,
        active: d.active,
        placementRate:
          d.total > 0 ? +((d.placed / d.total) * 100).toFixed(1) : 0,
      }));

    const avgPipelineDays =
      total > 0 ? +(totalPipelineMins / total / 1440).toFixed(1) : 0;

    // ── Near-terminal pipeline value ──────────────────────────────────────────
    const nearTerminalCount = Object.values(nearTerminalStageCounts).reduce(
      (a, b) => a + b,
      0,
    );
    const reqMap = new Map(requirements.map((r) => [r.id, r]));
    let nearTerminalPipelineValue = 0;
    for (const p of pipelines) {
      const stage = stageById.get(p.currentStageId);
      if (stage?.isNearTerminal && !stage?.isTerminal) {
        const reqMatch = reqMap.get(p.requirementId);
        if (reqMatch) {
          const sv = computeSaleValue({
            saleValue: reqMatch.saleValue,
            totalOpenings: reqMatch.totalOpenings,
            salaryMin: reqMatch.salaryMin,
            band: reqMatch.band
              ? {
                  value:
                    reqMatch.band.value != null
                      ? Number(reqMatch.band.value)
                      : null,
                }
              : null,
            client: reqMatch.client
              ? {
                  percentageValue:
                    reqMatch.client.percentageValue != null
                      ? Number(reqMatch.client.percentageValue)
                      : null,
                }
              : null,
          });
          if (sv)
            nearTerminalPipelineValue += sv / (reqMatch.totalOpenings || 1);
        }
      }
    }

    // ── Placement / fill rate ─────────────────────────────────────────────────
    const fillRate = total > 0 ? +((placed / total) * 100).toFixed(1) : 0;

    return res.json({
      success: true,
      data: {
        kpis: {
          total, // all candidates in pipeline
          placed, // in terminal stages
          active, // disposition = ACTIVE
          dropped, // rejected or withdrawn
          inProgress: inProgressCount, // working through pipeline
          fillRate, // placed / total %
          nearTerminalCount,
          nearTerminalPipelineValue: Math.round(nearTerminalPipelineValue),
          avgPipelineDays, // mean days a candidate spends in the system
          // Sale value
          totalSaleValue,
          totalAchievedValue,
          achievedPct:
            totalSaleValue > 0
              ? +((totalAchievedValue / totalSaleValue) * 100).toFixed(1)
              : 0,
          saleValueIncluded,
          saleValueOmitted,
        },
        // Stage funnel — pipeline stages only (not terminal)
        funnelStages,
        // Terminal/placed stage breakdown
        terminalBreakdown,
        // Real stage name details for UI (non-sourced pipeline + terminal)
        pipelineStageDetails: pipelineStages
          .filter((s) => !s.isSourced)
          .map((s) => ({
            stageId: s.id,
            label: s.label,
            code: s.code,
            order: s.order,
            isNearTerminal: s.isNearTerminal,
            serviceLineId: s.serviceLineId,
            serviceLineName: s.serviceLine?.name ?? null,
            count: pipelineStageCounts[s.id] ?? 0,
          }))
          .filter((s) => s.count > 0),
        terminalStageDetails: terminalStages
          .map((s) => ({
            stageId: s.id,
            label: s.label,
            code: s.code,
            order: s.order,
            serviceLineId: s.serviceLineId,
            serviceLineName: s.serviceLine?.name ?? null,
            count: terminalStageCounts[s.id] ?? 0,
          }))
          .filter((s) => s.count > 0),
        // Breakdowns
        byServiceLine,
        byBusinessUnit,
        byDepartment,
        // Charts
        timeSeries,
        timeGranularity: bucketByHour ? "hour" : "day",
        dispositionCounts,
        // Leaderboard
        leaderboard,
        // Team tree (immediate direct reports with their team stats)
        teamTree,
        // Sale value methodology breakdown
        saleValueBreakdown: byBasis,
      },
      meta: {
        window: windowLabel(q),
        scope: req.scopeFilter?.type ?? "ALL",
        multiLine: byServiceLine.length > 1,
        hasSaleValueData: saleValueIncluded > 0,
        hasTeamTree: teamTree.length > 0,
        hasNearTerminal: nearTerminalCount > 0,
      },
    });
  } catch (err) {
    console.error("getReportsOverview:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch overview" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/overview/filters
// Returns available filter options scoped to the current user
// ─────────────────────────────────────────────────────────────────────────────
// File: reportsController.ts
// Path: src/controllers/reports/reportsController.ts

// export const getOverviewFilters = async (req: Request, res: Response) => {
//   try {
//     const [serviceLines, businessUnits, departments, clients, clientSpocs] =
//       await Promise.all([
//         prisma.serviceLine.findMany({
//           where: { isActive: true },
//           select: { id: true, name: true },
//           orderBy: { name: "asc" },
//         }),
//         prisma.businessUnit.findMany({
//           where: { isActive: true },
//           select: { id: true, name: true },
//           orderBy: { name: "asc" },
//         }),
//         prisma.department.findMany({
//           where: { isActive: true },
//           select: { id: true, name: true },
//           orderBy: { name: "asc" },
//         }),
//         prisma.client.findMany({
//           where: { status: "ACTIVE", deletedAt: null },
//           select: { id: true, name: true },
//           orderBy: { name: "asc" },
//         }),
//         prisma.clientSpoc.findMany({
//           where: { isActive: true },
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             designation: true,
//             client: {
//               select: { id: true, name: true },
//             },
//           },
//           orderBy: [{ client: { name: "asc" } }, { firstName: "asc" }],
//         }),
//       ]);

//     // Normalise spoc shape → { id, name, clientId, clientName, designation }
//     const spocs = clientSpocs.map((s) => ({
//       id: s.id,
//       name: `${s.firstName} ${s.lastName}`.trim(),
//       designation: s.designation ?? null,
//       clientId: s.client.id,
//       clientName: s.client.name,
//     }));

//     return res.json({
//       success: true,
//       data: { serviceLines, businessUnits, departments, clients, spocs },
//     });
//   } catch (err) {
//     console.error("getOverviewFilters:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch filter options" });
//   }
// };
// File: reportsController.ts
// Path: src/controllers/reports/reportsController.ts

export const getOverviewFilters = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    if (isSuperAdmin) {
      const [serviceLines, businessUnits, departments, clients, clientSpocs] =
        await Promise.all([
          prisma.serviceLine.findMany({
            // where: { isActive: true },
            select: { id: true, name: true, isActive: true },
            orderBy: { name: "asc" },
          }),
          prisma.businessUnit.findMany({
            // where: { isActive: true },
            select: { id: true, name: true, isActive: true },
            orderBy: { name: "asc" },
          }),
          prisma.department.findMany({
            // where: { isActive: true },
            select: { id: true, name: true, isActive: true },
            orderBy: { name: "asc" },
          }),
          prisma.client.findMany({
            // where: { status: "ACTIVE", deletedAt: null },
            select: { id: true, name: true, status: true },
            orderBy: { name: "asc" },
          }),
          prisma.clientSpoc.findMany({
            // where: { isActive: true },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              designation: true,
              isActive: true,
              client: { select: { id: true, name: true } },
            },
            orderBy: [{ client: { name: "asc" } }, { firstName: "asc" }],
          }),
        ]);

      const spocs = clientSpocs.map((s) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        designation: s.designation ?? null,
        clientId: s.client.id,
        clientName: s.client.name,
        isActive: s.isActive ?? true,
      }));

      return res.json({
        success: true,
        data: { serviceLines, businessUnits, departments, clients, spocs },
      });
    }

    // Non-superadmin — mirror exactly what getMyClients does
    const myClients = await prisma.client.findMany({
      where: {
        deletedAt: null,
        // status: "ACTIVE",
        spocs: { some: { handlerId: userId } },
      },
      select: {
        id: true,
        name: true,
        status: true,
        businessUnit: { select: { id: true, name: true } },
        spocs: {
          where: { handlerId: userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            serviceLine: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const clientMap = new Map<
      string,
      { id: string; name: string; status: string }
    >();
    const buMap = new Map<string, { id: string; name: string }>();
    const slMap = new Map<string, { id: string; name: string }>();
    const spocs: {
      id: string;
      name: string;
      designation: string | null;
      clientId: string;
      clientName: string;
      isActive: boolean;
    }[] = [];

    for (const c of myClients) {
      clientMap.set(c.id, { id: c.id, name: c.name, status: c.status });

      if (c.businessUnit) {
        buMap.set(c.businessUnit.id, {
          id: c.businessUnit.id,
          name: c.businessUnit.name,
        });
      }

      for (const s of c.spocs) {
        slMap.set(s.serviceLine.id, {
          id: s.serviceLine.id,
          name: s.serviceLine.name,
        });

        spocs.push({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          designation: s.designation ?? null,
          clientId: c.id,
          clientName: c.name,
          isActive: true,
        });
      }
    }

    const departments = await prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return res.json({
      success: true,
      data: {
        serviceLines: [...slMap.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        businessUnits: [...buMap.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        departments,
        clients: [...clientMap.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        spocs,
      },
    });
  } catch (err) {
    console.error("getOverviewFilters:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch filter options" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY OVERVIEW SHAPE  (returned when no data matches filters)
// ─────────────────────────────────────────────────────────────────────────────

function buildEmptyOverview() {
  return {
    kpis: {
      total: 0,
      placed: 0,
      active: 0,
      dropped: 0,
      inProgress: 0,
      fillRate: 0,
      avgPipelineDays: 0,
      totalSaleValue: 0,
      totalAchievedValue: 0,
      achievedPct: 0,
      saleValueIncluded: 0,
      saleValueOmitted: 0,
    },
    funnelStages: [],
    terminalBreakdown: [],
    byServiceLine: [],
    byBusinessUnit: [],
    byDepartment: [],
    timeSeries: [],
    timeGranularity: "day",
    dispositionCounts: {},
    leaderboard: [],
    teamTree: [],
    saleValueBreakdown: {
      SALE_VALUE: { count: 0, total: 0 },
      BAND: { count: 0, total: 0 },
      FIXED_PCT: { count: 0, total: 0 },
      NOT_FOUND: { count: 0, total: 0 },
    },
  };
}
