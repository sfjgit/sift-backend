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

    // build filter additions
    const buFilter = buId
      ? { businessUnit: { ancestorIds: { has: buId } } }
      : {};

    const deptFilter = deptId ? { createdBy: { departmentId: deptId } } : {};

    const slFilter = serviceLineId ? { serviceLineId } : {};

    const clientFilter = clientId ? { clientId } : {};

    const baseWhere = {
      ...scopeWhere,
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
      prisma.requirementCandidate.count({
        where: {
          requirement: baseWhere,
          currentStage: { notIn: ["REJECTED", "WITHDRAWN"] },
        },
      }),

      // pipeline stage breakdown
      prisma.requirementCandidate.groupBy({
        by: ["currentStage"],
        where: { requirement: baseWhere },
        _count: { _all: true },
      }),

      // BU breakdown
      prisma.requirement.groupBy({
        by: ["businessUnitId"],
        where: baseWhere,
        _count: { _all: true },
      }),

      // service line breakdown
      prisma.requirement.groupBy({
        by: ["serviceLineId"],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    // resolve BU names
    const buIds = buBreakdownRaw
      .map((b) => b.businessUnitId)
      .filter(Boolean) as string[];

    const slIds = slBreakdownRaw
      .map((s) => s.serviceLineId)
      .filter(Boolean) as string[];

    const [busData, slsData] = await Promise.all([
      buIds.length > 0
        ? prisma.businessUnit.findMany({
            where: { id: { in: buIds } },
            select: { id: true, name: true },
          })
        : [],
      slIds.length > 0
        ? prisma.serviceLine.findMany({
            where: { id: { in: slIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const buMap = new Map(
      (busData as { id: string; name: string }[]).map((b) => [b.id, b.name])
    );
    const slMap = new Map(
      (slsData as { id: string; name: string }[]).map((s) => [s.id, s.name])
    );

    const stageCount = (stage: string) =>
      pipelineCounts.find((p) => p.currentStage === stage)?._count._all ?? 0;

    const pipeline = {
      sourced: stageCount("SOURCED"),
      screening: stageCount("SCREENING"),
      submitted: stageCount("SUBMITTED"),
      interviewScheduled: stageCount("INTERVIEW_SCHEDULED"),
      interviewDone: stageCount("INTERVIEW_DONE"),
      offerRolled: stageCount("OFFER_ROLLED"),
      offerAccepted: stageCount("OFFER_ACCEPTED"),
      joined: stageCount("JOINED"),
    };

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
      include: {
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            filledOpenings: true,
            client: { select: { id: true, name: true } },
          },
        },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        candidates: {
          select: {
            id: true,
            candidateId: true,
            candidateName: true,
            candidateEmail: true,
            currentStage: true,
            stageUpdatedAt: true,
          },
          orderBy: { stageUpdatedAt: "desc" },
        },
        // depth 1 children
        childAssignments: {
          where: { status: "ACTIVE" },
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true },
            },
            assignedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
            candidates: {
              select: {
                id: true,
                candidateId: true,
                candidateName: true,
                candidateEmail: true,
                currentStage: true,
                stageUpdatedAt: true,
              },
              orderBy: { stageUpdatedAt: "desc" },
            },
            // depth 2 children
            childAssignments: {
              where: { status: "ACTIVE" },
              include: {
                assignedTo: {
                  select: { id: true, firstName: true, lastName: true },
                },
                assignedBy: {
                  select: { id: true, firstName: true, lastName: true },
                },
                candidates: {
                  select: {
                    id: true,
                    candidateId: true,
                    candidateName: true,
                    candidateEmail: true,
                    currentStage: true,
                    stageUpdatedAt: true,
                  },
                  orderBy: { stageUpdatedAt: "desc" },
                },
              },
            },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
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
      take: parseInt(limit),
    });

    res.json({ success: true, data: activities });
  } catch (err) {
    console.error("getDashboardActivity:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch activity" });
  }
};
