// File: user.controller.ts
// Path: src/controller/user.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import bcrypt from "bcryptjs";
import { getSubordinateIds } from "@/services/orgService";
import crypto from "crypto";
import nodemailer from "nodemailer";
import env from "@/config/env";

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
      buId,
      teamId,
      teamRole,
      isClientHandler,
      page = "1",
      limit = "25",
      sortBy = "firstName",
      sortDir = "asc",
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    let visibleUserIds: string[] | null = null;
    if (!isSuperAdmin) {
      const subordinates = await getSubordinateIds(userId);
      visibleUserIds = [userId, ...subordinates];
    }

    let buUserIds: string[] | null = null;
    if (buId) {
      const [assignmentUsers, spocUsers] = await Promise.all([
        prisma.requirementAssignment.findMany({
          where: {
            status: "ACTIVE",
            assigneeBU: { ancestorIds: { has: buId } },
          },
          select: { assignedToId: true },
          distinct: ["assignedToId"],
        }),
        prisma.clientSpoc.findMany({
          where: {
            isActive: true,
            businessUnit: { ancestorIds: { has: buId } },
          },
          select: { handlerId: true },
          distinct: ["handlerId"],
        }),
      ]);

      const ids = new Set<string>([
        ...assignmentUsers.map((a) => a.assignedToId),
        ...spocUsers.map((s) => s.handlerId),
      ]);
      buUserIds = [...ids];
    }

    // const where: any = {};

    // if (visibleUserIds) {
    //   where.id = { in: visibleUserIds };
    // }

    // if (buUserIds !== null) {
    //   if (where.id) {
    //     const scopeSet = new Set(where.id.in as string[]);
    //     where.id = { in: buUserIds.filter((id) => scopeSet.has(id)) };
    //   } else {
    //     where.id = { in: buUserIds };
    //   }
    // }

    // if (isActive !== undefined) where.isActive = isActive === "true";
    // if (roleId) where.roleId = roleId;
    // if (departmentId) where.departmentId = departmentId;
    // if (reportingToId) where.reportingToId = reportingToId;

    // if (teamId) where.teamLeadId = teamId;

    // if (teamRole) {
    //   if (teamRole === "LEAD" || teamRole === "CO_LEAD") {
    //     where.teamMembers = { some: { isActive: true } };
    //   } else if (teamRole === "MEMBER") {
    //     where.teamLeadId = { not: null };
    //   }
    // }

    // Reporting-to = full subtree under selected manager (direct + indirect)
    let reportingUserIds: string[] | null = null;
    if (reportingToId) {
      reportingUserIds = await getSubordinateIds(reportingToId);
    }

    // Intersect every active id-scope: RBAC ∩ BU ∩ reporting subtree
    const idScopes = [visibleUserIds, buUserIds, reportingUserIds].filter(
      (s): s is string[] => s !== null,
    );

    const where: any = {};
    const AND: any[] = [];

    if (idScopes.length) {
      const [first, ...others] = idScopes;
      const sets = others.map((s) => new Set(s));
      where.id = { in: first.filter((id) => sets.every((s) => s.has(id))) };
    }

    if (isActive !== undefined) where.isActive = isActive === "true";
    if (roleId) where.roleId = roleId;
    if (departmentId) where.departmentId = departmentId;

    if (teamId) AND.push({ teamLeadId: teamId });

    if (teamRole) {
      if (teamRole === "LEAD" || teamRole === "CO_LEAD") {
        where.teamMembers = { some: { isActive: true } };
      } else if (teamRole === "MEMBER") {
        AND.push({ teamLeadId: { not: null } });
      }
    }

    if (AND.length) where.AND = AND;

    if (isClientHandler === "true") {
      where.spocsHandled = { some: { isActive: true } };
    } else if (isClientHandler === "false") {
      where.spocsHandled = { none: { isActive: true } };
    }

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
          _count: {
            select: {
              subordinates: true,
              teamMembers: true,
              spocsHandled: { where: { isActive: true } },
              assignmentsReceived: { where: { status: "ACTIVE" } },
            },
          },
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

