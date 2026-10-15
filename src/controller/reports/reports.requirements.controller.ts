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
  cappedShares,
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
  personName,
} from "./reports.requirements.shared";
import { Prisma } from "@prisma/client";
import { resolveJoining, JOINING_SOURCE_LABELS } from "./reports.joining";

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

      // Capped at openings — same rule as the Recruiters tab
      const { achievedValue, nearTerminalValue } = cappedShares(
        terminalCount,
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

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementCandidates
// GET /reports/requirements/candidates?type=all|pipeline|placed&bucket=…
//
// The candidates behind the count tiles. Same scope + filters as the table:
// requirement filters, created/activity dates, candidate ownership, and the
// summary-bar slice (bucket). Every row says who moved the candidate into the
// current stage and when — e.g. "Placed on 12 Oct by Priya".
// ─────────────────────────────────────────────────────────────────────────────

const CANDIDATE_TYPE_WHERE: Record<
  string,
  Prisma.RequirementCandidatePipelineWhereInput
> = {
  pipeline: { currentStage: { isNearTerminal: true, isTerminal: false } },
  placed: { currentStage: { isTerminal: true } },
};

const CANDIDATE_LIST_CAP = 1_000;

const CANDIDATE_LIST_SELECT = {
  id: true,
  requirementId: true,
  recruiterId: true,
  currentStageId: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  noticePeriodDays: true,
  lastWorkingDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  currentStage: {
    select: {
      label: true,
      isTerminal: true,
      isNearTerminal: true,
      isSourced: true,
      pipeline: true,
    },
  },
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
      resumeUrl: true,
    },
  },
  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      totalOpenings: true,
      client: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

export const getRequirementCandidates = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const type = str(q.type) ?? "all";
    const scope = await resolveRequirementScope(req, q);
    const reqWhere = await buildRequirementWhere(q, scope);
    const activityWhere = buildActivityPipelineWhere(q);

    // Same requirement set as the table (default order, same cap)
    const reqRows = await prisma.requirement.findMany({
      where: reqWhere,
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 1_000,
    });
    let reqIds = reqRows.map((r) => r.id);

    // Summary-bar slice — same rule the table uses on its rows
    const bucket = str(q.bucket);
    if (bucket && reqIds.length) {
      const [counts, stageById] = await Promise.all([
        prisma.requirementCandidatePipeline.groupBy({
          by: ["requirementId", "currentStageId"],
          where: {
            requirementId: { in: reqIds },
            ...scope.pipelineOwnerWhere,
            ...activityWhere,
          },
          _count: { id: true },
        }),
        fetchStageFlagMap(),
      ]);
      const byReq: Record<string, Record<string, number>> = {};
      for (const c of counts as any[])
        (byReq[c.requirementId] ??= {})[c.currentStageId] = c._count.id;
      reqIds = reqIds.filter((id) => {
        const { terminal, nearTerminal } = classifyStageCounts(
          byReq[id] ?? {},
          stageById
        );
        return bucket === "terminal"
          ? terminal > 0
          : bucket === "nearTerminal"
          ? nearTerminal > 0
          : true;
      });
    }

    const where: Prisma.RequirementCandidatePipelineWhereInput = {
      requirementId: { in: reqIds },
      ...scope.pipelineOwnerWhere,
      ...activityWhere,
      ...(CANDIDATE_TYPE_WHERE[type] ?? {}),
    };

    const [total, pipes] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: CANDIDATE_LIST_SELECT,
        orderBy: { stageUpdatedAt: "desc" },
        take: CANDIDATE_LIST_CAP,
      }),
    ]);

    const now = new Date();
    const rows = pipes.map((p) => {
      // Real move INTO the current stage (skip same-stage logs: transfers, notes)
      const move = p.stageHistory.find(
        (l) => l.toStageId === p.currentStageId && l.fromStageId !== l.toStageId
      );
      const pipelineMins =
        p.stageHistory.reduce((s, l) => s + (l.timeInPrevStageMins ?? 0), 0) +
        Math.max(
          0,
          Math.floor(
            (now.getTime() - new Date(p.stageUpdatedAt).getTime()) / 60_000
          )
        );
      const j = resolveJoining(p, now);
      return {
        pipelineId: p.id,
        addedOn: p.createdAt,
        pipelineDays: Math.floor(pipelineMins / 1440),

        stageId: p.currentStageId,
        stageLabel: p.currentStage?.label ?? "—",
        isTerminal: p.currentStage?.isTerminal ?? false,
        isNearTerminal: p.currentStage?.isNearTerminal ?? false,
        isDropped: p.currentStage?.pipeline === false, // stage flags = source of truth
        isOnHold: p.isOnHold,
        stageReachedAt: move?.createdAt ?? p.stageUpdatedAt,
        stageMovedBy: move?.changedBy ? personName(move.changedBy) : null,

        submittedAt: p.submittedAt,
        offerStatus: p.offerStatus,
        offeredCtc: p.offeredCtc,
        currentCtc: p.currentCtc,
        expectedCtc: p.expectedCtc,

        noticeDays: j.noticeDays,
        lastWorkingDate: p.lastWorkingDate,
        joiningDate: j.date,
        joiningSource: j.source,
        joiningSourceLabel: j.source ? JOINING_SOURCE_LABELS[j.source] : null,
        monthOfJoining: j.mojLabel,
        daysToJoin: j.daysToJoin,

        candidateName: p.snapshot?.fullName ?? "—",
        candidateEmail: p.snapshot?.email ?? "",
        candidatePhone: p.snapshot?.phone ?? "",
        currentTitle: p.snapshot?.currentTitle ?? "",
        currentCompany: p.snapshot?.currentCompany ?? "",
        expYears: p.snapshot?.totalExpYears ?? null,
        resumeUrl: p.snapshot?.resumeUrl ?? null,

        recruiterId: p.recruiterId,
        recruiterName: personName(p.recruiter),
        recruiterEmail: p.recruiter?.email ?? "",

        requirementId: p.requirementId,
        reqCode: p.requirement?.reqCode ?? "",
        reqTitle: p.requirement?.title ?? "",
        totalOpenings: p.requirement?.totalOpenings ?? 0,
        clientName: p.requirement?.client?.name ?? "",
        createdByName: p.requirement?.createdBy
          ? personName(p.requirement.createdBy)
          : null,
      };
    });

    return res.json({
      success: true,
      data: rows,
      meta: {
        total,
        capped: total > CANDIDATE_LIST_CAP,
        window: windowLabel(q),
      },
    });
  } catch (err) {
    console.error("getRequirementCandidates:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch requirement candidates",
      });
  }
};
