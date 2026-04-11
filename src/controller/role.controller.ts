import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { createAuditLog } from "@/services/auditLogs.service";

export const createRole = async (req: Request, res: Response) => {
  try {
    const { name, description, isSystem } = req.validatedBody;
    const existingRole = await prisma.role.findUnique({
      where: { name },
    });
    if (existingRole) {
      return res.status(400).json({ message: "Role already exists" });
    }
    const role = await prisma.role.create({
      data: { name, description, isSystem },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "ROLE",
      recordId: role.id,
      oldData: null,
      newData: role,
      req,
    });
    return res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: role,
    });
  } catch (error) {
    console.error("Error creating role:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error creating role" });
  }
};

export const getAllRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      include: { permissions: true },
    });
    // await createAuditLog({ actorId: req.user.id, action: "GET", module: "ROLE", recordId: null, oldData: null, newData: roles, req });
    return res.status(200).json({
      success: true,
      message: "Roles fetched successfully",
      data: roles,
    });
  } catch (error) {
    console.error("Error getting roles:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting roles" });
  }
};
export const getSingleRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const role = await prisma.role.findUnique({
      where: { id },
      include: { permissions: true },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "GET",
      module: "ROLE",
      recordId: id,
      oldData: null,
      newData: role,
      req,
    });
    return res.status(200).json({
      success: true,
      message: "Role fetched successfully",
      data: role,
    });
  } catch (error) {
    console.error("Error getting role:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting role" });
  }
};

export const deleteRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const role = await prisma.role.findUnique({
      where: { id },
    });
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    await prisma.role.delete({
      where: { id },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "DELETE",
      module: "ROLE",
      recordId: id,
      oldData: role,
      newData: null,
      req,
    });
    return res
      .status(200)
      .json({ success: true, message: "Role deleted successfully" });
  } catch (error) {
    console.error("Error deleting role:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error deleting role" });
  }
};

export const setRolePermissions = async (req: Request, res: Response) => {
  try {
    const { id: roleId } = req.validatedParams;
    const permissions = req.validatedBody;

    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    const updatedPermissions = [];

    for (const perm of permissions) {
      const permission = await prisma.rolePermission.upsert({
        where: {
          roleId_module: {
            roleId,
            module: perm.module,
          },
        },
        update: {
          canView: perm.canView ?? false,
          canAdd: perm.canAdd ?? false,
          canEdit: perm.canEdit ?? false,
          canDelete: perm.canDelete ?? false,
          scope: perm.scope ?? "OWN",
        },
        create: {
          roleId,
          module: perm.module,
          canView: perm.canView ?? false,
          canAdd: perm.canAdd ?? false,
          canEdit: perm.canEdit ?? false,
          canDelete: perm.canDelete ?? false,
          scope: perm.scope ?? "OWN",
        },
      });

      updatedPermissions.push(permission);
    }

    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "ROLE",
      recordId: roleId,
      oldData: role,
      newData: updatedPermissions,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully",
      data: updatedPermissions,
    });
  } catch (error) {
    console.error("Error setting role permissions:", error);

    return res.status(500).json({
      success: false,
      message: "Error updating permissions",
    });
  }
};
