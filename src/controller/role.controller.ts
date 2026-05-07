import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import type {
  CreateRoleInput,
  UpdateRoleInput,
} from "@/validators/role.validator";

// ─────────────────────────────────────────────────────────────────────────────
// ALL modules in the system — hardcoded, not derived from DB
// This is the source of truth for what modules exist.
// Adding a new module here makes it appear in the permissions matrix immediately.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_MODULES = [
  "requirements",
  "clients",
  "candidates",
  "users",
  "roles",
  "business-units",
  "departments",
  "service-lines",
  "audit-logs",
  "reports",
  "settings",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /roles/modules
// Always returns the full system module list.
// No longer depends on what permissions exist in DB.
// ─────────────────────────────────────────────────────────────────────────────

export const getModules = async (_req: Request, res: Response) => {
  res.json({ success: true, data: SYSTEM_MODULES });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /roles
// ─────────────────────────────────────────────────────────────────────────────

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
        _count: { select: { users: true, permissions: true } },
        permissions: {
          select: {
            module: true,
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            canViewScope: true,
            canAddScope: true,
            canEditScope: true,
            canDeleteScope: true,
          },
        },
      },
    });

    res.json({ success: true, data: roles });
  } catch (err) {
    console.error("listRoles:", err);
    res.status(500).json({ success: false, message: "Failed to fetch roles" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /roles/:id
// ─────────────────────────────────────────────────────────────────────────────

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
        _count: { select: { users: true, permissions: true } },
        permissions: {
          select: {
            id: true,
            module: true,
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            canViewScope: true,
            canAddScope: true,
            canEditScope: true,
            canDeleteScope: true,
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
          },
          take: 50,
          orderBy: { firstName: "asc" },
        },
      },
    });

    if (!role) {
      res.status(404).json({ success: false, message: "Role not found" });
      return;
    }

    // Merge DB permissions with full module list so frontend always gets all modules.
    // Modules with no saved permission get default "no access" values.
    const permissionsByModule = Object.fromEntries(
      role.permissions.map((p) => [p.module, p])
    );

    const fullPermissions = SYSTEM_MODULES.map((module) => ({
      module,
      canView: false,
      canAdd: false,
      canEdit: false,
      canDelete: false,
      canViewScope: "OWN" as const,
      canAddScope: "OWN" as const,
      canEditScope: "OWN" as const,
      canDeleteScope: "OWN" as const,
      ...(permissionsByModule[module] ?? {}),
    }));

    res.json({
      success: true,
      data: {
        ...role,
        permissions: fullPermissions,
        modules: SYSTEM_MODULES,
      },
    });
  } catch (err) {
    console.error("getRoleById:", err);
    res.status(500).json({ success: false, message: "Failed to fetch role" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /roles
// ─────────────────────────────────────────────────────────────────────────────

export const createRole = async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateRoleInput;
    const actorId = req.user!.id;

    const existing = await prisma.role.findUnique({
      where: { name: body.name },
    });
    if (existing) {
      res
        .status(409)
        .json({ success: false, message: "Role name already exists" });
      return;
    }

    // Only save permissions where at least one action is enabled
    const activePermissions = (body.permissions ?? []).filter(
      (p) => p.canView || p.canAdd || p.canEdit || p.canDelete
    );

    const role = await prisma.role.create({
      data: {
        name: body.name.trim().toUpperCase().replace(/\s+/g, "_"),
        description: body.description ?? null,
        isSystem: false,
        permissions: {
          create: activePermissions.map((p) => ({
            module: p.module,
            canView: p.canView,
            canAdd: p.canAdd,
            canEdit: p.canEdit,
            canDelete: p.canDelete,
            canViewScope: p.canViewScope,
            canAddScope: p.canAddScope,
            canEditScope: p.canEditScope,
            canDeleteScope: p.canDeleteScope,
          })),
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
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

    res
      .status(201)
      .json({ success: true, data: role, message: "Role created" });
  } catch (err) {
    console.error("createRole:", err);
    res.status(500).json({ success: false, message: "Failed to create role" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /roles/:id
// Wipes and recreates only the active permissions.
// ─────────────────────────────────────────────────────────────────────────────

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

    if (existing.isSystem && body.name && body.name !== existing.name) {
      res.status(403).json({
        success: false,
        message: "System role names cannot be changed",
      });
      return;
    }

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

    // Only persist permissions with at least one action enabled
    const activePermissions = (body.permissions ?? []).filter(
      (p) => p.canView || p.canAdd || p.canEdit || p.canDelete
    );

    const updated = await prisma.$transaction(async (tx) => {
      const role = await tx.role.update({
        where: { id },
        data: {
          ...(body.name !== undefined && {
            name: body.name.trim().toUpperCase().replace(/\s+/g, "_"),
          }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
        },
      });

      if (body.permissions !== undefined) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (activePermissions.length > 0) {
          await tx.rolePermission.createMany({
            data: activePermissions.map((p) => ({
              roleId: id,
              module: p.module,
              canView: p.canView,
              canAdd: p.canAdd,
              canEdit: p.canEdit,
              canDelete: p.canDelete,
              canViewScope: p.canViewScope,
              canAddScope: p.canAddScope,
              canEditScope: p.canEditScope,
              canDeleteScope: p.canDeleteScope,
            })),
          });
        }
      }

      return role;
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "UPDATE",
        module: "roles",
        recordId: id,
        oldData: { name: existing.name },
        newData: { name: body.name },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.json({ success: true, data: updated, message: "Role updated" });
  } catch (err) {
    console.error("updateRole:", err);
    res.status(500).json({ success: false, message: "Failed to update role" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /roles/:id
// ─────────────────────────────────────────────────────────────────────────────

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
      res
        .status(403)
        .json({ success: false, message: "System roles cannot be deleted" });
      return;
    }
    if (role._count.users > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — ${role._count.users} user(s) assigned. Reassign them first.`,
      });
      return;
    }

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

    res.json({ success: true, message: "Role deleted" });
  } catch (err) {
    console.error("deleteRole:", err);
    res.status(500).json({ success: false, message: "Failed to delete role" });
  }
};
