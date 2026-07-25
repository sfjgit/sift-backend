// File: role.controller.ts
// Path: src/controller/role.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { PermissionScope, Prisma } from "@prisma/client";
import type {
  CreateRoleInput,
  UpdateRoleInput,
} from "@/validators/role.validator";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM MODULES — source of truth for what modules exist in the app
// Add a new module here → it appears in the permissions matrix immediately
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_MODULES = [
  "requirements",
  "assignments",
  "clients",
  "candidates",
  "users",
  "roles",
  "business-units",
  "departments",
  "service-lines",
  "pipeline-stages",
  "audit-logs",
  "auth-logs",
  "reports",
  "settings",
  // "assignments",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /roles/modules
// ─────────────────────────────────────────────────────────────────────────────

export const getModules = async (_req: Request, res: Response) => {
  res.json({ success: true, data: SYSTEM_MODULES });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /roles/scopes
// Reads PermissionScope enum values directly from Prisma client —
// always in sync with schema.prisma, zero manual maintenance
// ─────────────────────────────────────────────────────────────────────────────

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  OWN: "Only records I created or own",
  TEAM: "My team members (via team lead assignment)",
  REPORTING: "My direct reports (one level down)",
  REPORTING_LINE: "My entire reporting hierarchy (all levels below me)",
  DEPARTMENT: "Everyone in my department",
  BU: "Everyone in my business unit subtree",
  ALL: "All records across the organization",
};

export const getScopes = async (_req: Request, res: Response) => {
  const scopeValues = Object.values(PermissionScope);
  const data = scopeValues.map((value) => ({
    value,
    label: value.replace(/_/g, " "),
    desc: SCOPE_DESCRIPTIONS[value] ?? value,
  }));
  res.json({ success: true, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — build a permission create/upsert data object
// Casts scope strings to PermissionScope enum so Prisma doesn't complain
// ─────────────────────────────────────────────────────────────────────────────

function toPermissionData(
  p: CreateRoleInput["permissions"][number],
  roleId?: string,
) {
  return {
    ...(roleId ? { roleId } : {}),
    module: p.module,
    canView: p.canView,
    canAdd: p.canAdd,
    canEdit: p.canEdit,
    canDelete: p.canDelete,
    canViewScope: p.canViewScope as PermissionScope,
    canAddScope: p.canAddScope as PermissionScope,
    canEditScope: p.canEditScope as PermissionScope,
    canDeleteScope: p.canDeleteScope as PermissionScope,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /roles
// ─────────────────────────────────────────────────────────────────────────────

export const listRoles = async (_req: Request, res: Response) => {
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

    // Merge DB permissions with full module list — modules with no saved
    // permission get default "no access" values so the matrix always has all rows
    const permissionsByModule = Object.fromEntries(
      role.permissions.map((p) => [p.module, p]),
    );

    const fullPermissions = SYSTEM_MODULES.map((module) => ({
      module,
      canView: false,
      canAdd: false,
      canEdit: false,
      canDelete: false,
      canViewScope: "OWN" as PermissionScope,
      canAddScope: "OWN" as PermissionScope,
      canEditScope: "OWN" as PermissionScope,
      canDeleteScope: "OWN" as PermissionScope,
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

    // Only persist rows where at least one action is enabled
    const activePermissions = (body.permissions ?? []).filter(
      (p) => p.canView || p.canAdd || p.canEdit || p.canDelete,
    );

    const role = await prisma.role.create({
      data: {
        name: body.name.trim().toUpperCase().replace(/\s+/g, "_"),
        description: body.description ?? null,
        isSystem: false,
        permissions: {
          create: activePermissions.map((p) => toPermissionData(p)),
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
// PUT /roles/:id — wipes and recreates active permissions
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

    const activePermissions = (body.permissions ?? []).filter(
      (p) => p.canView || p.canAdd || p.canEdit || p.canDelete,
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
            data: activePermissions.map((p) => toPermissionData(p, id)),
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
