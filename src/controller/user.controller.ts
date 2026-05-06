// controller/user.controller.ts
import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import bcrypt from "bcryptjs";
import { getSubordinateIds } from "@/services/orgService";

// ─────────────────────────────────────────
// GET /users
// ─────────────────────────────────────────

export const listUsers = async (req: Request, res: Response) => {
  try {
    const {
      search,
      roleId,
      departmentId,
      reportingToId,
      isActive,
      page = "1",
      limit = "25",
      sortBy = "firstName",
      sortDir = "asc",
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    // scope — user sees themselves + their subtree
    let visibleUserIds: string[] | null = null;
    if (!isSuperAdmin) {
      const subordinates = await getSubordinateIds(userId);
      visibleUserIds = [userId, ...subordinates];
    }

    const where: any = {};

    if (visibleUserIds) {
      where.id = { in: visibleUserIds };
    }

    if (isActive !== undefined) where.isActive = isActive === "true";
    if (roleId) where.roleId = roleId;
    if (departmentId) where.departmentId = departmentId;
    if (reportingToId) where.reportingToId = reportingToId;

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { employeeId: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const SORTABLE = ["firstName", "lastName", "createdAt", "dateOfJoin"];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { firstName: "asc" as const };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
          employeeId: true,
          phone: true,
          workingLocation: true,
          isActive: true,
          isSuperAdmin: true,
          dateOfJoin: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          reportingTo: {
            select: { id: true, firstName: true, lastName: true },
          },
          teamLead: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { subordinates: true, teamMembers: true } },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: users,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      permissions: {
        canAdd: req.modulePermission.canAdd,
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("listUsers:", err);
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
};

// ─────────────────────────────────────────
// GET /users/:id
// ─────────────────────────────────────────

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // can only view yourself or someone in your subtree
    if (!isSuperAdmin && id !== actorId) {
      const subordinates = await getSubordinateIds(actorId);
      if (!subordinates.includes(id)) {
        res.status(403).json({ success: false, message: "Access denied" });
        return;
      }
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        nickName: true,
        displayName: true,
        employeeId: true,
        phone: true,
        workingLocation: true,
        timezone: true,
        dateOfBirth: true,
        dateOfJoin: true,
        isActive: true,
        isSuperAdmin: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { id: true, name: true, permissions: true } },
        department: { select: { id: true, name: true } },
        reportingTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
          },
        },
        teamLead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
          },
        },
        subordinates: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
          },
          orderBy: { firstName: "asc" },
        },
        teamMembers: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
          },
          orderBy: { firstName: "asc" },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: {
            subordinates: true,
            requirementsCreated: true,
            assignmentsReceived: { where: { status: "ACTIVE" } },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error("getUserById:", err);
    res.status(500).json({ success: false, message: "Failed to fetch user" });
  }
};

// ─────────────────────────────────────────
// POST /users
// ─────────────────────────────────────────

