// controllers/dashboardController.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

export const getDashboardSummary = async (req: Request, res: Response) => {
  try {
    const { buId } = req.query;
    const buFilter = buId ? { businessUnitId: buId as string } : {};
    const buUserFilter = buId ? { businessUnitId: buId as string } : {};

    const [
      totalRequirements,
      requirementsByStatus,
      requirementsByPriority,
      requirementsByType,
      requirementsByRemoteType,
      totalClients,
      clientsByStatus,
      totalUsers,
      usersByRole,
      totalTeams,
      teamsByCategory,
      teamHeadcounts,
      openingsPipeline,
      recentRequirements,
    ] = await Promise.all([
      // 1. total requirements
      prisma.requirement.count({ where: buFilter }),

      // 2. requirements by status
      prisma.requirement.groupBy({
        by: ["status"],
        where: buFilter,
        _count: { _all: true },
        orderBy: { _count: { status: "desc" } },
      }),

      // 3. requirements by priority
      prisma.requirement.groupBy({
        by: ["priority"],
        where: buFilter,
        _count: { _all: true },
      }),

      // 4. requirements by jobType
      prisma.requirement.groupBy({
        by: ["jobType"],
        where: buFilter,
        _count: { _all: true },
      }),

      // 5. requirements by remoteType
      prisma.requirement.groupBy({
        by: ["remoteType"],
        where: buFilter,
        _count: { _all: true },
      }),

      // 6. total clients
      prisma.clientClient.count({ where: buFilter }),

      // 7. clients by status
      prisma.clientClient.groupBy({
        by: ["status"],
        where: buFilter,
        _count: { _all: true },
      }),

      // 8. total active users
      prisma.user.count({
        where: { ...buUserFilter, isActive: true },
      }),

      // 9. users grouped by role name — shows team composition
      prisma.user.groupBy({
        by: ["roleId"],
        where: { ...buUserFilter, isActive: true },
        _count: { _all: true },
      }),

      // 10. total active teams
      prisma.team.count({
        where: { ...buUserFilter, isActive: true },
      }),

      // 11. teams by category
      prisma.team.groupBy({
        by: ["category"],
        where: { ...buUserFilter, isActive: true },
        _count: { _all: true },
      }),

      // 12. team headcounts — each team with member count
      prisma.team.findMany({
        where: { ...buUserFilter, isActive: true },
        select: {
          id: true,
          name: true,
          category: true,
          businessUnit: { select: { name: true } },
          _count: { select: { members: { where: { isActive: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),

      // 13. openings pipeline aggregate
      prisma.requirement.aggregate({
        where: buFilter,
        _sum: {
          totalOpenings: true,
          filledOpenings: true,
          activeApplications: true,
          interviewsScheduled: true,
          offersRolledOut: true,
        },
      }),

      // 14. recent 5 requirements
      prisma.requirement.findMany({
        where: buFilter,
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          priority: true,
          jobType: true,
          remoteType: true,
          totalOpenings: true,
          filledOpenings: true,
          createdAt: true,
          client: { select: { name: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true } },
        },
      }),
    ]);

    // Resolve role names for the usersByRole breakdown
    const roleIds = [...new Set(usersByRole.map((r) => r.roleId))];
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });
    const roleMap = Object.fromEntries(roles.map((r) => [r.id, r.name]));

    return res.status(200).json({
      success: true,
      data: {
        totals: {
          requirements: totalRequirements,
          clients: totalClients,
          users: totalUsers,
          teams: totalTeams,
        },
        requirements: {
          byStatus: requirementsByStatus.map((r) => ({
            status: r.status,
            count: r._count._all,
          })),
          byPriority: requirementsByPriority.map((r) => ({
            priority: r.priority,
            count: r._count._all,
          })),
          byJobType: requirementsByType.map((r) => ({
            jobType: r.jobType,
            count: r._count._all,
          })),
          byRemoteType: requirementsByRemoteType.map((r) => ({
            remoteType: r.remoteType,
            count: r._count._all,
          })),
        },
        clients: {
          byStatus: clientsByStatus.map((r) => ({
            status: r.status,
            count: r._count._all,
          })),
        },
        users: {
          byRole: usersByRole.map((r) => ({
            roleId: r.roleId,
            roleName: roleMap[r.roleId] ?? "Unknown",
            count: r._count._all,
          })),
        },
        teams: {
          byCategory: teamsByCategory.map((r) => ({
            category: r.category,
            count: r._count._all,
          })),
          headcounts: teamHeadcounts.map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            businessUnit: t.businessUnit?.name ?? null,
            memberCount: t._count.members,
          })),
        },
        pipeline: {
          totalOpenings: openingsPipeline._sum.totalOpenings ?? 0,
          filledOpenings: openingsPipeline._sum.filledOpenings ?? 0,
          activeApplications: openingsPipeline._sum.activeApplications ?? 0,
          interviewsScheduled: openingsPipeline._sum.interviewsScheduled ?? 0,
          offersRolledOut: openingsPipeline._sum.offersRolledOut ?? 0,
        },
        recentRequirements,
      },
    });
  } catch (error) {
    console.error("Dashboard summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching dashboard summary",
    });
  }
};
