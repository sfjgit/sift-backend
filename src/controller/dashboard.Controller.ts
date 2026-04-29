import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { reqScopeWhere } from "@/middleware/scopeFilter.middleware";

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/summary
// Returns everything the dashboard needs in one call.
// Fully scoped — every query respects req.scopeFilter.
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboardSummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const scopeWhere = reqScopeWhere(req.scopeFilter);
    const baseWhere = { ...scopeWhere, deletedAt: null };

    const [
      // Requirement counts by status
      reqByStatus,
      // Requirement counts by priority (ACTIVE only)
      reqByPriority,
      // Breached requirements
      breachedCount,
      // Requirements created this week
      thisWeekCount,
      // Recent requirements
      recentRequirements,
      // My assignments (if recruiter/TL)
      myAssignments,
      // Upcoming deadlines (next 7 days)
      upcomingDeadlines,
      // Top clients by active requirements
      topClients,
      // Activity feed
      recentActivity,
    ] = await Promise.all([
      // 1. req by status
      prisma.requirement.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { _all: true },
      }),

      // 2. req by priority (ACTIVE only)
      prisma.requirement.groupBy({
        by: ["priority"],
        where: { ...baseWhere, status: "ACTIVE" },
        _count: { _all: true },
      }),

      // 3. breached
      prisma.requirement.count({
        where: { ...baseWhere, isRespondByBreached: true, status: "ACTIVE" },
      }),

      // 4. this week
      prisma.requirement.count({
        where: {
          ...baseWhere,
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
      }),

      // 5. recent requirements
      prisma.requirement.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          priority: true,
          totalOpenings: true,
          filledOpenings: true,
          respondBy: true,
          isRespondByBreached: true,
          createdAt: true,
          client: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
        },
      }),

      // 6. my active assignments
      prisma.requirementAssignment.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { recruiterId: userId },
            ...(req.scopeFilter?.teamIds?.length
              ? [{ teamId: { in: req.scopeFilter.teamIds } }]
              : []),
          ],
        },
        orderBy: { assignedAt: "desc" },
        take: 5,
        select: {
          id: true,
          assignmentType: true,
          allocatedOpenings: true,
          filledOpenings: true,
          submissionsCount: true,
          deadline: true,
          breachedAt: true,
          team: { select: { id: true, name: true } },
          requirement: {
            select: {
              id: true,
              reqCode: true,
              title: true,
              status: true,
              priority: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 7. upcoming deadlines (next 7 days, ACTIVE reqs)
      prisma.requirement.findMany({
        where: {
          ...baseWhere,
          status: "ACTIVE",
          respondBy: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 86_400_000),
          },
        },
        orderBy: { respondBy: "asc" },
        take: 5,
        select: {
          id: true,
          reqCode: true,
          title: true,
          priority: true,
          respondBy: true,
          isRespondByBreached: true,
          totalOpenings: true,
          filledOpenings: true,
          client: { select: { id: true, name: true } },
        },
      }),

      // 8. top clients
      prisma.client.findMany({
        where: {
          deletedAt: null,
          ...(req.scopeFilter?.type === "BU" || req.scopeFilter?.type === "ALL"
            ? req.scopeFilter.businessUnitId
              ? { businessUnitId: req.scopeFilter.businessUnitId }
              : {}
            : { handlers: { some: { userId, status: "ACTIVE" } } }),
        },
        orderBy: { requirements: { _count: "desc" } },
        take: 5,
        select: {
          id: true,
          name: true,
          status: true,
          industry: true,
          _count: {
            select: {
              requirements: { where: { status: "ACTIVE", deletedAt: null } },
            },
          },
        },
      }),

      // 9. activity feed
      prisma.requirementActivity.findMany({
        where: {
          requirement: baseWhere,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          summary: true,
          createdAt: true,
          actor: { select: { id: true, firstName: true, lastName: true } },
          requirement: {
            select: { id: true, reqCode: true, title: true },
          },
        },
      }),
    ]);

    // Shape status map
    const statusMap: Record<string, number> = {};
    for (const row of reqByStatus) statusMap[row.status] = row._count._all;

    const priorityMap: Record<string, number> = {};
    for (const row of reqByPriority)
      priorityMap[row.priority] = row._count._all;

    const totalActive = statusMap["ACTIVE"] ?? 0;
    const totalPending = statusMap["PENDING_APPROVAL"] ?? 0;
    const totalDraft = statusMap["DRAFT"] ?? 0;
    const totalOnHold = statusMap["ON_HOLD"] ?? 0;
    const totalClosed = statusMap["CLOSED"] ?? 0;
    const totalCancelled = statusMap["CANCELLED"] ?? 0;
    const totalRequirements = Object.values(statusMap).reduce(
      (a, b) => a + b,
      0
    );

    res.json({
      success: true,
      data: {
        stats: {
          totalRequirements,
          active: totalActive,
          pendingApproval: totalPending,
          draft: totalDraft,
          onHold: totalOnHold,
          closed: totalClosed,
          cancelled: totalCancelled,
          breached: breachedCount,
          thisWeek: thisWeekCount,
          highPriority: priorityMap["HIGH"] ?? 0,
          mediumPriority: priorityMap["MEDIUM"] ?? 0,
          lowPriority: priorityMap["LOW"] ?? 0,
        },
        recentRequirements,
        myAssignments,
        upcomingDeadlines,
        topClients,
        recentActivity,
      },
    });
  } catch (err) {
    console.error("getDashboardSummary:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch dashboard summary" });
  }
};