export const createUser = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const actorId = req.user!.id;

    // email uniqueness
    const emailExists = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (emailExists) {
      res.status(409).json({ success: false, message: "Email already in use" });
      return;
    }

    // employeeId uniqueness
    if (body.employeeId) {
      const empExists = await prisma.user.findUnique({
        where: { employeeId: body.employeeId },
        select: { id: true },
      });
      if (empExists) {
        res
          .status(409)
          .json({ success: false, message: "Employee ID already in use" });
        return;
      }
    }

    // validate role exists
    const role = await prisma.role.findUnique({
      where: { id: body.roleId },
      select: { id: true },
    });
    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    // validate reportingTo exists
    if (body.reportingToId) {
      const manager = await prisma.user.findUnique({
        where: { id: body.reportingToId },
        select: { id: true },
      });
      if (!manager) {
        res
          .status(404)
          .json({ success: false, message: "Reporting manager not found" });
        return;
      }
    }

    // validate teamLead exists
    if (body.teamLeadId) {
      const tl = await prisma.user.findUnique({
        where: { id: body.teamLeadId },
        select: { id: true },
      });
      if (!tl) {
        res
          .status(404)
          .json({ success: false, message: "Team lead not found" });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          firstName: body.firstName,
          lastName: body.lastName,
          middleName: body.middleName ?? null,
          nickName: body.nickName ?? null,
          displayName: body.displayName ?? null,
          employeeId: body.employeeId ?? null,
          phone: body.phone ?? null,
          workingLocation: body.workingLocation ?? null,
          timezone: body.timezone ?? null,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          dateOfJoin: body.dateOfJoin ? new Date(body.dateOfJoin) : null,
          roleId: body.roleId,
          departmentId: body.departmentId ?? null,
          reportingToId: body.reportingToId ?? null,
          teamLeadId: body.teamLeadId ?? null,
          isSuperAdmin: body.isSuperAdmin ?? false,
          isActive: true,
          createdById: actorId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          employeeId: true,
          isActive: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          reportingTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "CREATE",
          module: "users",
          recordId: u.id,
          newData: {
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
          },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return u;
    });

    res
      .status(201)
      .json({ success: true, message: "User created", data: user });
  } catch (err) {
    console.error("createUser:", err);
    res.status(500).json({ success: false, message: "Failed to create user" });
  }
};

// ─────────────────────────────────────────
// PUT /users/:id
// ─────────────────────────────────────────

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const actorId = req.user!.id;

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, employeeId: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if (body.employeeId && body.employeeId !== existing.employeeId) {
      const empConflict = await prisma.user.findUnique({
        where: { employeeId: body.employeeId },
        select: { id: true },
      });
      if (empConflict) {
        res
          .status(409)
          .json({ success: false, message: "Employee ID already in use" });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          ...(body.firstName !== undefined && { firstName: body.firstName }),
          ...(body.lastName !== undefined && { lastName: body.lastName }),
          ...(body.middleName !== undefined && { middleName: body.middleName }),
          ...(body.nickName !== undefined && { nickName: body.nickName }),
          ...(body.displayName !== undefined && {
            displayName: body.displayName,
          }),
          ...(body.employeeId !== undefined && { employeeId: body.employeeId }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(body.workingLocation !== undefined && {
            workingLocation: body.workingLocation,
          }),
          ...(body.timezone !== undefined && { timezone: body.timezone }),
          ...(body.dateOfBirth !== undefined && {
            dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          }),
          ...(body.dateOfJoin !== undefined && {
            dateOfJoin: body.dateOfJoin ? new Date(body.dateOfJoin) : null,
          }),
          ...(body.roleId !== undefined && { roleId: body.roleId }),
          ...(body.departmentId !== undefined && {
            departmentId: body.departmentId,
          }),
          ...(body.reportingToId !== undefined && {
            reportingToId: body.reportingToId,
          }),
          ...(body.teamLeadId !== undefined && { teamLeadId: body.teamLeadId }),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          employeeId: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE",
          module: "users",
          recordId: id,
          newData: body,
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return u;
    });

    res.json({ success: true, message: "User updated", data: updated });
  } catch (err) {
    console.error("updateUser:", err);
    res.status(500).json({ success: false, message: "Failed to update user" });
  }
};

// ─────────────────────────────────────────
// PATCH /users/:id/toggle
// ─────────────────────────────────────────

export const toggleUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    if (id === actorId) {
      res
        .status(400)
        .json({ success: false, message: "Cannot deactivate yourself" });
      return;
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, isSuperAdmin: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if (existing.isSuperAdmin) {
      res
        .status(400)
        .json({ success: false, message: "Cannot deactivate a super admin" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });

    res.json({
      success: true,
      message: `User ${updated.isActive ? "activated" : "deactivated"}`,
      data: updated,
    });
  } catch (err) {
    console.error("toggleUser:", err);
    res.status(500).json({ success: false, message: "Failed to toggle user" });
  }
};

