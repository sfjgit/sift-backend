// File: dashboard.controller.ts
// Path: src/controller/dashboard.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { getRequirementScopeWhere } from "@/services/requirementService";
import { getVisibleRecruiterIds } from "@/utils/scopeUtils";

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseDateRange(from?: string, to?: string) {
  const dateFrom = from ? new Date(from) : undefined;
  // set to end-of-day so "to" is inclusive
  let dateTo: Date | undefined;
  if (to) {
    dateTo = new Date(to);
    dateTo.setHours(23, 59, 59, 999);
  }
  return { dateFrom, dateTo };
}

function buildCreatedAtFilter(dateFrom?: Date, dateTo?: Date) {
  if (!dateFrom && !dateTo) return {};
  return {
    createdAt: {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    },
  };
}

function buildStageUpdatedAtFilter(dateFrom?: Date, dateTo?: Date) {
  if (!dateFrom && !dateTo) return {};
  return {
    stageUpdatedAt: {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    },
  };
}

// ─── GET /dashboard/stats ─────────────────────────────────────────────────────
// Rewritten: accepts dateFrom/dateTo driving BOTH requirement counts and
// pipeline stage counts. Scope applied on both sides.

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const {
      buId,
      deptId,
      serviceLineId,
      clientId,
      dateFrom: rawFrom,
      dateTo: rawTo,
    } = req.query as Record<string, string>;

    const { dateFrom, dateTo } = parseDateRange(rawFrom, rawTo);

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const buFilter = buId
      ? { businessUnit: { ancestorIds: { has: buId } } }
      : {};
    const deptFilter = deptId ? { createdBy: { departmentId: deptId } } : {};
    const slFilter = serviceLineId ? { serviceLineId } : {};
    const clientFilter = clientId ? { clientId } : {};
    const dateFilter = buildCreatedAtFilter(dateFrom, dateTo);

    const baseWhere = {
      ...scopeWhere,
      deletedAt: null,
      ...buFilter,
      ...deptFilter,
      ...slFilter,
      ...clientFilter,
      ...dateFilter,
    };

    // pipeline rows scoped to visible recruiters
    const visibleRecruiterIds = await getVisibleRecruiterIds(
      userId,
      isSuperAdmin
    );

    const pipelineBaseWhere = {
      requirement: {
        ...scopeWhere,
        deletedAt: null,
        ...buFilter,
        ...slFilter,
        ...clientFilter,
      },
      ...(visibleRecruiterIds
        ? { recruiterId: { in: visibleRecruiterIds } }
        : {}),
      ...buildStageUpdatedAtFilter(dateFrom, dateTo),
    };

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [
      totalRequirements,
      active,
      pendingApproval,
      draft,
      onHold,
      closed,
      breached,
      thisWeek,
      highPriority,
      totalClients,
      totalCandidates,
      pipelineCounts,
      buBreakdownRaw,
      slBreakdownRaw,
    ] = await Promise.all([
      prisma.requirement.count({ where: baseWhere }),
      prisma.requirement.count({ where: { ...baseWhere, status: "ACTIVE" } }),
      prisma.requirement.count({
        where: { ...baseWhere, status: "PENDING_APPROVAL" },
      }),
      prisma.requirement.count({ where: { ...baseWhere, status: "DRAFT" } }),
      prisma.requirement.count({ where: { ...baseWhere, status: "ON_HOLD" } }),
      prisma.requirement.count({ where: { ...baseWhere, status: "CLOSED" } }),
      prisma.requirement.count({
        where: {
          ...baseWhere,
          status: { in: ["ACTIVE", "PENDING_APPROVAL", "DRAFT"] },
          OR: [{ isRespondByBreached: true }, { isTurnaroundBreached: true }],
        },
      }),
      prisma.requirement.count({
        where: { ...baseWhere, createdAt: { gte: oneWeekAgo } },
      }),
      prisma.requirement.count({
        where: { ...baseWhere, status: "ACTIVE", priority: "HIGH" },
      }),
      prisma.client.count({
        where: {
          deletedAt: null,
          ...(buId ? { businessUnit: { ancestorIds: { has: buId } } } : {}),
          ...(clientId ? { id: clientId } : {}),
        },
      }),

      // active pipeline — not rejected, not withdrawn, scoped + date filtered
      prisma.requirementCandidatePipeline.count({
        where: {
          ...pipelineBaseWhere,
          isRejected: false,
          isWithdrawn: false,
        },
      }),

      // pipeline stage breakdown — scoped + date filtered
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: pipelineBaseWhere,
        _count: { _all: true },
      }),

      prisma.requirement.groupBy({
        by: ["businessUnitId"],
        where: baseWhere,
        _count: { _all: true },
      }),

      prisma.requirement.groupBy({
        by: ["serviceLineId"],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    // resolve labels
    const stageIds = pipelineCounts
      .map((p) => p.currentStageId)
      .filter(Boolean) as string[];
    const buIds = buBreakdownRaw
      .map((b) => b.businessUnitId)
      .filter(Boolean) as string[];
    const slIds = slBreakdownRaw
      .map((s) => s.serviceLineId)
      .filter(Boolean) as string[];

    const [stagesData, busData, slsData] = await Promise.all([
      stageIds.length
        ? prisma.pipelineStage.findMany({
            where: { id: { in: stageIds } },
            select: {
              id: true,
              code: true,
              label: true,
              order: true,
              serviceLineId: true,
            },
          })
        : [],
      buIds.length
        ? prisma.businessUnit.findMany({
            where: { id: { in: buIds } },
            select: { id: true, name: true },
          })
        : [],
      slIds.length
        ? prisma.serviceLine.findMany({
            where: { id: { in: slIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const stageMap = new Map(
      (
        stagesData as {
          id: string;
          code: string;
          label: string;
          order: number;
          serviceLineId: string | null;
        }[]
      ).map((s) => [s.id, s])
    );
    const buMap = new Map(
      (busData as { id: string; name: string }[]).map((b) => [b.id, b.name])
    );
    const slMap = new Map(
      (slsData as { id: string; name: string }[]).map((s) => [s.id, s.name])
    );

    const pipeline = pipelineCounts
      .filter((p) => stageMap.has(p.currentStageId))
      .map((p) => {
        const stage = stageMap.get(p.currentStageId)!;
        return {
          stageId: p.currentStageId,
          code: stage.code,
          label: stage.label,
          order: stage.order,
          serviceLineId: stage.serviceLineId,
          count: p._count._all,
        };
      })
      .sort((a, b) => a.order - b.order);

    const buBreakdown = buBreakdownRaw
      .filter((b) => b.businessUnitId)
      .map((b) => ({
        id: b.businessUnitId!,
        name: buMap.get(b.businessUnitId!) ?? "Unknown",
        count: b._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const slBreakdown = slBreakdownRaw
      .filter((s) => s.serviceLineId)
      .map((s) => ({
        id: s.serviceLineId!,
        name: slMap.get(s.serviceLineId!) ?? "Unknown",
        count: s._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: {
        totalRequirements,
        active,
        pendingApproval,
        draft,
        onHold,
        closed,
        breached,
        thisWeek,
        highPriority,
        totalClients,
        totalCandidates,
        pipeline,
        buBreakdown,
        slBreakdown,
        // echo back applied filters so frontend can display them
        appliedFilters: {
          dateFrom: dateFrom?.toISOString() ?? null,
          dateTo: dateTo?.toISOString() ?? null,
          buId: buId ?? null,
          serviceLineId: serviceLineId ?? null,
          clientId: clientId ?? null,
        },
      },
    });
  } catch (err) {
    console.error("getDashboardStats:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

// ─── GET /dashboard/pipeline-overview ────────────────────────────────────────
// New endpoint. Returns every pipeline stage with:
//   - total count (scoped)
//   - active count (not rejected, not withdrawn, not on hold)
//   - inactive count (rejected + withdrawn + on hold)
//   - onHold count
//   - stageId for redirect → /requirements?stageId=x
// Accepts same filters as stats: buId, serviceLineId, clientId, dateFrom, dateTo

export const getPipelineOverview = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const {
      buId,
      serviceLineId,
      clientId,
      dateFrom: rawFrom,
      dateTo: rawTo,
    } = req.query as Record<string, string>;

    const { dateFrom, dateTo } = parseDateRange(rawFrom, rawTo);

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const visibleRecruiterIds = await getVisibleRecruiterIds(
      userId,
      isSuperAdmin
    );

    const requirementFilter = {
      ...scopeWhere,
      deletedAt: null,
      ...(buId ? { businessUnit: { ancestorIds: { has: buId } } } : {}),
      ...(serviceLineId ? { serviceLineId } : {}),
      ...(clientId ? { clientId } : {}),
    };

    const pipelineBaseWhere = {
      requirement: requirementFilter,
      ...(visibleRecruiterIds
        ? { recruiterId: { in: visibleRecruiterIds } }
        : {}),
      ...buildStageUpdatedAtFilter(dateFrom, dateTo),
    };

    // fetch all stage definitions first (for ordering + labels)
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        serviceLineId: true,
        isTerminal: true,
      },
      orderBy: { order: "asc" },
    });

    // single groupBy with all pipeline rows
    const [
      totalByStage,
      activeByStage,
      rejectedByStage,
      withdrawnByStage,
      onHoldByStage,
    ] = await Promise.all([
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: pipelineBaseWhere,
        _count: { _all: true },
      }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: {
          ...pipelineBaseWhere,
          isRejected: false,
          isWithdrawn: false,
          isOnHold: false,
        },
        _count: { _all: true },
      }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: { ...pipelineBaseWhere, isRejected: true },
        _count: { _all: true },
      }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: { ...pipelineBaseWhere, isWithdrawn: true },
        _count: { _all: true },
      }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: { ...pipelineBaseWhere, isOnHold: true },
        _count: { _all: true },
      }),
    ]);

    const toMap = (
      rows: { currentStageId: string; _count: { _all: number } }[]
    ) => new Map(rows.map((r) => [r.currentStageId, r._count._all]));

    const totalMap = toMap(totalByStage);
    const activeMap = toMap(activeByStage);
    const rejectedMap = toMap(rejectedByStage);
    const withdrawnMap = toMap(withdrawnByStage);
    const onHoldMap = toMap(onHoldByStage);

    const stages = allStages.map((stage) => ({
      stageId: stage.id,
      code: stage.code,
      label: stage.label,
      order: stage.order,
      serviceLineId: stage.serviceLineId,
      isTerminal: stage.isTerminal,
      total: totalMap.get(stage.id) ?? 0,
      active: activeMap.get(stage.id) ?? 0,
      rejected: rejectedMap.get(stage.id) ?? 0,
      withdrawn: withdrawnMap.get(stage.id) ?? 0,
      onHold: onHoldMap.get(stage.id) ?? 0,
      // inactive = rejected + withdrawn + on hold
      inactive:
        (rejectedMap.get(stage.id) ?? 0) +
        (withdrawnMap.get(stage.id) ?? 0) +
        (onHoldMap.get(stage.id) ?? 0),
    }));

    // top-level summary
    const summary = {
      totalCandidates: stages.reduce((s, st) => s + st.total, 0),
      activeCandidates: stages.reduce((s, st) => s + st.active, 0),
      inactiveCandidates: stages.reduce((s, st) => s + st.inactive, 0),
      onHold: stages.reduce((s, st) => s + st.onHold, 0),
    };

    res.json({
      success: true,
      data: {
        summary,
        stages,
        appliedFilters: {
          dateFrom: dateFrom?.toISOString() ?? null,
          dateTo: dateTo?.toISOString() ?? null,
          buId: buId ?? null,
          serviceLineId: serviceLineId ?? null,
          clientId: clientId ?? null,
        },
      },
    });
  } catch (err) {
    console.error("getPipelineOverview:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline overview" });
  }
};

// ─── GET /dashboard/my-assignments ───────────────────────────────────────────
// Unchanged logic, kept here for co-location.

export const getMyAssignments = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const assignments = await prisma.requirementAssignment.findMany({
      where: { assignedToId: userId, status: "ACTIVE" },
      orderBy: { assignedAt: "desc" },
      take: 20,
      select: {
        id: true,
        depth: true,
        status: true,
        allocatedOpenings: true,
        filledOpenings: true,
        submissionsCount: true,
        interviewsCount: true,
        deadline: true,
        deadlineMet: true,
        breachedAt: true,
        assignedAt: true,
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            // filledOpenings: true,
            // activeApplications: true,
            // location: true,
            jobType: true,
            remoteType: true,
            respondBy: true,
            isRespondByBreached: true,
            client: { select: { id: true, name: true } },
            serviceLine: { select: { id: true, name: true } },
          },
        },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        pipelines: {
          where: { isRejected: false, isWithdrawn: false },
          select: {
            id: true,
            isOnHold: true,
            stageUpdatedAt: true,
            currentStage: { select: { code: true, label: true, order: true } },
            snapshot: {
              select: {
                candidateServiceId: true,
                fullName: true,
                email: true,
                currentTitle: true,
                currentCompany: true,
                topSkills: true,
              },
            },
          },
          orderBy: { stageUpdatedAt: "desc" },
          take: 5,
        },
        childAssignments: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            depth: true,
            allocatedOpenings: true,
            filledOpenings: true,
            submissionsCount: true,
            deadline: true,
            assignedAt: true,
            assignedTo: {
              select: { id: true, firstName: true, lastName: true },
            },
            pipelines: {
              where: { isRejected: false, isWithdrawn: false },
              select: {
                id: true,
                isOnHold: true,
                stageUpdatedAt: true,
                currentStage: {
                  select: { code: true, label: true, order: true },
                },
                snapshot: {
                  select: {
                    candidateServiceId: true,
                    fullName: true,
                    currentTitle: true,
                    topSkills: true,
                  },
                },
              },
              orderBy: { stageUpdatedAt: "desc" },
              take: 5,
            },
          },
        },
      },
    });

    res.json({ success: true, data: assignments });
  } catch (err) {
    console.error("getMyAssignments:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignments" });
  }
};

// ─── GET /dashboard/activity ──────────────────────────────────────────────────

export const getDashboardActivity = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const {
      buId,
      serviceLineId,
      clientId,
      limit = "20",
      dateFrom: rawFrom,
      dateTo: rawTo,
    } = req.query as Record<string, string>;

    const { dateFrom, dateTo } = parseDateRange(rawFrom, rawTo);

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const activities = await prisma.requirementActivity.findMany({
      where: {
        requirement: {
          ...scopeWhere,
          deletedAt: null,
          ...(buId ? { businessUnit: { ancestorIds: { has: buId } } } : {}),
          ...(serviceLineId ? { serviceLineId } : {}),
          ...(clientId ? { clientId } : {}),
        },
        ...buildCreatedAtFilter(dateFrom, dateTo),
      },
      select: {
        id: true,
        type: true,
        summary: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
        requirement: { select: { id: true, reqCode: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(parseInt(limit), 100),
    });

    res.json({ success: true, data: activities });
  } catch (err) {
    console.error("getDashboardActivity:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch activity" });
  }
};
