// File: scopeFilter.middleware.ts
// Path: src/middleware/scopeFilter.middleware.ts

import { Request, Response, NextFunction } from "express";
import { getSubordinateIds, getReportingLineIds } from "@/services/orgService";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// ScopeType is driven directly from the PermissionScope enum in schema.prisma
// so any new enum value added there automatically works here — no manual sync
// ─────────────────────────────────────────────────────────────────────────────

import { PermissionScope } from "@prisma/client";
export type ScopeType = PermissionScope; // "OWN" | "TEAM" | "REPORTING" | "REPORTING_LINE" | "DEPARTMENT" | "BU" | "ALL"

export interface ScopeFilter {
  type: ScopeType;
  userId?: string;
  departmentId?: string;
  buId?: string;
  // resolved user-id sets for set-based scopes
  subordinateIds?: string[]; // REPORTING — direct reports only
  reportingLineIds?: string[]; // REPORTING_LINE — full subtree
  teamMemberIds?: string[]; // TEAM — teamLead's members
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

      // Super admin bypasses everything
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

      const permission = user.role.permissions.find(
        (p: any) => p.module === module
      );

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

      const scope = permission.canViewScope as ScopeType;
      const userId = user.id;

      // ── Resolve scope → ScopeFilter ──────────────────────────────────────

      switch (scope) {
        case "ALL": {
          req.scopeFilter = { type: "ALL" };
          break;
        }

        case "OWN": {
          req.scopeFilter = { type: "OWN", userId };
          break;
        }

        case "TEAM": {
          // Team = users where teamLeadId = me
          const teamMembers = await prisma.user.findMany({
            where: { teamLeadId: userId, isActive: true },
            select: { id: true },
          });
          req.scopeFilter = {
            type: "TEAM",
            userId,
            teamMemberIds: [userId, ...teamMembers.map((u) => u.id)],
          };
          break;
        }

        case "REPORTING": {
          // Reporting = direct subordinates (reportingToId = me), one level only
          const directReports = await prisma.user.findMany({
            where: { reportingToId: userId, isActive: true },
            select: { id: true },
          });
          req.scopeFilter = {
            type: "REPORTING",
            userId,
            subordinateIds: [userId, ...directReports.map((u) => u.id)],
          };
          break;
        }

        case "REPORTING_LINE": {
          // Full subtree — recursive, uses orgService helper
          const lineIds = await getReportingLineIds(userId);
          req.scopeFilter = {
            type: "REPORTING_LINE",
            userId,
            reportingLineIds: [userId, ...lineIds],
          };
          break;
        }

        case "DEPARTMENT": {
          req.scopeFilter = {
            type: "DEPARTMENT",
            userId,
            departmentId: user.departmentId ?? undefined,
          };
          break;
        }

        case "BU": {
          const buLineIds = await getSubordinateIds(userId);
          req.scopeFilter = {
            type: "BU",
            userId,
            subordinateIds: [userId, ...buLineIds],
          };
          break;
        }

        default: {
          res.status(403).json({
            success: false,
            message: `Unknown permission scope: ${scope}`,
            code: "UNKNOWN_SCOPE",
          });
          return;
        }
      }

      next();
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

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE WHERE BUILDERS
// Each returns a Prisma where-clause fragment for that entity + scope combo
// ─────────────────────────────────────────────────────────────────────────────

/** Requirements scope */
export function reqScopeWhere(scope: ScopeFilter): any {
  const base = { deletedAt: null };
  switch (scope.type) {
    case "ALL":
      return base;
    case "OWN":
      return { ...base, createdById: scope.userId };
    case "TEAM":
      return {
        ...base,
        createdById: { in: scope.teamMemberIds ?? [scope.userId] },
      };
    case "REPORTING":
      return {
        ...base,
        createdById: { in: scope.subordinateIds ?? [scope.userId] },
      };
    case "REPORTING_LINE":
      return {
        ...base,
        createdById: { in: scope.reportingLineIds ?? [scope.userId] },
      };
    case "DEPARTMENT":
      return { ...base, createdBy: { departmentId: scope.departmentId } };
    case "BU":
      return {
        ...base,
        createdById: { in: scope.subordinateIds ?? [scope.userId] },
      };
    default:
      return base;
  }
}

/** Clients scope */
export function clientScopeWhere(scope: ScopeFilter): any {
  const base = { deletedAt: null };
  switch (scope.type) {
    case "ALL":
      return base;
    case "OWN":
      return {
        ...base,
        OR: [
          { createdById: scope.userId },
          { spocs: { some: { handlerId: scope.userId, isActive: true } } },
        ],
      };
    case "TEAM":
      return {
        ...base,
        createdById: { in: scope.teamMemberIds ?? [scope.userId] },
      };
    case "REPORTING":
      return {
        ...base,
        createdById: { in: scope.subordinateIds ?? [scope.userId] },
      };
    case "REPORTING_LINE":
      return {
        ...base,
        createdById: { in: scope.reportingLineIds ?? [scope.userId] },
      };
    case "DEPARTMENT":
      return { ...base, createdBy: { departmentId: scope.departmentId } };
    case "BU":
      return {
        ...base,
        createdById: { in: scope.subordinateIds ?? [scope.userId] },
      };
    default:
      return base;
  }
}

/** Assignments scope — the main new addition */
export function assignmentScopeWhere(scope: ScopeFilter): any {
  switch (scope.type) {
    case "ALL":
      return {};
    case "OWN":
      // I see only assignments assigned TO me
      return { assignedToId: scope.userId };
    case "TEAM":
      // Team lead sees assignments to their team members
      return { assignedToId: { in: scope.teamMemberIds ?? [scope.userId] } };
    case "REPORTING":
      // See assignments for my direct reports
      return { assignedToId: { in: scope.subordinateIds ?? [scope.userId] } };
    case "REPORTING_LINE":
      // See assignments across entire reporting subtree
      return { assignedToId: { in: scope.reportingLineIds ?? [scope.userId] } };
    case "DEPARTMENT":
      return { assigneeDepartment: { id: scope.departmentId } };
    case "BU":
      return {
        assignedTo: { id: { in: scope.subordinateIds ?? [scope.userId] } },
      };
    default:
      return { assignedToId: scope.userId };
  }
}