// ─────────────────────────────────────────
// PATCH /users/:id/reporting
// ─────────────────────────────────────────

export const assignReporting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reportingToId } = req.body;
    const actorId = req.user!.id;

    if (reportingToId === id) {
      res
        .status(400)
        .json({ success: false, message: "User cannot report to themselves" });
      return;
    }

    // circular check — reportingToId must not be in id's subtree
    if (reportingToId) {
      const subtree = await getSubordinateIds(id);
      if (subtree.includes(reportingToId)) {
        res
          .status(400)
          .json({
            success: false,
            message: "Circular reporting chain detected",
          });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { reportingToId: reportingToId ?? null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          reportingTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE",
          module: "users",
          recordId: id,
          newData: { reportingToId },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return u;
    });

    res.json({ success: true, message: "Reporting updated", data: updated });
  } catch (err) {
    console.error("assignReporting:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update reporting" });
  }
};

// ─────────────────────────────────────────
// PATCH /users/:id/teamlead
// ─────────────────────────────────────────

export const assignTeamLead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { teamLeadId } = req.body;

    if (teamLeadId === id) {
      res
        .status(400)
        .json({
          success: false,
          message: "User cannot be their own team lead",
        });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { teamLeadId: teamLeadId ?? null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        teamLead: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json({ success: true, message: "Team lead updated", data: updated });
  } catch (err) {
    console.error("assignTeamLead:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update team lead" });
  }
};

// ─────────────────────────────────────────
// PATCH /users/:id/department
// ─────────────────────────────────────────

export const assignDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { departmentId } = req.body;

    if (departmentId) {
      const dept = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true },
      });
      if (!dept) {
        res
          .status(404)
          .json({ success: false, message: "Department not found" });
        return;
      }
      if (!dept.isActive) {
        res
          .status(400)
          .json({ success: false, message: "Department is inactive" });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { departmentId: departmentId ?? null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        department: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, message: "Department updated", data: updated });
  } catch (err) {
    console.error("assignDepartment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update department" });
  }
};

// ─────────────────────────────────────────
// PATCH /users/:id/role
// ─────────────────────────────────────────

export const assignRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { roleId } = req.body;
    const actorId = req.user!.id;

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true },
    });

    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { roleId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: { select: { id: true, name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE",
          module: "users",
          recordId: id,
          newData: { roleId },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return u;
    });

    res.json({ success: true, message: "Role updated", data: updated });
  } catch (err) {
    console.error("assignRole:", err);
    res.status(500).json({ success: false, message: "Failed to update role" });
  }
};

// ─────────────────────────────────────────
// GET /users/:id/tree
// full org tree rooted at this user
// ─────────────────────────────────────────

export const getUserTree = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const rows = await prisma.$queryRaw<
      {
        id: string;
        firstName: string;
        lastName: string;
        employeeId: string | null;
        reportingToId: string | null;
        teamLeadId: string | null;
        depth: number;
      }[]
    >`
      WITH RECURSIVE org_tree AS (
        SELECT id, "firstName", "lastName", "employeeId", "reportingToId", "teamLeadId", 0 as depth
        FROM "User"
        WHERE id = ${id}
        UNION ALL
        SELECT u.id, u."firstName", u."lastName", u."employeeId", u."reportingToId", u."teamLeadId", ot.depth + 1
        FROM "User" u
        INNER JOIN org_tree ot ON u."reportingToId" = ot.id
      )
      SELECT * FROM org_tree ORDER BY depth
    `;

    // build tree from flat rows
    const map = new Map<string, any>();
    rows.forEach((r) => map.set(r.id, { ...r, children: [] }));

    const root = map.get(id);
    rows.forEach((r) => {
      if (r.reportingToId && map.has(r.reportingToId) && r.id !== id) {
        map.get(r.reportingToId).children.push(map.get(r.id));
      }
    });

    res.json({ success: true, data: root });
  } catch (err) {
    console.error("getUserTree:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch org tree" });
  }
};
