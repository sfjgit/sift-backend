// controller/department.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

// ── GET /departments
export const getDepartments = async (req: Request, res: Response) => {
  try {
    const { search, isActive } = req.query as Record<string, string>;

    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }

    const departments = await prisma.department.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    console.error("getDepartments:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch departments" });
  }
};

// ── GET /departments/:id
// controller/department.controller.ts — replace getDepartmentById

// ── GET /departments/:id
export const getDepartmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const department = await prisma.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,

        users: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            email: true,
            phone: true,
            workingLocation: true,
            role: { select: { id: true, name: true } },
            reportingTo: {
              select: { id: true, firstName: true, lastName: true },
            },
            _count: {
              select: {
                assignmentsReceived: { where: { status: "ACTIVE" } },
                assignmentsGiven: { where: { status: "ACTIVE" } },
                subordinates: { where: { isActive: true } },
              },
            },
          },
          orderBy: { firstName: "asc" },
        },

        _count: { select: { users: true } },
      },
    });

    if (!department) {
      res.status(404).json({ success: false, message: "Department not found" });
      return;
    }

    // ── aggregate stats ──────────────────────────────────────────────────────

    const userIds = department.users.map((u) => u.id);

    // active assignments across all users in this dept
    const [
      activeAssignments,
      requirementsCreated,
      requirementsActive,
      candidateStats,
    ] = await Promise.all([
      prisma.requirementAssignment.findMany({
        where: {
          assignedToId: { in: userIds },
          status: "ACTIVE",
        },
        select: {
          id: true,
          submissionsCount: true,
          interviewsCount: true,
          filledOpenings: true,
          allocatedOpenings: true,
          assignedAt: true,
          deadline: true,
          assignedToId: true,
          assignedById: true,
          assignedBy: { select: { id: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
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
              client: { select: { id: true, name: true } },
              businessUnit: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { assignedAt: "desc" },
        take: 50,
      }),

      prisma.requirement.count({
        where: { createdById: { in: userIds }, deletedAt: null },
      }),

      prisma.requirement.count({
        where: {
          createdById: { in: userIds },
          deletedAt: null,
          status: "ACTIVE",
        },
      }),

      prisma.requirementCandidate.groupBy({
        by: ["currentStage"],
        where: { assignment: { assignedToId: { in: userIds } } },
        _count: { id: true },
      }),
    ]);

    const totalCandidates = candidateStats.reduce((s, c) => s + c._count.id, 0);
    const candidatesByStage = Object.fromEntries(
      candidateStats.map((c) => [c.currentStage, c._count.id])
    );

    const stats = {
      totalUsers: department._count.users,
      activeAssignments: activeAssignments.length,
      totalSubmissions: activeAssignments.reduce(
        (s, a) => s + a.submissionsCount,
        0
      ),
      totalInterviews: activeAssignments.reduce(
        (s, a) => s + a.interviewsCount,
        0
      ),
      totalFilled: activeAssignments.reduce((s, a) => s + a.filledOpenings, 0),
      requirementsCreated,
      requirementsActive,
      candidatesSourced: totalCandidates,
      candidatesByStage,
    };

    res.json({
      success: true,
      data: { ...department, activeAssignments, stats },
    });
  } catch (err) {
    console.error("getDepartmentById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch department" });
  }
};

// ── POST /departments
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, code } = req.body;

    const existing = await prisma.department.findUnique({
      where: { name },
      select: { id: true },
    });

    if (existing) {
      res.status(409).json({
        success: false,
        message: "Department with this name already exists",
      });
      return;
    }

    const department = await prisma.department.create({
      data: {
        name,
        code: code ?? null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Department created", data: department });
  } catch (err) {
    console.error("createDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create department" });
  }
};

// ── PUT /departments/:id
export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code } = req.body;

    const existing = await prisma.department.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Department not found" });
      return;
    }

    // check name conflict on rename
    if (name) {
      const conflict = await prisma.department.findFirst({
        where: { name, id: { not: id } },
        select: { id: true },
      });

      if (conflict) {
        res.status(409).json({
          success: false,
          message: "Department with this name already exists",
        });
        return;
      }
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
      },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
      },
    });

    res.json({ success: true, message: "Department updated", data: updated });
  } catch (err) {
    console.error("updateDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update department" });
  }
};

// ── PATCH /departments/:id/toggle
// toggle isActive instead of hard delete
// cant delete if users are assigned
export const toggleDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.department.findUnique({
      where: { id },
      select: { id: true, isActive: true, _count: { select: { users: true } } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Department not found" });
      return;
    }

    // block deactivation if users are still assigned
    if (existing.isActive && existing._count.users > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot deactivate — ${existing._count.users} user(s) still assigned to this department`,
      });
      return;
    }

    const updated = await prisma.department.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { id: true, name: true, isActive: true },
    });

    res.json({
      success: true,
      message: `Department ${updated.isActive ? "activated" : "deactivated"}`,
      data: updated,
    });
  } catch (err) {
    console.error("toggleDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to toggle department" });
  }
};
