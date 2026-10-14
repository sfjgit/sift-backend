// File: reports.requirements.controller.ts
// Path: src/controller/reports/reports.requirements.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import {
  Q,
  str,
  toArr,
  computeSaleValue,
  emptyByBasis,
  shareOf,
  pctOf,
  windowLabel,
  fetchScopedStages,
  fetchStageFlagMap,
  classifyStageCounts,
  stageMetaOut,
  resolveRequirementScope,
  buildRequirementWhere,
  buildActivityPipelineWhere,
  monthKey,
  monthLabel,
} from "./reports.requirements.shared";

// Backward compat for anything that imported it from here
export { computeSaleValue } from "./reports.requirements.shared";

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementReport
// GET /reports/requirements
//
// Filters (all multi-value: repeated keys or comma list):
//   status, priority, jobType, remoteType, clientId, clientSpocId,
//   serviceLineId, businessUnitId
//   createdById   — requirement creator (any user, scope still enforced)
//   assignedToId  — active assignee
//   assignedById  — who assigned it
//   recruiterId   — candidate owner (narrows candidate counts)
//   userIds       — team picker (narrows reqs + candidates)
//   createdRange | createdFrom/createdTo   — which requirements are listed
//   activityRange | activityFrom/activityTo — which candidates are counted
//   standardOnly, sortBy, sortDir
// ─────────────────────────────────────────────────────────────────────────────

const COMPUTED_SORT_KEYS = new Set([
  "computedSaleValue",
  "achievedValue",
  "bandValue",
  "nearTerminalValue",
]);

export const getRequirementReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const standardOnly = str(q.standardOnly) === "true";

    // ── Scope + where (shared with export) ───────────────────────────────
    const scope = await resolveRequirementScope(req, q);
    const reqWhere = await buildRequirementWhere(q, scope);

    // ── Sort ─────────────────────────────────────────────────────────────
    const rawSortBy = str(q.sortBy) ?? null;
    const rawSortDir: "asc" | "desc" =
      str(q.sortDir) === "asc" ? "asc" : "desc";
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

    // ── Stages + requirements ────────────────────────────────────────────
    const [stages, stageById, requirements] = await Promise.all([
      fetchScopedStages(toArr(q.serviceLineId)),
      fetchStageFlagMap(),
      prisma.requirement.findMany({
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
          perOpeningValue: true,
          saleValueBasis: true,
          salaryMin: true,
          salaryMax: true,
          client: { select: { id: true, name: true, percentageValue: true } },
          clientSpoc: { select: { id: true, firstName: true, lastName: true } },
          businessUnit: { select: { id: true, name: true } },
          serviceLine: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          band: { select: { id: true, code: true, name: true, value: true } },
          _count: { select: { pipelines: true } },
        },
        orderBy,
        take: 1_000,
      }),
    ]);

    if (!requirements.length)
      return res.json({
        success: true,
        groups: [],
        saleValueSummary: {
          totalSaleValue: 0,
          totalAchievedValue: 0,
          totalNearTerminalValue: 0,
          includedCount: 0,
          omittedCount: 0,
          byBasis: emptyByBasis(),
        },
        meta: {
          window: windowLabel(q),
          standardOnly,
          total: 0,
          multiLine: false,
        },
      });

    const reqIds = requirements.map((r) => r.id);

    // ── Stage counts — scoped to candidate owners ────────────────────────
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: {
        requirementId: { in: reqIds },
        ...scope.pipelineOwnerWhere,
        ...buildActivityPipelineWhere(q), // activity date → counts only
      },
      _count: { id: true },
    });

    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      const bucket = (countsByReq[sc.requirementId] ??= {});
      bucket[sc.currentStageId] =
        (bucket[sc.currentStageId] ?? 0) + sc._count.id;
    }

    // ── Rows + summary ───────────────────────────────────────────────────
    const byBasis = emptyByBasis();
    let totalSaleValue = 0;
    let totalAchievedValue = 0;
    let totalNearTerminalValue = 0;
    let omittedCount = 0;
    const now = Date.now();

    const rows = requirements.map((r) => {
      const stageCts = countsByReq[r.id] ?? {};
      const {
        total: totalCandidates,
        terminal: terminalCount,
        nearTerminal: nearTerminalCount,
      } = classifyStageCounts(stageCts, stageById);

      const aging = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86_400_000
      );

      const { value: computedSaleValue, basis: saleValueBasis } =
        computeSaleValue(r);

      const achievedValue = shareOf(
        terminalCount,
        r.totalOpenings,
        computedSaleValue
      );
      const nearTerminalValue = shareOf(
        nearTerminalCount,
        r.totalOpenings,
        computedSaleValue
      );

      if (computedSaleValue != null) {
        totalSaleValue += computedSaleValue;
        byBasis[saleValueBasis].count++;
        byBasis[saleValueBasis].total += computedSaleValue;
        totalAchievedValue += achievedValue ?? 0;
        totalNearTerminalValue += nearTerminalValue ?? 0;
      } else {
        omittedCount++;
        byBasis.NOT_FOUND.count++;
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
        createdMonth: monthKey(r.createdAt), // YYYY-MM (server timezone)
        createdMonthLabel: monthLabel(monthKey(r.createdAt)), // Jul 2026
        deletedAt: r.deletedAt,
        aging,

        salaryMin: r.salaryMin != null ? Number(r.salaryMin) : null,
        salaryMax: r.salaryMax != null ? Number(r.salaryMax) : null,
        saleValue: r.saleValue != null ? Number(r.saleValue) : null,

        computedSaleValue,
        saleValueBasis,
        bandCode: r.band?.code ?? null,
        bandName: r.band?.name ?? null,
        bandValue: r.band?.value != null ? Number(r.band.value) : null,
        clientPct:
          r.client?.percentageValue != null
            ? Number(r.client.percentageValue)
            : null,

        totalCandidates,
        stageCounts: stageCts,
        terminalCount,
        achievedValue,
        achievedPct: pctOf(terminalCount, r.totalOpenings),
        nearTerminalCount,
        nearTerminalValue,
        nearTerminalPct: pctOf(nearTerminalCount, r.totalOpenings),

        client: r.client ? { id: r.client.id, name: r.client.name } : null,
        clientSpoc: r.clientSpoc,
        businessUnit: r.businessUnit,
        serviceLine: r.serviceLine,
        createdBy: r.createdBy,
      };
    });

    // ── In-memory sort for computed fields ───────────────────────────────
    if (isComputedSort && rawSortBy) {
      const getVal = (r: (typeof rows)[number]): number => {
        const v = (r as Record<string, unknown>)[rawSortBy];
        return typeof v === "number" ? v : -Infinity;
      };
      rows.sort((a, b) => {
        const diff = getVal(a) - getVal(b);
        return rawSortDir === "asc" ? diff : -diff;
      });
    }

    // ── Group by service line ────────────────────────────────────────────
    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId
      );

    const byLine = new Map<string, typeof rows>();
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