// GET /users/hierarchy-filters
export const getHierarchyFilters = async (req: Request, res: Response) => {
  try {
    const [teamLeadRows, reportingToRows] = await Promise.all([
      prisma.user.findMany({
        where: { teamLeadId: { not: null } },
        select: { teamLeadId: true },
        distinct: ["teamLeadId"],
      }),
      prisma.user.findMany({
        where: { reportingToId: { not: null } },
        select: { reportingToId: true },
        distinct: ["reportingToId"],
      }),
    ]);

    const teamLeadIds = [
      ...new Set(teamLeadRows.map((r) => r.teamLeadId).filter(Boolean)),
    ] as string[];

    const reportingToIds = [
      ...new Set(reportingToRows.map((r) => r.reportingToId).filter(Boolean)),
    ] as string[];

    const [teamLeads, reportingTo] = await Promise.all([
      teamLeadIds.length
        ? prisma.user.findMany({
            where: { id: { in: teamLeadIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
              isActive: true,
            },
            orderBy: { firstName: "asc" },
          })
        : [],
      reportingToIds.length
        ? prisma.user.findMany({
            where: { id: { in: reportingToIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
              isActive: true,
            },
            orderBy: { firstName: "asc" },
          })
        : [],
    ]);

    res.json({
      success: true,
      data: { teamLeads, reportingTo },
    });
  } catch (err) {
    console.error("getHierarchyFilters:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch hierarchy filters" });
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
// PATCH /users/:id/reset-password
//
// Only a superAdmin can call this.
// Body: { newPassword: string }
// - hashes the new password
// - updates the user
// - nukes all refresh tokens (force re-login)
// - writes audit log
// - fires an in-house notification to the target user
// ─────────────────────────────────────────

export const adminResetPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const actorId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // ── guard: only superAdmins ───────────────────────────────────────────────
    if (!isSuperAdmin) {
      res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Only super admins can reset passwords",
      });
      return;
    }

    // ── guard: can't reset your own via this endpoint ─────────────────────────
    if (id === actorId) {
      res.status(400).json({
        success: false,
        code: "SELF_RESET",
        message: "Use the change-password flow to update your own password",
      });
      return;
    }

    // ── target must exist ─────────────────────────────────────────────────────
    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
      },
    });

    if (!target) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if (!target.isActive) {
      res.status(400).json({
        success: false,
        code: "USER_INACTIVE",
        message: "Cannot reset password for an inactive user",
      });
      return;
    }

    // ── validate password length at minimum (zod can do more) ────────────────
    if (!newPassword || newPassword.length < 8) {
      res.status(422).json({
        success: false,
        code: "WEAK_PASSWORD",
        message: "Password must be at least 8 characters",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction(async (tx) => {
      // 1. update password hash
      await tx.user.update({
        where: { id },
        data: { passwordHash },
      });

      // 2. nuke all refresh tokens → force re-login
      await tx.refreshToken.deleteMany({ where: { userId: id } });

      // 3. audit log
      await tx.auditLog.create({
        data: {
          actorId,
          action: "ADMIN_RESET_PASSWORD",
          module: "users",
          recordId: id,
          newData: { note: "Password reset by super admin" },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      // 4. in-house notification → target user
      await tx.notification.create({
        data: {
          userId: id,
          type: "STATUS_CHANGED", // closest semantic fit in your enum
          title: "Your password was reset",
          body: "An administrator has reset your password. Please log in with your new credentials.",
          referenceId: actorId, // actor who did it
          referenceType: "ASSIGNMENT", // placeholder — extend enum if needed
          isRead: false,
        },
      });
    });

    res.json({
      success: true,
      message: `Password reset for ${target.firstName} ${target.lastName}. All sessions invalidated.`,
    });
  } catch (err) {
    console.error("adminResetPassword:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to reset password" });
  }
};

// ─────────────────────────────────────────
// POST /users
// ─────────────────────────────────────────

export const createUser = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const actorId = req.user!.id;

    // ── existing validation guards (unchanged) ────────────────────────────────
    const emailExists = await prisma.user.findFirst({
      where: { email: body.email, isActive: true },
      select: { id: true },
    });
    if (emailExists) {
      res.status(409).json({ success: false, message: "Email already in use" });
      return;
    }

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

    const role = await prisma.role.findUnique({
      where: { id: body.roleId },
      select: { id: true },
    });
    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

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

    // ── generate password-setup token upfront ─────────────────────────────────
    const setupToken = crypto.randomBytes(32).toString("hex");
    const setupExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hrs

    // Use a placeholder hash — user hasn't set a real password yet
    const placeholderHash = await bcrypt.hash(
      crypto.randomBytes(16).toString("hex"),
      10,
    );

    // ── create user + audit log in one transaction ────────────────────────────
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: body.email,
          passwordHash: placeholderHash, // they'll set the real one via the link
          firstName: body.firstName,
          lastName: body.lastName,
          middleName: body.middleName ?? null,
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
          resetPasswordToken: setupToken, // reusing the same fields
          resetPasswordExpires: setupExpires,
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
          teamLead: { select: { id: true, firstName: true, lastName: true } },
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

    // ── send welcome email (outside transaction — failure won't roll back user) ─
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });

      // Reuses the same frontend route as forgot-password — token works identically
      const setupUrl = `${process.env.FRONTEND_URL}/sign-in?token=${setupToken}`;

      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: user.email,
        subject: "Welcome — Set up your password",
        html: `
          <h2>Welcome to the team, ${user.firstName}!</h2>

          <p>Your account has been created. Click below to set your password and get started:</p>

          <a href="${setupUrl}" style="
            display: inline-block;
            padding: 12px 24px;
            background: #4F46E5;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
          ">
            Set Your Password
          </a>

          <p style="color: #6B7280; font-size: 14px;">
            This link expires in 24 hours. If you weren't expecting this email, you can ignore it.
          </p>
        `,
      });
    } catch (mailErr) {
      // Log but don't fail the request — user is already created
      console.error("createUser: welcome email failed:", mailErr);
    }

    res.status(201).json({
      success: true,
      message: "User created. A password setup email has been sent.",
      data: user,
    });
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

    if (reportingToId) {
      const subtree = await getSubordinateIds(id);
      if (subtree.includes(reportingToId)) {
        res.status(400).json({
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
      res.status(400).json({
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
        phone: string | null;
        workingLocation: string | null;
        dateOfJoin: Date | null;
        isActive: boolean;
        depth: number;
        roleId: string;
        roleName: string;
        departmentId: string | null;
        departmentName: string | null;
      }[]
    >`
      WITH RECURSIVE org_tree AS (
        SELECT
          u.id, u."firstName", u."lastName", u."employeeId",
          u."reportingToId", u."teamLeadId",
          u.phone, u."workingLocation", u."dateOfJoin", u."isActive",
          u."roleId", u."departmentId",
          0 AS depth
        FROM "User" u
        WHERE u.id = ${id}

        UNION ALL

        SELECT
          u.id, u."firstName", u."lastName", u."employeeId",
          u."reportingToId", u."teamLeadId",
          u.phone, u."workingLocation", u."dateOfJoin", u."isActive",
          u."roleId", u."departmentId",
          ot.depth + 1
        FROM "User" u
        INNER JOIN org_tree ot ON u."reportingToId" = ot.id
      )
      SELECT
        ot.*,
        r.name  AS "roleName",
        d.name  AS "departmentName"
      FROM org_tree ot
      LEFT JOIN "Role"       r ON r.id = ot."roleId"
      LEFT JOIN "Department" d ON d.id = ot."departmentId"
      ORDER BY ot.depth
    `;

    if (rows.length === 0) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const userIds = rows.map((r) => r.id);

    const assignmentStats = await prisma.requirementAssignment.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: userIds }, status: "ACTIVE" },
      _count: { id: true },
      _sum: {
        submissionsCount: true,
        interviewsCount: true,
        filledOpenings: true,
        allocatedOpenings: true,
      },
    });

    const reqsCreated = await prisma.requirement.groupBy({
      by: ["createdById"],
      where: { createdById: { in: userIds }, deletedAt: null },
      _count: { id: true },
    });

    const spocs = await prisma.clientSpoc.findMany({
      where: { handlerId: { in: userIds }, isActive: true },
      select: {
        handlerId: true,
        isPrimary: true,
        client: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
      },
    });

    const statsMap = new Map(
      assignmentStats.map((s) => [
        s.assignedToId,
        {
          activeReqs: s._count.id,
          totalSubmissions: s._sum.submissionsCount ?? 0,
          totalInterviews: s._sum.interviewsCount ?? 0,
          totalFilled: s._sum.filledOpenings ?? 0,
          totalAllocated: s._sum.allocatedOpenings ?? 0,
        },
      ]),
    );

    const reqsMap = new Map(
      reqsCreated.map((r) => [r.createdById, r._count.id]),
    );

    const spocsMap = new Map<string, typeof spocs>();
    spocs.forEach((s) => {
      if (!spocsMap.has(s.handlerId)) spocsMap.set(s.handlerId, []);
      spocsMap.get(s.handlerId)!.push(s);
    });

    const map = new Map<string, any>();
    rows.forEach((r) => {
      const s = statsMap.get(r.id);
      map.set(r.id, {
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        employeeId: r.employeeId,
        reportingToId: r.reportingToId,
        teamLeadId: r.teamLeadId,
        phone: r.phone,
        workingLocation: r.workingLocation,
        dateOfJoin: r.dateOfJoin,
        isActive: r.isActive,
        role: { id: r.roleId, name: r.roleName },
        department: r.departmentId
          ? { id: r.departmentId, name: r.departmentName }
          : null,
        depth: r.depth,
        stats: {
          activeReqs: s?.activeReqs ?? 0,
          totalSubmissions: s?.totalSubmissions ?? 0,
          totalInterviews: s?.totalInterviews ?? 0,
          totalFilled: s?.totalFilled ?? 0,
          totalAllocated: s?.totalAllocated ?? 0,
          requirementsCreated: reqsMap.get(r.id) ?? 0,
          clientSpocs: spocsMap.get(r.id) ?? [],
        },
        children: [],
      });
    });

    rows.forEach((r) => {
      if (r.reportingToId && map.has(r.reportingToId) && r.id !== id) {
        map.get(r.reportingToId).children.push(map.get(r.id));
      }
    });

    res.json({ success: true, data: map.get(id) });
  } catch (err) {
    console.error("getUserTree:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch org tree" });
  }
};

