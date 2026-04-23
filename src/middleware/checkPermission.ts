// src/middleware/checkPermission.ts
// Checks if the user's role has the required permission for a module+action.
// Attaches req.permissionScope so the controller knows how to filter data.
// Always runs AFTER authenticate middleware.

import { PERMISSION_SCOPE } from "@/constants/scopes";
import prisma from "@/utils/prisma/client";
import { Request, Response, NextFunction } from "express";
// import { prisma } from "../lib/prisma";
// import { PERMISSION_SCOPE } from "../constants";

type Action = "canView" | "canAdd" | "canEdit" | "canDelete";

export const checkPermission = (module: string, action: Action) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Super admin bypasses all permission checks — full access
      if (req.user.isSuperAdmin) {
        req.permissionScope = PERMISSION_SCOPE.ALL;
        return next();
      }

      const permission = await prisma.rolePermission.findUnique({
        where: {
          roleId_module: {
            roleId: req.user.roleId,
            module,
          },
        },
      });

      if (!permission || !permission[action]) {
        return res.status(403).json({
          message: `You do not have ${action} access on ${module}`,
        });
      }

      // Attach scope — controller uses this to build the WHERE clause
      req.permissionScope = permission.scope;
      next();
    } catch {
      return res.status(500).json({ message: "Permission check failed" });
    }
  };
};

// ── Role guard ────────────────────────────────────────────────────────────────
// Use when a route is restricted to specific roles entirely,
// regardless of module permissions.
// e.g. requireRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN)

export const requireRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user.roleName)) {
      return res.status(403).json({
        message: `This action requires one of: ${roles.join(", ")}`,
      });
    }
    next();
  };
};
