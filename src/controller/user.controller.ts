import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "@/utils/prisma/client";
import { buildScopeWhere } from "@/utils/buildScopeWhere";
import type {
  CreateUserInput,
  UpdateUserInput,
  ListUsersQuery,
  DeactivateInput,
} from "@/validators/user.validators";

// ─────────────────────────────────────────
// LIST USERS
// GET /api/users
//
// Scope applied automatically via req.scopeFilter.
// Controller never reads role name — only scopeFilter.
// User's explicit query filters merge ON TOP of scope.
// ─────────────────────────────────────────

export const listUsers = async (req: Request, res: Response) => {
  try {
    const {
      search,
      buId,
      roleId,
      isActive,
      teamId,
      teamRole,
      isClientHandler,
      isContactOwner,
      page = "1",
      limit = "20",
    } = req.query as ListUsersQuery;

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (p - 1) * l;

    // ── Step 1: scope WHERE — hard boundary ──────────────────────────────────
    const scopeWhere = buildScopeWhere(req.scopeFilter, "users");

    // ── Step 2: explicit filters — narrow within scope ───────────────────────
    const filterWhere: Record<string, any> = {
      ...(buId ? { businessUnitId: buId } : {}),
      ...(roleId ? { roleId } : {}),
      ...(isActive !== undefined ? { isActive: isActive === "true" } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { employeeId: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(teamId
        ? {
            teamMemberships: {
              some: {
                teamId,
                isActive: true,
                ...(teamRole ? { teamRole } : {}),
              },
            },
          }
        : teamRole
        ? { teamMemberships: { some: { teamRole, isActive: true } } }
        : {}),
      ...(isClientHandler === "true"
        ? { clientHandlerEntries: { some: { status: "ACTIVE" } } }
        : {}),
      ...(isContactOwner === "true"
        ? { clientContactsOwned: { some: { status: "ACTIVE" } } }
        : {}),
    };

    // ── Step 3: AND merge — scope cannot be bypassed ─────────────────────────
    const where =
      Object.keys(scopeWhere).length > 0
        ? { AND: [scopeWhere, filterWhere] }
        : filterWhere;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: l,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
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
          role: { select: { id: true, name: true, description: true } },
          businessUnit: { select: { id: true, name: true } },
          reportingTo: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          teamMemberships: {
            where: { isActive: true },
            select: {
              teamRole: true,
              joinedAt: true,
              team: { select: { id: true, name: true, category: true } },
            },
          },
          clientHandlerEntries: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              role: true,
              client: { select: { id: true, name: true } },
            },
          },
          _count: { select: { clientContactsOwned: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l),
      },
      // Frontend uses this to show/hide Create button + row actions
      permissions: req.modulePermission,
    });
  } catch (err) {
    console.error("listUsers error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
};

// ─────────────────────────────────────────
// GET USER BY ID
// GET /api/users/:id
// ─────────────────────────────────────────

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const scopeWhere = buildScopeWhere(req.scopeFilter, "users");
    if (Object.keys(scopeWhere).length > 0) {
      const accessible = await prisma.user.findFirst({
        where: { AND: [{ id }, scopeWhere] },
        select: { id: true },
      });
      if (!accessible) {
        res.status(403).json({
          success: false,
          message: "You don't have access to this user",
          code: "FORBIDDEN",
        });
        return;
      }
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        nickName: true,
        displayName: true,
        email: true,
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
        role: {
          select: {
            id: true,
            name: true,
            description: true,
            isSystem: true,
            permissions: {
              select: {
                module: true,
                canView: true,
                canAdd: true,
                canEdit: true,
                canDelete: true,
                scope: true,
              },
            },
          },
        },
        businessUnit: { select: { id: true, name: true } },
        reportingTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
          },
        },
        subordinates: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
          },
        },
        teamMemberships: {
          select: {
            id: true,
            teamRole: true,
            isActive: true,
            joinedAt: true,
            deactivatedAt: true,
            team: {
              select: {
                id: true,
                name: true,
                category: true,
                nodeType: true,
                // NO parentTeam — hierarchy is via TeamEdge only
                businessUnit: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { joinedAt: "desc" },
        },
        clientHandlerEntries: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            role: true,
            client: { select: { id: true, name: true, status: true } },
          },
        },
        clientContactsOwned: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: true,
            client: { select: { id: true, name: true } },
          },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.json({ success: true, data: user, permissions: req.modulePermission });
  } catch (err) {
    console.error("getUserById error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch user" });
  }
};

