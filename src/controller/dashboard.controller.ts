// controller/dashboard.controller.ts
import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { getRequirementScopeWhere } from "@/services/requirementService";

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const { buId, deptId, serviceLineId, clientId } = req.query as Record<
      string,
      string
    >;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const buFilter = buId
      ? { businessUnit: { ancestorIds: { has: buId } } }
      : {};
    const deptFilter = deptId ? { createdBy: { departmentId: deptId } } : {};
    const slFilter = serviceLineId ? { serviceLineId } : {};
    const clientFilter = clientId ? { clientId } : {};

    const baseWhere = {
      ...scopeWhere,
      deletedAt: null,
      ...buFilter,
      ...deptFilter,
      ...slFilter,
      ...clientFilter,
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
      // active candidates = pipeline rows not rejected/withdrawn
      totalCandidates,
      // pipeline stage breakdown via PipelineStage join
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

      // active pipeline rows — not rejected, not withdrawn
      prisma.requirementCandidatePipeline.count({
        where: {
          requirement: baseWhere,
          isRejected: false,
          isWithdrawn: false,
        },
      }),

      // stage breakdown — group by stageId then resolve labels
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: { requirement: baseWhere },
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

    // resolve stage labels for pipeline breakdown
    const stageIds = pipelineCounts
      .map((p) => p.currentStageId)
      .filter(Boolean) as string[];

    const [stagesData, busData, slsData] = await Promise.all([
      stageIds.length > 0
        ? prisma.pipelineStage.findMany({
            where: { id: { in: stageIds } },
            select: { id: true, code: true, label: true, order: true },
          })
        : [],
      (() => {
        const buIds = buBreakdownRaw
          .map((b) => b.businessUnitId)
          .filter(Boolean) as string[];
        return buIds.length > 0
          ? prisma.businessUnit.findMany({
              where: { id: { in: buIds } },
              select: { id: true, name: true },
            })
          : [];
      })(),
      (() => {
        const slIds = slBreakdownRaw
          .map((s) => s.serviceLineId)
          .filter(Boolean) as string[];
        return slIds.length > 0
          ? prisma.serviceLine.findMany({
              where: { id: { in: slIds } },
              select: { id: true, name: true },
            })
          : [];
      })(),
    ]);

    const stageMap = new Map(
      (
        stagesData as {
          id: string;
          code: string;
          label: string;
          order: number;
        }[]
      ).map((s) => [s.id, s])
    );
    const buMap = new Map(
      (busData as { id: string; name: string }[]).map((b) => [b.id, b.name])
    );
    const slMap = new Map(
      (slsData as { id: string; name: string }[]).map((s) => [s.id, s.name])
    );

    // pipeline breakdown sorted by stage order
    const pipeline = pipelineCounts
      .filter((p) => stageMap.has(p.currentStageId))
      .map((p) => {
        const stage = stageMap.get(p.currentStageId)!;
        return {
          stageId: p.currentStageId,
          code: stage.code,
          label: stage.label,
          order: stage.order,
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
      },
    });
  } catch (err) {
    console.error("getDashboardStats:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

export const getMyAssignments = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const assignments = await prisma.requirementAssignment.findMany({
      where: { assignedToId: userId, status: "ACTIVE" },
      orderBy: { assignedAt: "desc" },
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
            filledOpenings: true,
            activeApplications: true,
            description: true,
            location: true,
            jobType: true,
            remoteType: true,
            respondBy: true,
            isRespondByBreached: true,
            client: { select: { id: true, name: true } },
            serviceLine: { select: { id: true, name: true } },
          },
        },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        // pipeline rows assigned to me for each requirement
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
          take: 10, // cap per assignment — frontend loads full list separately
        },
        // depth 1 children
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
            assignedBy: {
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
                    email: true,
                    currentTitle: true,
                    topSkills: true,
                  },
                },
              },
              orderBy: { stageUpdatedAt: "desc" },
              take: 10,
            },
            // depth 2 children
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
                assignedBy: {
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
                        email: true,
                        currentTitle: true,
                        topSkills: true,
                      },
                    },
                  },
                  orderBy: { stageUpdatedAt: "desc" },
                  take: 10,
                },
              },
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

export const getDashboardActivity = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const {
      buId,
      deptId,
      serviceLineId,
      clientId,
      limit = "20",
    } = req.query as Record<string, string>;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const buFilter = buId
      ? { businessUnit: { ancestorIds: { has: buId } } }
      : {};
    const deptFilter = deptId ? { createdBy: { departmentId: deptId } } : {};
    const slFilter = serviceLineId ? { serviceLineId } : {};
    const clientFilter = clientId ? { clientId } : {};

    const activities = await prisma.requirementActivity.findMany({
      where: {
        requirement: {
          ...scopeWhere,
          deletedAt: null,
          ...buFilter,
          ...deptFilter,
          ...slFilter,
          ...clientFilter,
        },
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
