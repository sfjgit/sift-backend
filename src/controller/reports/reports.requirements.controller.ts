// File: reports.requirements.controller.ts
// Path: src/controllers/reports.requirements.controller.ts
//
// This is the REPORTS tab controller — handles GET /reports/requirements.
// Completely separate from requirementsController.ts (which handles GET /requirements).
//
// Key difference: this controller:
//  - Groups results by service line (for the LineTabs UI)
//  - Computes computedSaleValue + saleValueBasis per row (via imported computeSaleValue)
//  - Returns saleValueSummary at the top level (for RequirementStatsBar)
//  - Does NOT paginate — bounded by date window
//  - Scopes by org tree BFS (resolveOrgTreeDown) + optional createdById filter

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { resolveOrgTreeDown } from "./reports.controller";
import { computeSaleValue } from "../requirementsController";
// import { computeSaleValue } from "@/controllers/requirementsController";
// import { resolveOrgTreeDown } from "@/services/orgTreeService";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW — same pattern as overview controller
// ─────────────────────────────────────────────────────────────────────────────

function resolveDateWindow(q: Record<string, string | string[] | undefined>): {
  gte?: Date;
  lte?: Date;
} {
  const now = new Date();
  const hours = str(q.hours);
  const fromDate = str(q.fromDate);
  const toDate = str(q.toDate);
  const range = str(q.range);
  if (hours) {
    const h = parseInt(hours, 10);
    return { gte: new Date(now.getTime() - h * 3600000) };
  }
  if (fromDate || toDate) {
    return {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate
        ? { lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }
  if (range) {
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
  }
  return {};
}

function windowLabel(q: Record<string, string | string[] | undefined>): string {
  const hours = str(q.hours);
  const fromDate = str(q.fromDate);
  const toDate = str(q.toDate);
  const range = str(q.range);
  if (hours) return `Last ${hours}h`;
  if (fromDate || toDate) return `${fromDate || "start"} → ${toDate || "now"}`;
  if (range) {
    const map: Record<string, string> = {
      today: "Today",
      yesterday: "Yesterday",
      last7: "Last 7 days",
      last30: "Last 30 days",
      thisMonth: "This month",
    };
    return map[range] ?? range;
  }
  return "All time";
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE REQ WHERE — shared filter builder (no date window — handled separately)
// ─────────────────────────────────────────────────────────────────────────────

// function buildReqWhere(q: Record<string, string>): Record<string, any> {
//   const where: Record<string, any> = { deletedAt: null };
//   if (q.status) where.status = q.status;
//   if (q.clientId) where.clientId = q.clientId;
//   if (q.serviceLineId) where.serviceLineId = q.serviceLineId;
//   if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
//   if (q.clientSpocId) where.clientSpocId = q.clientSpocId; // ← add this
//   return where;
// }

//new functions
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
  if (q.status) where.status = prismaIn(q.status);
  if (q.clientId) where.clientId = prismaIn(q.clientId);
  if (q.serviceLineId) where.serviceLineId = prismaIn(q.serviceLineId);
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId; // single only
  if (q.clientSpocId) where.clientSpocId = prismaIn(q.clientSpocId);
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE FETCH — scoped by service line
// ─────────────────────────────────────────────────────────────────────────────

async function fetchScopedStages(serviceLineId?: string | string[]) {
  const slArr = serviceLineId
    ? Array.isArray(serviceLineId)
      ? serviceLineId
      : [serviceLineId]
    : null;
  return prisma.pipelineStage.findMany({
    where: {
      isActive: true,
      ...(slArr?.length
        ? { OR: [{ serviceLineId: null }, { serviceLineId: { in: slArr } }] }
        : {}),
    },
    select: {
      id: true,
      label: true,
      order: true,
      isStandard: true,
      isTerminal: true,
      isNearTerminal: true,
      serviceLineId: true,
      serviceLine: { select: { id: true, name: true } },
    },
    orderBy: { order: "asc" },
  });
}

type FetchedStage = Awaited<ReturnType<typeof fetchScopedStages>>[number];

function stageMetaOut(stages: FetchedStage[], standardOnly: boolean) {
  return (standardOnly ? stages.filter((s) => s.isStandard) : stages).map(
    (s) => ({
      id: s.id,
      label: s.label,
      order: s.order,
      isStandard: s.isStandard,
      isTerminal: s.isTerminal,
      isNearTerminal: s.isNearTerminal,
      serviceLineId: s.serviceLineId,
      serviceLine: s.serviceLine,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementReport
// GET /reports/requirements
//
// Response shape:
// {
//   success: true,
//   groups: [{
//     serviceLine: { id, name } | null,
//     stages: StageMeta[],
//     data: RequirementRow[],   ← each row has computedSaleValue, saleValueBasis etc.
//     total: number,
//   }],
//   saleValueSummary: {         ← used by RequirementStatsBar
//     totalSaleValue: number,
//     totalAchievedValue: number,
//     includedCount: number,
//     omittedCount: number,
//     byBasis: { SALE_VALUE, BAND, FIXED_PCT, NOT_FOUND }
//   },
//   meta: { window, standardOnly, total, multiLine }
// }
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const standardOnly = q.standardOnly === "true";

    // ── Scope: creator BFS tree ───────────────────────────────────────────────
    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin,
    );

    const requestedCreatorId = str(q.createdById)?.trim() || null;
    const effectiveCreatorIds =
      creatorIds === null
        ? requestedCreatorId
          ? [requestedCreatorId]
          : null
        : requestedCreatorId
          ? creatorIds.includes(requestedCreatorId)
            ? [requestedCreatorId]
            : []
          : creatorIds;

    // const createdByWhere =
    //   effectiveCreatorIds === null
    //     ? {}
    //     : { createdById: { in: effectiveCreatorIds } };

    // WITH this — also pull in requirements assigned to anyone in the org tree:
    let createdByWhere: Record<string, any> = {};

    if (effectiveCreatorIds !== null) {
      // Requirements assigned to anyone in the org tree
      const assignedReqRows = await prisma.requirementAssignment.findMany({
        where: {
          assignedToId: { in: effectiveCreatorIds },
          status: "ACTIVE",
        },
        select: { requirementId: true },
      });
      const assignedReqIds = [
        ...new Set(assignedReqRows.map((a) => a.requirementId)),
      ];

      // Union: created by org tree OR assigned to org tree
      createdByWhere = {
        OR: [
          { createdById: { in: effectiveCreatorIds } },
          ...(assignedReqIds.length > 0
            ? [{ id: { in: assignedReqIds } }]
            : []),
        ],
      };
    }

    // ── Date window — activity-based filter ──────────────────────────────────
    const win = resolveDateWindow(q);
    const activityWindow =
      win.gte || win.lte
        ? {
            ...(win.gte ? { gte: win.gte } : {}),
            ...(win.lte ? { lte: win.lte } : {}),
          }
        : null;

    const activityFilter = activityWindow
      ? {
          pipelines: {
            some: {
              OR: [
                { createdAt: activityWindow },
                { updatedAt: activityWindow },
                { stageHistory: { some: { createdAt: activityWindow } } },
              ],
            },
          },
        }
      : {};

    // ── Optional team filter (from TeamTreePicker) ────────────────────────────
    // userIds = comma-separated list from the tree picker
    // When present, scope to requirements created by OR assigned to those users
    let teamReqIdFilter: { id: { in: string[] } } | Record<string, never> = {};
    if (q.userIds) {
      const rawUserIds = str(q.userIds) ?? "";

      const teamIds = rawUserIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (teamIds.length > 0) {
        // Narrow: only IDs in both effectiveCreatorIds (RBAC) and teamIds
        const allowed =
          effectiveCreatorIds === null
            ? teamIds
            : teamIds.filter((id) => effectiveCreatorIds.includes(id));

        if (allowed.length > 0) {
          const [assignedRows, createdRows] = await Promise.all([
            prisma.requirementAssignment.findMany({
              where: { assignedToId: { in: allowed }, status: "ACTIVE" },
              select: { requirementId: true },
            }),
            prisma.requirement.findMany({
              where: { createdById: { in: allowed }, deletedAt: null },
              select: { id: true },
            }),
          ]);
          const uniqueIds = new Set([
            ...assignedRows.map((a) => a.requirementId),
            ...createdRows.map((r) => r.id),
          ]);
          teamReqIdFilter = { id: { in: [...uniqueIds] } };
        } else {
          // Team filter completely outside RBAC scope → return empty
          teamReqIdFilter = { id: { in: [] } };
        }
      }
    }

    const reqWhere = {
      ...buildReqWhere(q),
      ...activityFilter,
      ...createdByWhere,
      ...teamReqIdFilter,
    };

    // ── Stages ────────────────────────────────────────────────────────────────
    const stages = await fetchScopedStages(
      Array.isArray(q.serviceLineId) ? q.serviceLineId : q.serviceLineId,
    );
    const stageIdSet = new Set(stages.map((s) => s.id));
    const terminalStageIds = stages
      .filter((s) => s.isTerminal)
      .map((s) => s.id);

    // ── Requirements — full select including sale value fields ─────────────────
    const requirements = await prisma.requirement.findMany({
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
        deletedAt: true,
        // Sale value fields
        saleValue: true,
        salaryMin: true,
        salaryMax: true,
        client: {
          select: { id: true, name: true, percentageValue: true },
        },
        clientSpoc: {
          select: { id: true, firstName: true, lastName: true },
        },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        band: {
          select: { id: true, code: true, name: true, value: true },
        },
        _count: { select: { pipelines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    // ── Empty response ────────────────────────────────────────────────────────
    const emptySummary = {
      totalSaleValue: 0,
      totalAchievedValue: 0,
      includedCount: 0,
      omittedCount: 0,
      byBasis: {
        SALE_VALUE: { count: 0, total: 0 },
        BAND: { count: 0, total: 0 },
        FIXED_PCT: { count: 0, total: 0 },
        NOT_FOUND: { count: 0, total: 0 },
      },
    };

    if (!requirements.length)
      return res.json({
        success: true,
        groups: [],
        saleValueSummary: emptySummary,
        meta: {
          window: windowLabel(q),
          standardOnly,
          total: 0,
          multiLine: false,
        },
      });

    const reqIds = requirements.map((r) => r.id);

    // ── Stage counts — single groupBy across all stages ───────────────────────
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!stageIdSet.has(sc.currentStageId)) continue;
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] =
        (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
    }

    // ── Accumulate sale value summary ─────────────────────────────────────────
    const byBasis: Record<string, { count: number; total: number }> = {
      SALE_VALUE: { count: 0, total: 0 },
      BAND: { count: 0, total: 0 },
      FIXED_PCT: { count: 0, total: 0 },
      NOT_FOUND: { count: 0, total: 0 },
    };
    let totalSaleValue = 0;
    let totalAchievedValue = 0;
    let omittedCount = 0;
    const now = Date.now(); // ← add once before .map(), or inside if you prefer

    // ── Build enriched rows ───────────────────────────────────────────────────
    const rows = requirements.map((r) => {
      const counts = countsByReq[r.id] ?? {};
      const totalCandidates = Object.values(counts).reduce((s, n) => s + n, 0);

      const aging = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86_400_000,
      ); // ← add

      // Sale value
      const { computedSaleValue, saleValueBasis } = computeSaleValue({
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

      // Terminal count (candidates in any terminal stage for this req)
      const terminalCount = terminalStageIds.reduce(
        (sum, sid) => sum + (counts[sid] ?? 0),
        0,
      );

      // Achieved value
      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (terminalCount / r.totalOpenings) * computedSaleValue
          : null;

      const achievedPct =
        r.totalOpenings > 0
          ? Math.min(
              100,
              Math.round((terminalCount / r.totalOpenings) * 1000) / 10,
            )
          : 0;

      // Accumulate for summary
      if (computedSaleValue != null) {
        totalSaleValue += computedSaleValue;
        byBasis[saleValueBasis].count++;
        byBasis[saleValueBasis].total += computedSaleValue;
        if (achievedValue != null) totalAchievedValue += achievedValue;
      } else {
        omittedCount++;
        byBasis["NOT_FOUND"].count++;
      }

      return {
        // Core fields
        id: r.id,
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        priority: r.priority,
        jobType: r.jobType,
        remoteType: r.remoteType,
        totalOpenings: r.totalOpenings,
        city: r.city,
        country: r.country,
        respondBy: r.respondBy,
        isRespondByBreached: r.isRespondByBreached,
        isTurnaroundBreached: r.isTurnaroundBreached,
        createdAt: r.createdAt,
        deletedAt: r.deletedAt,
        aging,

        // Salary (normalised from Decimal)
        salaryMin: r.salaryMin != null ? Number(r.salaryMin) : null,
        salaryMax: r.salaryMax != null ? Number(r.salaryMax) : null,
        saleValue: r.saleValue != null ? Number(r.saleValue) : null,

        // Sale value enrichment
        computedSaleValue,
        saleValueBasis:
          computedSaleValue != null ? saleValueBasis : "NOT_FOUND",
        bandCode: r.band?.code ?? null,
        bandName: r.band?.name ?? null,
        bandValue: r.band?.value != null ? Number(r.band.value) : null,
        clientPct:
          r.client?.percentageValue != null
            ? Number(r.client.percentageValue)
            : null,

        // Pipeline stats
        totalCandidates,
        stageCounts: counts,
        terminalCount,
        achievedValue,
        achievedPct,

        // Relations (strip sensitive client fields)
        client: r.client ? { id: r.client.id, name: r.client.name } : null,
        clientSpoc: r.clientSpoc,
        businessUnit: r.businessUnit,
        serviceLine: r.serviceLine,
        createdBy: r.createdBy,
      };
    });

    // ── Group by service line ─────────────────────────────────────────────────
    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId,
      );

    const byLine = new Map<string, any[]>();
    const lineMeta = new Map<string, { id: string; name: string } | null>();
    for (const r of rows) {
      const sl = r.serviceLine ?? null;
      const key = sl?.id ?? "__none__";
      if (!byLine.has(key)) {
        byLine.set(key, []);
        lineMeta.set(key, sl);
      }
      byLine.get(key)!.push(r);
    }

    const groups = [...byLine.entries()]
      .map(([key, rws]) => {
        const sl = lineMeta.get(key) ?? null;
        return {
          serviceLine: sl,
          stages: stageMetaOut(stagesForLine(sl?.id ?? null), standardOnly),
          data: rws,
          total: rws.length,
        };
      })
      .sort((a, b) => b.data.length - a.data.length);

    return res.json({
      success: true,
      groups,
      saleValueSummary: {
        totalSaleValue,
        totalAchievedValue,
        includedCount: requirements.length - omittedCount,
        omittedCount,
        byBasis,
      },
      meta: {
        window: windowLabel(q),
        standardOnly,
        total: requirements.length,
        multiLine: groups.length > 1,
      },
    });
  } catch (err) {
    console.error("getRequirementReport:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement report" });
  }
};
