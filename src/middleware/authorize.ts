// File: authorize.ts
// Path: src/middleware/authorize.ts
//
// Route guard. Runs after authenticateUser. On success attaches:
//   req.permissions — full map (for field masks)
//   req.scope       — scope of this grant, null for unscoped actions

import { Request, Response, NextFunction } from "express";
import { PermissionKey } from "@/config/permissions.registry";
import { getUserPermissionMap } from "@/services/permission.service";

export const authorize =
  (key: PermissionKey) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const map = await getUserPermissionMap(req.user);
    const grant = map[key];

    if (!grant) {
      res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: `Missing permission: ${key}`,
      });
      return;
    }

    req.permissions = map;
    req.scope = grant === true ? null : grant;
    next();
  };

// Super admin only — impersonation and other break-glass actions
export const requireSuperAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user.isSuperAdmin) {
    res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "Super admin only",
    });
    return;
  }
  next();
};