// ─────────────────────────────────────────
// CREATE USER
// POST /api/users
// canAdd enforced at route level via checkPermission("canAdd")
// ─────────────────────────────────────────

export const createUser = async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateUserInput;
    const actorId = req.user!.id;

    // Non-ALL actors can only create in their own BU
    if (
      req.scopeFilter.type !== "ALL" &&
      body.businessUnitId &&
      body.businessUnitId !== req.scopeFilter.businessUnitId
    ) {
      res.status(403).json({
        success: false,
        message: "You can only create users within your own Business Unit",
      });
      return;
    }

    const [emailExists, empIdExists] = await Promise.all([
      prisma.user.findUnique({ where: { email: body.email } }),
      body.employeeId
        ? prisma.user.findUnique({ where: { employeeId: body.employeeId } })
        : null,
    ]);

    if (emailExists) {
      res.status(409).json({ success: false, message: "Email already in use" });
      return;
    }
    if (empIdExists) {
      res
        .status(409)
        .json({ success: false, message: "Employee ID already in use" });
      return;
    }

    const role = await prisma.role.findUnique({ where: { id: body.roleId } });
    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        passwordHash,
        roleId: body.roleId,
        businessUnitId: body.businessUnitId ?? null,
        employeeId: body.employeeId ?? null,
        phone: body.phone ?? null,
        reportingToId: body.reportingToId ?? null,
        dateOfJoin: body.dateOfJoin ? new Date(body.dateOfJoin) : null,
        workingLocation: body.workingLocation ?? null,
        timezone: body.timezone ?? null,
        createdById: actorId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeId: true,
        isActive: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "CREATE",
        module: "users",
        recordId: user.id,
        newData: { email: user.email, role: user.role.name },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.status(201).json({
      success: true,
      data: user,
      message: "User created successfully",
    });
  } catch (err) {
    console.error("createUser error:", err);
    res.status(500).json({ success: false, message: "Failed to create user" });
  }
};

// ─────────────────────────────────────────
// UPDATE USER
// PUT /api/users/:id
// canEdit enforced at route level
// ─────────────────────────────────────────

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateUserInput;
    const actorId = req.user!.id;

    const scopeWhere = buildScopeWhere(req.scopeFilter, "users");
    if (Object.keys(scopeWhere).length > 0) {
      const accessible = await prisma.user.findFirst({
        where: { AND: [{ id }, scopeWhere] },
        select: { id: true },
      });
      if (!accessible) {
        res.status(403).json({
          success: false,
          message: "You don't have access to edit this user",
        });
        return;
      }
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if (body.email && body.email !== existing.email) {
      const clash = await prisma.user.findUnique({
        where: { email: body.email },
      });
      if (clash) {
        res
          .status(409)
          .json({ success: false, message: "Email already in use" });
        return;
      }
    }
    if (body.employeeId && body.employeeId !== existing.employeeId) {
      const clash = await prisma.user.findUnique({
        where: { employeeId: body.employeeId },
      });
      if (clash) {
        res
          .status(409)
          .json({ success: false, message: "Employee ID already in use" });
        return;
      }
    }

    const oldData = {
      firstName: existing.firstName,
      lastName: existing.lastName,
      email: existing.email,
      roleId: existing.roleId,
      businessUnitId: existing.businessUnitId,
    };

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
        ...(body.businessUnitId !== undefined
          ? { businessUnitId: body.businessUnitId }
          : {}),
        ...(body.employeeId !== undefined
          ? { employeeId: body.employeeId }
          : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.reportingToId !== undefined
          ? { reportingToId: body.reportingToId }
          : {}),
        ...(body.dateOfJoin !== undefined
          ? { dateOfJoin: body.dateOfJoin ? new Date(body.dateOfJoin) : null }
          : {}),
        ...(body.workingLocation !== undefined
          ? { workingLocation: body.workingLocation }
          : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.displayName !== undefined
          ? { displayName: body.displayName }
          : {}),
        ...(body.nickName !== undefined ? { nickName: body.nickName } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeId: true,
        isActive: true,
        updatedAt: true,
        role: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "UPDATE",
        module: "users",
        recordId: id,
        oldData,
        newData: body,
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.json({
      success: true,
      data: updated,
      message: "User updated successfully",
    });
  } catch (err) {
    console.error("updateUser error:", err);
    res.status(500).json({ success: false, message: "Failed to update user" });
  }
};