// ─────────────────────────────────────────
// GET /users/:id/card
// ─────────────────────────────────────────

export const getUserCard = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        employeeId: true,
        email: true,
        phone: true,
        workingLocation: true,
        timezone: true,
        dateOfJoin: true,
        dateOfBirth: true,
        isActive: true,
        isSuperAdmin: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        reportingTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
          },
        },
        teamLead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
          },
        },
        subordinates: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
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
            role: { select: { id: true, name: true } },
          },
          orderBy: { firstName: "asc" },
        },
        assignmentsReceived: {
          orderBy: { assignedAt: "desc" },
          take: 30,
          select: {
            id: true,
            depth: true,
            status: true,
            allocatedOpenings: true,
            filledOpenings: true,
            submissionsCount: true,
            interviewsCount: true,
            assignedAt: true,
            removedAt: true,
            removedReason: true,
            deadline: true,
            deadlineMet: true,
            assignedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
                role: { select: { id: true, name: true } },
              },
            },
            parentAssignment: {
              select: {
                id: true,
                depth: true,
                assignedTo: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: { select: { id: true, name: true } },
                  },
                },
              },
            },
            childAssignments: {
              where: { status: "ACTIVE" },
              select: {
                id: true,
                depth: true,
                submissionsCount: true,
                interviewsCount: true,
                filledOpenings: true,
                allocatedOpenings: true,
                assignedTo: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    employeeId: true,
                    role: { select: { id: true, name: true } },
                  },
                },
              },
            },
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
                // interviewsScheduled: true,
                // offersRolledOut: true,
                // location: true,
                jobType: true,
                remoteType: true,
                // skills: true,
                respondBy: true,
                client: { select: { id: true, name: true, industry: true } },
                businessUnit: { select: { id: true, name: true } },
                serviceLine: { select: { id: true, name: true } },
              },
            },
          },
        },
        assignmentsGiven: {
          where: { status: "ACTIVE" },
          orderBy: { assignedAt: "desc" },
          take: 20,
          select: {
            id: true,
            depth: true,
            submissionsCount: true,
            interviewsCount: true,
            filledOpenings: true,
            allocatedOpenings: true,
            assignedAt: true,
            deadline: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
                role: { select: { id: true, name: true } },
              },
            },
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
        },
        requirementsCreated: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            // filledOpenings: true,
            // activeApplications: true,
            // interviewsScheduled: true,
            createdAt: true,
            client: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
          },
        },
        spocsHandled: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            department: true,
            email: true,
            phone: true,
            isPrimary: true,
            notes: true,
            createdAt: true,
            client: {
              select: {
                id: true,
                name: true,
                industry: true,
                city: true,
                country: true,
                _count: { select: { requirements: true } },
              },
            },
            serviceLine: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
            addedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        _count: {
          select: {
            subordinates: true,
            teamMembers: true,
            assignmentsReceived: { where: { status: "ACTIVE" } },
            assignmentsGiven: { where: { status: "ACTIVE" } },
            requirementsCreated: { where: { deletedAt: null } },
            spocsHandled: { where: { isActive: true } },
            spocsAdded: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const pipelineRows = await prisma.requirementCandidatePipeline.findMany({
      where: { assignment: { assignedToId: id } },
      select: {
        id: true,
        currentStage: { select: { id: true, code: true, label: true } },
      },
    });

    const totalCandidatesSourced = pipelineRows.length;

    const candidatesByStage = pipelineRows.reduce<Record<string, number>>(
      (acc, row) => {
        const label = row.currentStage.label;
        acc[label] = (acc[label] || 0) + 1;
        return acc;
      },
      {},
    );

    const activeAssignments = user.assignmentsReceived.filter(
      (a) => a.status === "ACTIVE",
    );

    const aggregateStats = {
      activeReqs: user._count.assignmentsReceived,
      totalSubmissions: activeAssignments.reduce(
        (s, a) => s + a.submissionsCount,
        0,
      ),
      totalInterviews: activeAssignments.reduce(
        (s, a) => s + a.interviewsCount,
        0,
      ),
      totalFilled: activeAssignments.reduce((s, a) => s + a.filledOpenings, 0),
      totalAllocated: activeAssignments.reduce(
        (s, a) => s + (a.allocatedOpenings ?? 0),
        0,
      ),
      totalAssignmentsGiven: user._count.assignmentsGiven,
      requirementsCreated: user._count.requirementsCreated,
      spocsHandledCount: user._count.spocsHandled,
      spocsAddedCount: user._count.spocsAdded,
      candidatesSourced: totalCandidatesSourced,
      candidatesByStage,
    };

    res.json({
      success: true,
      data: { ...user, aggregateStats },
    });
  } catch (err) {
    console.error("getUserCard:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch user card" });
  }
};

