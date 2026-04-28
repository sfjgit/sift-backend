import { Request, Response, NextFunction } from "express";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

export type ScopeType = "ALL" | "BU" | "MANAGER" | "TEAM" | "OWN";

export interface ScopeFilter {
  type: ScopeType;
  userId?: string; // OWN
  businessUnitId?: string; // BU, MANAGER, TEAM
  teamIds?: string[]; // MANAGER, TEAM
}

// Extend Express Request so controllers can read it
declare global {
  namespace Express {
    interface Request {
      scopeFilter: ScopeFilter;
      modulePermission: {
        canView: boolean;
        canAdd: boolean;
        canEdit: boolean;
        canDelete: boolean;
        scope: string;
      };
    }
  }
}

// ─────────────────────────────────────────
// SCOPE FILTER MIDDLEWARE
// Usage: router.get("/", authenticateUser, scopeFilter("users"), listUsers)
//
// What it does:
//   1. Finds the RolePermission row for this module
//   2. Checks canView — 403 if false
//   3. Reads scope from DB (OWN|TEAM|MANAGER|BU|ALL)
//   4. Builds req.scopeFilter — pure scope→data translation
//   5. Attaches req.modulePermission — so controllers know canAdd/canEdit/canDelete
//
// Zero hardcoded role names. Everything driven by DB.
// ─────────────────────────────────────────

export const scopeFilter =
  (module: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({ success: false, message: "Unauthenticated" });
        return;
      }

      // ── Super admin bypasses everything ─────────────────────────────────────
      if (user.isSuperAdmin) {
        req.scopeFilter = { type: "ALL" };
        req.modulePermission = {
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
          scope: "ALL",
        };
        next();
        return;
      }

      // ── Find permission for this module from user's role ─────────────────────
      // req.user already has role.permissions[] from authenticateUser
      const permission = (user.role as any).permissions?.find(
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

      // Attach permission so controllers can check canAdd/canEdit/canDelete
      req.modulePermission = {
        canView: permission.canView,
        canAdd: permission.canAdd,
        canEdit: permission.canEdit,
        canDelete: permission.canDelete,
        scope: permission.scope,
      };

      const scope = permission.scope as ScopeType;
      const userId = user.id;
      const buId = user.businessUnitId ?? undefined;

      // ── Translate scope → ScopeFilter ────────────────────────────────────────

      // ALL — sees everything, no filters
      if (scope === "ALL") {
        req.scopeFilter = { type: "ALL" };
        next();
        return;
      }

      // BU — sees everything in their business unit
      if (scope === "BU") {
        req.scopeFilter = { type: "BU", businessUnitId: buId };
        next();
        return;
      }

      // OWN — sees only records they own / created / are assigned to
      if (scope === "OWN") {
        req.scopeFilter = { type: "OWN", userId, businessUnitId: buId };
        next();
        return;
      }

      // MANAGER — sees teams they lead + everything under those teams
      if (scope === "MANAGER") {
        const managedMemberships = await prisma.teamMember.findMany({
          where: {
            userId,
            isActive: true,
            teamRole: { in: ["LEAD", "CO_LEAD"] },
          },
          select: { teamId: true },
        });

        // Also get child teams of managed teams via parentTeamId
        const managedTeamIds = managedMemberships.map((m) => m.teamId);

        const childTeams = await prisma.team.findMany({
          where: { parentTeamId: { in: managedTeamIds }, isActive: true },
          select: { id: true },
        });

        const allTeamIds = [...managedTeamIds, ...childTeams.map((t) => t.id)];

        req.scopeFilter = {
          type: "MANAGER",
          userId,
          businessUnitId: buId,
          teamIds: allTeamIds,
        };
        next();
        return;
      }

      // TEAM — sees only within their own team(s)
      if (scope === "TEAM") {
        const memberships = await prisma.teamMember.findMany({
          where: { userId, isActive: true },
          select: { teamId: true },
        });

        const teamIds = memberships.map((m) => m.teamId);

        req.scopeFilter = {
          type: "TEAM",
          userId,
          businessUnitId: buId,
          teamIds,
        };
        next();
        return;
      }

      // Fallback — unknown scope, deny
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

// ─────────────────────────────────────────
// PERMISSION GUARD — for write operations
// Usage: checkPermission("canAdd") inside controller
// Guards canAdd / canEdit / canDelete without
// needing a separate middleware per action.
// ─────────────────────────────────────────

export const checkPermission =
  (action: "canAdd" | "canEdit" | "canDelete") =>
  (req: Request, res: Response, next: NextFunction) => {
    const perm = req.modulePermission;

    if (!perm || !perm[action]) {
      res.status(403).json({
        success: false,
        message: `You don't have permission to perform this action`,
        code: "FORBIDDEN",
      });
      return;
    }
    next();
  };