// ─────────────────────────────────────────
// DEACTIVATE
// PUT /api/users/:id/deactivate
// ─────────────────────────────────────────

export const deactivateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as DeactivateInput;
    const actorId = req.user!.id;

    if (id === actorId) {
      res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
      return;
    }

    const scopeWhere = buildScopeWhere(req.scopeFilter, "users");
    if (Object.keys(scopeWhere).length > 0) {
      const accessible = await prisma.user.findFirst({
        where: { AND: [{ id }, scopeWhere] },
        select: { id: true },
      });
      if (!accessible) {
        res.status(403).json({
          success: false,
          message: "You don't have access to deactivate this user",
        });
        return;
      }
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }
    if (!existing.isActive) {
      res
        .status(400)
        .json({ success: false, message: "User is already inactive" });
      return;
    }

    await prisma.user.update({ where: { id }, data: { isActive: false } });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "DEACTIVATE",
        module: "users",
        recordId: id,
        newData: { reason: reason ?? null },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.json({ success: true, message: "User deactivated successfully" });
  } catch (err) {
    console.error("deactivateUser error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to deactivate user" });
  }
};

// ─────────────────────────────────────────
// REACTIVATE
// PUT /api/users/:id/reactivate
// ─────────────────────────────────────────

export const reactivateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    const scopeWhere = buildScopeWhere(req.scopeFilter, "users");
    if (Object.keys(scopeWhere).length > 0) {
      const accessible = await prisma.user.findFirst({
        where: { AND: [{ id }, scopeWhere] },
        select: { id: true },
      });
      if (!accessible) {
        res.status(403).json({
          success: false,
          message: "You don't have access to reactivate this user",
        });
        return;
      }
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }
    if (existing.isActive) {
      res
        .status(400)
        .json({ success: false, message: "User is already active" });
      return;
    }

    await prisma.user.update({ where: { id }, data: { isActive: true } });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "REACTIVATE",
        module: "users",
        recordId: id,
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.json({ success: true, message: "User reactivated successfully" });
  } catch (err) {
    console.error("reactivateUser error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to reactivate user" });
  }
};

// ─────────────────────────────────────────
// FORM DATA
// GET /api/users/form-data
// ─────────────────────────────────────────

export const getUserFormData = async (req: Request, res: Response) => {
  try {
    const [roles, businessUnits] = await Promise.all([
      prisma.role.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true },
      }),
      prisma.businessUnit.findMany({
        where: {
          isActive: true,
          ...(req.scopeFilter.type !== "ALL" && req.scopeFilter.businessUnitId
            ? { id: req.scopeFilter.businessUnitId }
            : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    res.json({ success: true, data: { roles, businessUnits } });
  } catch (err) {
    console.error("getUserFormData error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch form data" });
  }
};

// ─────────────────────────────────────────
// SEARCH — lazy search for reportingTo dropdown
// GET /api/users/search?q=&buId=
// ─────────────────────────────────────────

export const searchUsers = async (req: Request, res: Response) => {
  try {
    const { q = "", buId } = req.query as { q?: string; buId?: string };

    const scopeWhere = buildScopeWhere(req.scopeFilter, "users");
    const filterWhere: Record<string, any> = {
      isActive: true,
      ...(buId ? { businessUnitId: buId } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const where =
      Object.keys(scopeWhere).length > 0
        ? { AND: [scopeWhere, filterWhere] }
        : filterWhere;

    const users = await prisma.user.findMany({
      where,
      take: 20,
      orderBy: [{ firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeId: true,
        role: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: users });
  } catch (err) {
    console.error("searchUsers error:", err);
    res.status(500).json({ success: false, message: "Search failed" });
  }
};
