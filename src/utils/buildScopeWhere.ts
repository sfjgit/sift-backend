import { ScopeFilter } from "@/middleware/scopeFilter.middleware";

// ─────────────────────────────────────────
// buildScopeWhere
//
// Converts a ScopeFilter into a Prisma WHERE
// fragment for a given model.
//
// Every listX controller calls this first,
// then merges the result with its own filters.
//
// Adding a new model = add a case in the switch.
// Adding a new scope = add a case per model.
// Zero role names anywhere.
// ─────────────────────────────────────────

export function buildScopeWhere(
  scope: ScopeFilter,
  model: "users" | "clients" | "requirements" | "teams" | "businessUnits"
): Record<string, any> {
  // Super admin or ALL scope — no filter
  if (scope.type === "ALL") return {};

  switch (model) {
    // ──────────────────────────────────────
    // USERS
    // ──────────────────────────────────────
    case "users": {
      if (scope.type === "BU") {
        // See all users in their BU
        return { businessUnitId: scope.businessUnitId };
      }

      if (scope.type === "MANAGER") {
        // See users who are members of teams they manage
        return {
          OR: [
            { businessUnitId: scope.businessUnitId }, // everyone in BU visible to manager
            {
              teamMemberships: {
                some: {
                  teamId: { in: scope.teamIds ?? [] },
                  isActive: true,
                },
              },
            },
          ],
        };
      }

      if (scope.type === "TEAM") {
        // See only users in same team(s)
        return {
          teamMemberships: {
            some: {
              teamId: { in: scope.teamIds ?? [] },
              isActive: true,
            },
          },
        };
      }

      if (scope.type === "OWN") {
        // Only see themselves
        return { id: scope.userId };
      }

      return {};
    }

    // ──────────────────────────────────────
    // CLIENTS
    // ──────────────────────────────────────
    case "clients": {
      if (scope.type === "BU") {
        return {
          businessUnitId: scope.businessUnitId,
          deletedAt: null,
        };
      }

      if (scope.type === "MANAGER") {
        // Clients assigned to teams they manage
        return {
          deletedAt: null,
          OR: [
            { businessUnitId: scope.businessUnitId },
            {
              teamAssignments: {
                some: { teamId: { in: scope.teamIds ?? [] } },
              },
            },
          ],
        };
      }

      if (scope.type === "TEAM") {
        // Clients whose team assignment includes their team
        return {
          deletedAt: null,
          teamAssignments: {
            some: { teamId: { in: scope.teamIds ?? [] } },
          },
        };
      }

      if (scope.type === "OWN") {
        // Clients they created OR are a handler on
        return {
          deletedAt: null,
          OR: [
            { createdById: scope.userId },
            {
              handlers: {
                some: { userId: scope.userId, status: "ACTIVE" },
              },
            },
          ],
        };
      }

      return { deletedAt: null };
    }

    // ──────────────────────────────────────
    // REQUIREMENTS
    // ──────────────────────────────────────
    case "requirements": {
      if (scope.type === "BU") {
        return {
          businessUnitId: scope.businessUnitId,
          deletedAt: null,
        };
      }

      if (scope.type === "MANAGER") {
        // Requirements assigned to them as MANAGER
        // OR assigned to teams they manage
        return {
          deletedAt: null,
          OR: [
            {
              assignments: {
                some: {
                  assignmentType: "MANAGER",
                  recruiterId: scope.userId,
                  status: "ACTIVE",
                },
              },
            },
            {
              assignments: {
                some: {
                  assignmentType: "TEAM",
                  teamId: { in: scope.teamIds ?? [] },
                  status: "ACTIVE",
                },
              },
            },
          ],
        };
      }

      if (scope.type === "TEAM") {
        // Requirements assigned to their team(s)
        return {
          deletedAt: null,
          assignments: {
            some: {
              assignmentType: "TEAM",
              teamId: { in: scope.teamIds ?? [] },
              status: "ACTIVE",
            },
          },
        };
      }

      if (scope.type === "OWN") {
        // Requirements assigned directly to them
        // OR requirements they created
        return {
          deletedAt: null,
          OR: [
            { createdById: scope.userId },
            {
              assignments: {
                some: {
                  assignmentType: "INDIVIDUAL",
                  recruiterId: scope.userId,
                  status: "ACTIVE",
                },
              },
            },
          ],
        };
      }

      return { deletedAt: null };
    }

    // ──────────────────────────────────────
    // TEAMS
    // ──────────────────────────────────────
    case "teams": {
      if (scope.type === "BU") {
        return {
          businessUnitId: scope.businessUnitId,
          isActive: true,
        };
      }

      if (scope.type === "MANAGER") {
        return {
          isActive: true,
          id: { in: scope.teamIds ?? [] },
        };
      }

      if (scope.type === "TEAM") {
        return {
          isActive: true,
          id: { in: scope.teamIds ?? [] },
        };
      }

      if (scope.type === "OWN") {
        // Only their own team memberships
        return {
          isActive: true,
          members: {
            some: { userId: scope.userId, isActive: true },
          },
        };
      }

      return { isActive: true };
    }

    // ──────────────────────────────────────
    // BUSINESS UNITS
    // Only super admin and BU-scoped admins see BUs
    // ──────────────────────────────────────
    case "businessUnits": {
      if (scope.type === "BU") {
        return { id: scope.businessUnitId };
      }

      // MANAGER/TEAM/OWN — show only their BU
      if (scope.businessUnitId) {
        return { id: scope.businessUnitId };
      }

      return {};
    }

    default:
      return {};
  }
}