// ─────────────────────────────────────────
// GET /users/subordinates
// ─────────────────────────────────────────

// export const getMySubordinates = async (req: Request, res: Response) => {
//   try {
//     const userId = req.user!.id;

//     const USER_SELECT = {
//       id: true,
//       firstName: true,
//       lastName: true,
//       email: true,
//       employeeId: true,
//       reportingToId: true,
//       teamLeadId: true,
//       department: { select: { id: true, name: true } },
//       role: { select: { id: true, name: true } },
//     } as const;

//     const [reportees, extras] = await Promise.all([
//       prisma.user.findMany({
//         where: {
//           isActive: true,
//           OR: [{ reportingToId: userId }, { teamLeadId: userId }],
//         },
//         select: USER_SELECT,
//         orderBy: { firstName: "asc" },
//       }),
//       prisma.userAssignableTo.findMany({
//         where: {
//           userId,
//           target: { isActive: true },
//         },
//         select: {
//           target: { select: USER_SELECT },
//         },
//       }),
//     ]);

//     const seen = new Set<string>();
//     const merged: ((typeof reportees)[number] & {
//       _source: "chain" | "extra";
//     })[] = [];

//     for (const u of reportees) {
//       if (!seen.has(u.id)) {
//         seen.add(u.id);
//         merged.push({ ...u, _source: "chain" });
//       }
//     }
//     for (const e of extras) {
//       if (!seen.has(e.target.id)) {
//         seen.add(e.target.id);
//         merged.push({ ...e.target, _source: "extra" });
//       }
//     }

