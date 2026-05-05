// middleware/scopeFilter.middleware.ts
import { Request, Response, NextFunction } from "express";
import { getSubordinateIds } from "@/services/orgService";

export type ScopeType = "ALL" | "BU" | "DEPARTMENT" | "OWN";

export interface ScopeFilter {
  type: ScopeType;
  userId?: string;
  departmentId?: string;
  subordinateIds?: string[];
}

export const scopeFilter =
  (module: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({ success: false, message: "Unauthenticated" });
        return;
      }

      // super admin bypasses everything
      if (user.isSuperAdmin) {
        req.scopeFilter = { type: "ALL" };
        req.modulePermission = {
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
          canViewScope: "ALL",
          canAddScope: "ALL",
          canEditScope: "ALL",
          canDeleteScope: "ALL",
        };
        next();
        return;
      }

      const permission = user.role.permissions.find((p) => p.module === module);

      if (!permission || !permission.canView) {
        res.status(403).json({
          success: false,
          message: `You don't have permission to view ${module}`,
          code: "FORBIDDEN",
        });
        return;
      }

      req.modulePermission = {
        canView: permission.canView,
        canAdd: permission.canAdd,
        canEdit: permission.canEdit,
        canDelete: permission.canDelete,
        canViewScope: permission.canViewScope,
        canAddScope: permission.canAddScope,
        canEditScope: permission.canEditScope,
        canDeleteScope: permission.canDeleteScope,
      };

      // use canViewScope to determine what data this user sees
      const scope = permission.canViewScope as ScopeType;
      const userId = user.id;

      if (scope === "ALL") {
        req.scopeFilter = { type: "ALL" };
        next();
        return;
      }

      if (scope === "BU") {
        // BU is now on requirement/client directly
        // user doesn't have BU anymore — resolve via subordinates
        // senior person with BU scope sees all requirements under their subtree
        const subordinateIds = await getSubordinateIds(userId);
        req.scopeFilter = {
          type: "BU",
          userId,
          subordinateIds: [userId, ...subordinateIds],
        };
        next();
        return;
      }

      if (scope === "DEPARTMENT") {
        req.scopeFilter = {
          type: "DEPARTMENT",
          userId,
          departmentId: user.departmentId ?? undefined,
        };
        next();
        return;
      }

      if (scope === "OWN") {
        req.scopeFilter = { type: "OWN", userId };
        next();
        return;
      }

      res.status(403).json({
        success: false,
        message: `Unknown permission scope: ${scope}`,
        code: "UNKNOWN_SCOPE",
      });
    } catch (err) {
      console.error("scopeFilter error:", err);
      res.status(500).json({ success: false, message: "Authorization error" });
    }
  };

export const checkPermission =
  (action: "canAdd" | "canEdit" | "canDelete") =>
  (req: Request, res: Response, next: NextFunction) => {
    const perm = req.modulePermission;
    if (!perm || !perm[action]) {
      res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action",
        code: "FORBIDDEN",
      });
      return;
    }
    next();
  };

// scope → prisma where for requirements
export function reqScopeWhere(scope: ScopeFilter): any {
  switch (scope.type) {
    case "ALL":
      return { deletedAt: null };
    case "BU":
      // sees requirements created by anyone in their subtree
      return {
        deletedAt: null,
        createdById: { in: scope.subordinateIds ?? [scope.userId] },
      };
    case "DEPARTMENT":
      return {
        deletedAt: null,
        createdBy: { departmentId: scope.departmentId },
      };
    case "OWN":
      return { deletedAt: null, createdById: scope.userId };
    default:
      return { deletedAt: null };
  }
}

// scope → prisma where for clients
export function clientScopeWhere(scope: ScopeFilter): any {
  switch (scope.type) {
    case "ALL":
      return { deletedAt: null };
    case "BU":
      return {
        deletedAt: null,
        createdById: { in: scope.subordinateIds ?? [scope.userId] },
      };
    case "DEPARTMENT":
      return {
        deletedAt: null,
        createdBy: { departmentId: scope.departmentId },
      };
    case "OWN":
      return {
        deletedAt: null,
        OR: [
          { createdById: scope.userId },
          { spocs: { some: { userId: scope.userId, isActive: true } } },
        ],
      };
    default:
      return { deletedAt: null };
  }
}
