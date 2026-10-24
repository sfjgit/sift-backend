// File: role.controller.ts
// Path: src/controller/role.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { createAuditLog } from "@/services/auditLogs.service";
import { bustRolePermissionCache } from "@/services/permission.service";
import { toGrantRows } from "@/controller/permission.controller";
import { ApiError, notFound } from "@/utils/httpError";

// ── GET /roles — any logged-in user (role pickers)
export const listRoles = async (_req: Request, res: Response) => {
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
    },
  });

  res.json({ success: true, data: roles });
};

// ── GET /roles/:id
export const getRoleById = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const role = await prisma.role.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      createdAt: true,
      updatedAt: true,
      permissions: { select: { permissionKey: true, scope: true } },
      users: {
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: { firstName: "asc" },
        take: 50,
      },
      _count: { select: { users: true } },
    },
  });

  if (!role) throw notFound("Role");

  res.json({ success: true, data: role });
};

// ── POST /roles
export const createRole = async (req: Request, res: Response) => {
  const { name, description, grants } = req.validatedBody;

  const role = await prisma.role.create({
    data: {
      name,
      description: description ?? null,
      permissions: { create: toGrantRows(grants) },
    },
    select: { id: true, name: true, description: true, isSystem: true, createdAt: true },
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "CREATE",
    module: "roles",
    recordId: role.id,
    newData: { name, grants },
    req,
  });

  res.status(201).json({ success: true, message: "Role created", data: role });
};

// ── PUT /roles/:id — name / description only; grants go through /roles/:id/permissions
export const updateRole = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody;

  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) throw notFound("Role");
  if (existing.isSystem) throw ApiError(400, "System roles cannot be edited", "SYSTEM_ROLE");

  const updated = await prisma.role.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
    },
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "UPDATE",
    module: "roles",
    recordId: id,
    oldData: { name: existing.name, description: existing.description },
    newData: body,
    req,
  });

  res.json({ success: true, message: "Role updated", data: updated });
};

// ── DELETE /roles/:id
export const deleteRole = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const role = await prisma.role.findUnique({
    where: { id },
    select: { name: true, isSystem: true, _count: { select: { users: true } } },
  });

  if (!role) throw notFound("Role");
  if (role.isSystem) throw ApiError(400, "System roles cannot be deleted", "SYSTEM_ROLE");
  if (role._count.users > 0) {
    throw ApiError(
      409,
      `Cannot delete — ${role._count.users} user(s) assigned. Reassign them first.`,
      "ROLE_IN_USE",
    );
  }

  await prisma.role.delete({ where: { id } }); // grants cascade
  bustRolePermissionCache(id);

  await createAuditLog({
    actorId: req.user.id,
    action: "DELETE",
    module: "roles",
    recordId: id,
    oldData: { name: role.name },
    req,
  });

  res.json({ success: true, message: "Role deleted" });
};
