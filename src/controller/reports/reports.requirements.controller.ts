// File: reports.requirements.controller.ts
// Path: src/controller/reports/reports.requirements.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { resolveOrgTreeDown } from "./reports.controller";

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE — correct priority chain, no × openings on direct saleValue
// saleValue field = already the total for that req (entered by CSM as lump sum)
// band.value      = per-opening fee → × openings
// salaryMin × pct = per-opening fee → × openings
// ─────────────────────────────────────────────────────────────────────────────

type SaleValueBasis = "SALE_VALUE" | "BAND" | "FIXED_PCT" | "NOT_FOUND";

function computeSaleValue(r: {
  saleValue: number | null;
  totalOpenings: number;
  salaryMin: number | null;
  band: { value: any } | null;
  client: { percentageValue: any } | null;
}): { value: number | null; basis: SaleValueBasis } {
  // Direct — already a total, never multiply again
  if (r.saleValue != null && Number(r.saleValue) > 0) {
    return { value: Number(r.saleValue), basis: "SALE_VALUE" };
  }
  // Band — per-opening fee
  const bv = r.band?.value != null ? Number(r.band.value) : null;
  if (bv != null && bv > 0) {
    return { value: bv * r.totalOpenings, basis: "BAND" };
  }
  // Fixed % of salary — per-opening fee
  const pct =
    r.client?.percentageValue != null ? Number(r.client.percentageValue) : null;
  const sm = r.salaryMin != null ? Number(r.salaryMin) : null;
  if (pct != null && pct > 0 && sm != null && sm > 0) {
    return { value: sm * (pct / 100) * r.totalOpenings, basis: "FIXED_PCT" };
  }
  return { value: null, basis: "NOT_FOUND" };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW
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
    return { gte: new Date(now.getTime() - h * 3_600_000) };
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
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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
  q: Record<string, string | string[] | undefined>
): Record<string, any> {
  const where: Record<string, any> = { deletedAt: null };
  if (q.status) where.status = prismaIn(q.status);
  if (q.clientId) where.clientId = prismaIn(q.clientId);
  if (q.serviceLineId) where.serviceLineId = prismaIn(q.serviceLineId);
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
  if (q.clientSpocId) where.clientSpocId = prismaIn(q.clientSpocId);
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGES
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
      isSourced: true,
      pipeline: true,
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
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementReport
// GET /reports/requirements
//
// Per-row additions vs previous version:
//   nearTerminalCount  — candidates where isNearTerminal = true (pipeline column)
//   nearTerminalValue  — (nearTerminalCount / totalOpenings) × computedSaleValue
//   terminalCount      — now flag-based via stageById (not stageIdSet filter bug)
//   achievedValue      — (terminalCount / totalOpenings) × computedSaleValue
//   computedSaleValue  — FIXED: saleValue no longer multiplied by openings
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const standardOnly = q.standardOnly === "true";

    // ── Scope ──────────────────────────────────────────────────────────────
    const creatorIds = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin
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

    let createdByWhere: Record<string, any> = {};
    if (effectiveCreatorIds !== null) {
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
      createdByWhere = {
        OR: [
          { createdById: { in: effectiveCreatorIds } },
          ...(assignedReqIds.length > 0
            ? [{ id: { in: assignedReqIds } }]
            : []),
        ],
      };
    }

    // ── Date window ────────────────────────────────────────────────────────
    const win = resolveDateWindow(q);
    const dateFilterMode = str(q.dateFilterMode) ?? "activity";

    let activityFilter: Record<string, any> = {};
    let createdAtFilter: Record<string, any> = {};

    if (win.gte || win.lte) {
      const window = {
        ...(win.gte ? { gte: win.gte } : {}),
        ...(win.lte ? { lte: win.lte } : {}),
      };
      if (dateFilterMode === "createdAt") {
        createdAtFilter = { createdAt: window };
      } else {
        activityFilter = {
          pipelines: {
            some: {
              OR: [
                { createdAt: window },
                { updatedAt: window },
                { stageHistory: { some: { createdAt: window } } },
              ],
            },
          },
        };
      }
    }

    // ── Team filter ────────────────────────────────────────────────────────
    let teamReqIdFilter: { id: { in: string[] } } | Record<string, never> = {};
    if (q.userIds) {
      const rawUserIds = str(q.userIds) ?? "";
      const teamIds = rawUserIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (teamIds.length > 0) {
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
          teamReqIdFilter = { id: { in: [] } };
        }
      }
    }

    // ── Sort ───────────────────────────────────────────────────────────────
    const rawSortBy = str(q.sortBy) ?? null;
    const rawSortDir = str(q.sortDir) === "asc" ? "asc" : "desc";

    const COMPUTED_SORT_KEYS = new Set([
      "computedSaleValue",
      "achievedValue",
      "bandValue",
      "nearTerminalValue",
    ]);
    const isComputedSort =
      rawSortBy != null && COMPUTED_SORT_KEYS.has(rawSortBy);

    const DB_SORT_MAP: Record<string, object> = {
      aging: { createdAt: rawSortDir === "asc" ? "desc" : "asc" },
      openings: { totalOpenings: rawSortDir },
      salaryMin: { salaryMin: rawSortDir },
      salaryMax: { salaryMax: rawSortDir },
      totalCandidates: { pipelines: { _count: rawSortDir } },
      createdAt: { createdAt: rawSortDir },
    };

    const orderBy: object =
      rawSortBy && !isComputedSort && DB_SORT_MAP[rawSortBy]
        ? DB_SORT_MAP[rawSortBy]
        : { createdAt: "desc" };

    const reqWhere = {
      ...buildReqWhere(q),
      ...activityFilter,
      ...createdAtFilter,
      ...createdByWhere,
      ...teamReqIdFilter,
    };
    // ── Stages — fetch ALL flags, not just scoped ──────────────────────────
    // We need isTerminal / isNearTerminal flags for every stage that appears
    // in pipeline rows, regardless of serviceLineId filter.
    // Scoped stages are still used for column display; full stage map for counts.
    const [stages, allStagesForFlags] = await Promise.all([
      fetchScopedStages(
        Array.isArray(q.serviceLineId) ? q.serviceLineId : q.serviceLineId
      ),
      prisma.pipelineStage.findMany({
        where: { isActive: true },
        select: {
          id: true,
          isTerminal: true,
          isNearTerminal: true,
          isSourced: true,
          pipeline: true,
        },
      }),
    ]);

    // stageById — flag lookup for count classification
    const stageById = new Map(allStagesForFlags.map((s) => [s.id, s]));

    // ── Requirements ───────────────────────────────────────────────────────
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
      orderBy,
      take: 1_000,
    });

    const emptySummary = {
      totalSaleValue: 0,
      totalAchievedValue: 0,
      totalNearTerminalValue: 0,
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

    // ── Stage counts — one groupBy, all reqs ───────────────────────────────
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    // Build: reqId → stageId → count (all stages, no filter)
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] =
        (countsByReq[sc.requirementId][sc.currentStageId] ?? 0) + sc._count.id;
    }

    // ── Summary accumulators ───────────────────────────────────────────────
    const byBasis: Record<string, { count: number; total: number }> = {
      SALE_VALUE: { count: 0, total: 0 },
      BAND: { count: 0, total: 0 },
      FIXED_PCT: { count: 0, total: 0 },
      NOT_FOUND: { count: 0, total: 0 },
    };
    let totalSaleValue = 0;
    let totalAchievedValue = 0;
    let totalNearTerminalValue = 0;
    let omittedCount = 0;
    const now = Date.now();

    // ── Build rows ─────────────────────────────────────────────────────────
    const rows = requirements.map((r) => {
      const stageCts = countsByReq[r.id] ?? {};

      // Flag-based counts — same loop as sales controller
      let terminalCount = 0;
      let nearTerminalCount = 0;
      let totalCandidates = 0;

      for (const [stageId, count] of Object.entries(stageCts)) {
        const stage = stageById.get(stageId);
        totalCandidates += count;
        if (!stage) continue;
        if (stage.isTerminal) terminalCount += count;
        else if (stage.isNearTerminal) nearTerminalCount += count;
        // sourced / dropped / active — not needed for display, counted in total
      }

      const aging = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86_400_000
      );

      // Sale value — correct computation
      const { value: computedSaleValue, basis: saleValueBasis } =
        computeSaleValue({
          saleValue: r.saleValue != null ? Number(r.saleValue) : null,
          totalOpenings: r.totalOpenings,
          salaryMin: r.salaryMin != null ? Number(r.salaryMin) : null,
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

      // Achieved — terminals / openings × sale value
      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (terminalCount / r.totalOpenings) * computedSaleValue
          : null;

      const achievedPct =
        r.totalOpenings > 0
          ? Math.min(
              100,
              Math.round((terminalCount / r.totalOpenings) * 1_000) / 10
            )
          : 0;

      // Pipeline (near terminal) — nearTerminals / openings × sale value
      const nearTerminalValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (nearTerminalCount / r.totalOpenings) * computedSaleValue
          : null;

      const nearTerminalPct =
        r.totalOpenings > 0
          ? Math.min(
              100,
              Math.round((nearTerminalCount / r.totalOpenings) * 1_000) / 10
            )
          : 0;

      // Accumulate summary
      if (computedSaleValue != null) {
        totalSaleValue += computedSaleValue;
        byBasis[saleValueBasis].count++;
        byBasis[saleValueBasis].total += computedSaleValue;
        if (achievedValue != null) totalAchievedValue += achievedValue;
        if (nearTerminalValue != null)
          totalNearTerminalValue += nearTerminalValue;
      } else {
        omittedCount++;
        byBasis["NOT_FOUND"].count++;
      }

      return {
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

        salaryMin: r.salaryMin != null ? Number(r.salaryMin) : null,
        salaryMax: r.salaryMax != null ? Number(r.salaryMax) : null,
        saleValue: r.saleValue != null ? Number(r.saleValue) : null,

        // Sale value enrichment — FIXED
        computedSaleValue,
        saleValueBasis,
        bandCode: r.band?.code ?? null,
        bandName: r.band?.name ?? null,
        bandValue: r.band?.value != null ? Number(r.band.value) : null,
        clientPct:
          r.client?.percentageValue != null
            ? Number(r.client.percentageValue)
            : null,

        // Pipeline stats — flag-based
        totalCandidates,
        stageCounts: stageCts, // stageId → count (for stage columns)
        terminalCount,
        achievedValue,
        achievedPct,
        nearTerminalCount, // "Pipeline" column count
        nearTerminalValue, // "Pipeline" column value
        nearTerminalPct,

        client: r.client ? { id: r.client.id, name: r.client.name } : null,
        clientSpoc: r.clientSpoc,
        businessUnit: r.businessUnit,
        serviceLine: r.serviceLine,
        createdBy: r.createdBy,
      };
    });

    // ── In-memory sort for computed fields ─────────────────────────────────
    if (isComputedSort && rawSortBy) {
      const getVal = (r: (typeof rows)[0]): number => {
        if (rawSortBy === "computedSaleValue")
          return r.computedSaleValue ?? -Infinity;
        if (rawSortBy === "achievedValue") return r.achievedValue ?? -Infinity;
        if (rawSortBy === "bandValue") return r.bandValue ?? -Infinity;
        if (rawSortBy === "nearTerminalValue")
          return r.nearTerminalValue ?? -Infinity;
        return 0;
      };
      rows.sort((a, b) => {
        const diff = getVal(a) - getVal(b);
        return rawSortDir === "asc" ? diff : -diff;
      });
    }

    // ── Group by service line ──────────────────────────────────────────────
    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId
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
        totalNearTerminalValue,
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