//     merged.sort((a, b) => a.firstName.localeCompare(b.firstName));

//     res.json({ success: true, data: merged });
//   } catch (err) {
//     console.error("getMySubordinates:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch subordinates" });
//   }
// };

export const getMySubordinates = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const USER_SELECT = {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employeeId: true,
      reportingToId: true,
      teamLeadId: true,
      department: { select: { id: true, name: true } },
      role: { select: { id: true, name: true } },
    } as const;

    const [reportees, extras] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          OR: [{ reportingToId: userId }, { teamLeadId: userId }],
        },
        select: USER_SELECT,
        orderBy: { firstName: "asc" },
      }),
      prisma.userAssignableTo.findMany({
        where: { userId, target: { isActive: true } },
        select: { target: { select: USER_SELECT } },
      }),
    ]);

    const seen = new Set<string>();
    const merged: ((typeof reportees)[number] & {
      _source: "chain" | "extra" | "self";
    })[] = [];

    // ── Push self first so they appear at the top of the picker ──
    seen.add(userId);
    merged.push({
      id: req.user!.id,
      firstName: req.user!.firstName,
      lastName: req.user!.lastName,
      email: req.user!.email,
      employeeId: req.user!.employeeId ?? null,
      reportingToId: req.user!.reportingToId ?? null,
      teamLeadId: req.user!.teamLeadId ?? null,
      department: req.user!.department ?? null,
      role: req.user!.role,
      _source: "self",
    });

    for (const u of reportees) {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        merged.push({ ...u, _source: "chain" });
      }
    }
    for (const e of extras) {
      if (!seen.has(e.target.id)) {
        seen.add(e.target.id);
        merged.push({ ...e.target, _source: "extra" });
      }
    }

    // self stays pinned at top, rest sorted alpha
    const [self, ...rest] = merged;
    rest.sort((a, b) => a.firstName.localeCompare(b.firstName));

    res.json({ success: true, data: [self, ...rest] });
  } catch (err) {
    console.error("getMySubordinates:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch subordinates" });
  }
};

