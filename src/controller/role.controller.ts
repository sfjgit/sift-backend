import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import type {
  CreateRoleInput,
  UpdateRoleInput,
} from "@/validators/role.validator";

// ─────────────────────────────────────────
// LIST ROLES
// GET /roles
// Returns all roles with user count + permission count
// ─────────────────────────────────────────

export const listRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            permissions: true,
          },
        },
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
    });

    res.json({ success: true, data: roles });
  } catch (err) {
    console.error("listRoles error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch roles" });
  }
};

// ─────────────────────────────────────────
// GET ROLE BY ID
// GET /roles/:id
// Full detail — permissions matrix + users assigned
// ─────────────────────────────────────────

export const getRoleById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const role = await prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
        permissions: {
          select: {
            id: true,
            module: true,
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            scope: true,
          },
          orderBy: { module: "asc" },
        },
        users: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
            businessUnit: { select: { id: true, name: true } },
          },
          take: 50, // cap at 50 for display
          orderBy: { firstName: "asc" },
        },
        _count: {
          select: { users: true, permissions: true },
        },
      },
    });

    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    res.json({ success: true, data: role });
  } catch (err) {
    console.error("getRoleById error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch role" });
  }
};

// ─────────────────────────────────────────
// GET MODULES
// GET /roles/modules
// Distinct module names from all RolePermission rows.
// Used to build the permissions matrix form dynamically.
// ─────────────────────────────────────────

export const getModules = async (req: Request, res: Response) => {
  try {
    const rows = await prisma.rolePermission.findMany({
      distinct: ["module"],
      select: { module: true },
      orderBy: { module: "asc" },
    });

    const modules = rows.map((r) => r.module);

    res.json({ success: true, data: modules });
  } catch (err) {
    console.error("getModules error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch modules" });
  }
};

// ─────────────────────────────────────────
// CREATE ROLE
// POST /roles
// ─────────────────────────────────────────

export const createRole = async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateRoleInput;
    const actorId = req.user!.id;

    // Name uniqueness check
    const existing = await prisma.role.findUnique({
      where: { name: body.name },
    });
    if (existing) {
      res
        .status(409)
        .json({ success: false, message: "Role name already exists" });
      return;
    }

    const role = await prisma.role.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        isSystem: false, // user-created roles are never system roles
        permissions: {
          create: body.permissions.map((p) => ({
            module: p.module,
            canView: p.canView,
            canAdd: p.canAdd,
            canEdit: p.canEdit,
            canDelete: p.canDelete,
            scope: p.scope,
          })),
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
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
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "CREATE",
        module: "roles",
        recordId: role.id,
        newData: { name: role.name },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.status(201).json({
      success: true,
      data: role,
      message: "Role created successfully",
    });
  } catch (err) {
    console.error("createRole error:", err);
    res.status(500).json({ success: false, message: "Failed to create role" });
  }
};

// ─────────────────────────────────────────
// UPDATE ROLE
// PUT /roles/:id
// Wipes and recreates permissions on every update
// so the matrix stays in sync with what frontend sends
// ─────────────────────────────────────────

export const updateRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateRoleInput;
    const actorId = req.user!.id;

    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    // Block renaming system roles
    if (existing.isSystem && body.name && body.name !== existing.name) {
      res.status(403).json({
        success: false,
        message: "System role names cannot be changed",
      });
      return;
    }

    // Name uniqueness if changing
    if (body.name && body.name !== existing.name) {
      const clash = await prisma.role.findUnique({
        where: { name: body.name },
      });
      if (clash) {
        res
          .status(409)
          .json({ success: false, message: "Role name already exists" });
        return;
      }
    }

    const oldData = {
      name: existing.name,
      description: existing.description,
    };

    // Transaction — update role + wipe+recreate permissions atomically
    const updated = await prisma.$transaction(async (tx) => {
      // Update role metadata
      const role = await tx.role.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
        },
      });

      // Wipe and recreate permissions if provided
      if (body.permissions && body.permissions.length > 0) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: body.permissions.map((p) => ({
            roleId: id,
            module: p.module,
            canView: p.canView,
            canAdd: p.canAdd,
            canEdit: p.canEdit,
            canDelete: p.canDelete,
            scope: p.scope,
          })),
        });
      }

      return role;
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "UPDATE",
        module: "roles",
        recordId: id,
        oldData,
        newData: { name: body.name, description: body.description },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.json({
      success: true,
      data: updated,
      message: "Role updated successfully",
    });
  } catch (err) {
    console.error("updateRole error:", err);
    res.status(500).json({ success: false, message: "Failed to update role" });
  }
};

// ─────────────────────────────────────────
// DELETE ROLE
// DELETE /roles/:id
// Blocked if: isSystem OR has active users assigned
// ─────────────────────────────────────────

export const deleteRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    const role = await prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isSystem: true,
        _count: { select: { users: true } },
      },
    });

    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    if (role.isSystem) {
      res.status(403).json({
        success: false,
        message: "System roles cannot be deleted",
      });
      return;
    }

    if (role._count.users > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — ${role._count.users} user(s) are assigned to this role. Reassign them first.`,
      });
      return;
    }

    // Cascade deletes RolePermission rows via schema onDelete: Cascade
    await prisma.role.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "DELETE",
        module: "roles",
        recordId: id,
        oldData: { name: role.name },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.json({ success: true, message: "Role deleted successfully" });
  } catch (err) {
    console.error("deleteRole error:", err);
    res.status(500).json({ success: false, message: "Failed to delete role" });
  }
};