// Single source for team-role filter options — keep in sync with the teamRole branch in listUsers
const TEAM_ROLE_FILTERS = [
  { value: "LEAD", label: "Lead" },
  { value: "CO_LEAD", label: "Co-Lead" },
  { value: "MEMBER", label: "Member" },
] as const;

// ─────────────────────────────────────────
// GET /users/filter-options?reportingToId=
// ─────────────────────────────────────────

export const getUserFilterOptions = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const { reportingToId } = req.query as Record<string, string | undefined>;

    // RBAC scope — null = everyone (super admin)
    let visibleIds: string[] | null = null;
    if (!isSuperAdmin) {
      const subs = await getSubordinateIds(userId);
      visibleIds = [userId, ...subs];
    }
    const visibleSet = visibleIds ? new Set(visibleIds) : null;
    const scope: any = visibleIds ? { id: { in: visibleIds } } : {};

    // Non-admin can't pivot onto a manager outside their own tree
    if (reportingToId && visibleSet && !visibleSet.has(reportingToId)) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    // Team leads narrow to the selected manager's subtree (manager included)
    let leadScope: any = scope;
    if (reportingToId) {
      const subtree = [
        reportingToId,
        ...(await getSubordinateIds(reportingToId)),
      ];
      leadScope = {
        id: {
          in: visibleSet ? subtree.filter((id) => visibleSet.has(id)) : subtree,
        },
      };
    }

    const PERSON = {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
    } as const;

    const [deptRows, roleRows, reportingTo, teamLeads] = await Promise.all([
      prisma.user.findMany({
        where: { ...scope, departmentId: { not: null } },
        select: { department: { select: { id: true, name: true } } },
        distinct: ["departmentId"],
      }),
      prisma.user.findMany({
        where: scope,
        select: { role: { select: { id: true, name: true } } },
        distinct: ["roleId"],
      }),
      // Managers = anyone in scope who has at least one subordinate
      prisma.user.findMany({
        where: { ...scope, isActive: true, subordinates: { some: {} } },
        select: PERSON,
        orderBy: { firstName: "asc" },
      }),
      // Team leads = anyone in lead-scope with active team members
      prisma.user.findMany({
        where: {
          ...leadScope,
          isActive: true,
          teamMembers: { some: { isActive: true } },
        },
        select: PERSON,
        orderBy: { firstName: "asc" },
      }),
    ]);

    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);

    res.json({
      success: true,
      data: {
        departments: deptRows
          .map((r) => r.department)
          .filter((d): d is { id: string; name: string } => !!d)
          .sort(byName),
        roles: roleRows
          .map((r) => r.role)
          .filter((r): r is { id: string; name: string } => !!r)
          .sort(byName),
        reportingTo,
        teamLeads,
        teamRoles: TEAM_ROLE_FILTERS,
      },
    });
  } catch (err) {
    console.error("getUserFilterOptions:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch filter options" });
  }
};
