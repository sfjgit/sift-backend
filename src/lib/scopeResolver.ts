// src/lib/scopeResolver.ts
// Translates req.permissionScope into a Prisma-compatible WHERE filter.
// Every list controller calls the relevant resolver before querying.
//
// Pattern:
//   const scopeFilter = await resolveRequirementScope(req.user, req.permissionScope);
//   const reqs = await prisma.requirement.findMany({ where: { ...scopeFilter, ...otherFilters } });

import { prisma } from "./prisma";
import {
  PERMISSION_SCOPE,
  ASSIGNMENT_TYPE,
  ASSIGNMENT_STATUS,
} from "../constants";
import { AuthUser } from "../middleware/authenticate";

// ── Base BU filter ────────────────────────────────────────────────────────────
// Applied to EVERY query. Super admin / ALL scope skips it.
// This is why Rakhi never sees TaaS data — it's automatic.

export const buFilter = (user: AuthUser) => {
  if (!user.businessUnitId) return {};
  return { businessUnitId: user.businessUnitId };
};

// ── Requirements scope resolver ───────────────────────────────────────────────

export async function resolveRequirementScope(
  user: AuthUser,
  scope: string
): Promise<object> {
  const base = buFilter(user);

  switch (scope) {
    case PERMISSION_SCOPE.ALL:
      // Super admin — no filter
      return {};

    case PERMISSION_SCOPE.BU:
      // Admin — everything in their BU
      return base;

    case PERMISSION_SCOPE.OWN:
      // Sales — only requirements they created
      return { ...base, createdById: user.id };

    case PERMISSION_SCOPE.MANAGER: {
      // Delivery Manager — requirements assigned to them via MANAGER assignment row
      const assignments = await prisma.requirementAssignment.findMany({
        where: {
          recruiterId: user.id,
          assignmentType: ASSIGNMENT_TYPE.MANAGER,
          status: ASSIGNMENT_STATUS.ACTIVE,
        },
        select: { requirementId: true },
      });
      const ids = assignments.map((a) => a.requirementId);
      return { ...base, id: { in: ids } };
    }

    case PERMISSION_SCOPE.TEAM: {
      // Team Lead — requirements where their team(s) have an assignment row
      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { teamId: true },
      });
      const teamIds = teamMemberships.map((m) => m.teamId);

      const assignments = await prisma.requirementAssignment.findMany({
        where: {
          teamId: { in: teamIds },
          assignmentType: ASSIGNMENT_TYPE.TEAM,
          status: ASSIGNMENT_STATUS.ACTIVE,
        },
        select: { requirementId: true },
      });
      const ids = assignments.map((a) => a.requirementId);
      return { ...base, id: { in: ids } };
    }

    default:
      // Recruiter OWN — requirements assigned to them via INDIVIDUAL row
      // (falls through from OWN since recruiters also have OWN scope)
      const assignments = await prisma.requirementAssignment.findMany({
        where: {
          recruiterId: user.id,
          assignmentType: ASSIGNMENT_TYPE.INDIVIDUAL,
          status: ASSIGNMENT_STATUS.ACTIVE,
        },
        select: { requirementId: true },
      });
      const ids = assignments.map((a) => a.requirementId);
      return { ...base, id: { in: ids } };
  }
}

// ── Clients scope resolver ────────────────────────────────────────────────────

export async function resolveClientScope(
  user: AuthUser,
  scope: string
): Promise<object> {
  const base = buFilter(user);

  switch (scope) {
    case PERMISSION_SCOPE.ALL:
      return {};
    case PERMISSION_SCOPE.BU:
      return base;
    case PERMISSION_SCOPE.OWN:
      return { ...base, createdById: user.id };
    case PERMISSION_SCOPE.TEAM: {
      // Team lead / recruiter — clients whose team assignment includes their team
      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { teamId: true },
      });
      const teamIds = teamMemberships.map((m) => m.teamId);
      return {
        ...base,
        teamAssignments: { some: { teamId: { in: teamIds } } },
      };
    }
    default:
      return { ...base, createdById: user.id };
  }
}

// ── Users scope resolver ──────────────────────────────────────────────────────

export async function resolveUserScope(
  user: AuthUser,
  scope: string
): Promise<object> {
  const base = buFilter(user);

  switch (scope) {
    case PERMISSION_SCOPE.ALL:
      return {};
    case PERMISSION_SCOPE.BU:
      return base;
    case PERMISSION_SCOPE.MANAGER: {
      // Delivery manager — users in teams under their delivery tree
      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { teamId: true },
      });
      // Get child teams of each team they lead
      const teamIds = teamMemberships.map((m) => m.teamId);
      const childTeams = await prisma.team.findMany({
        where: { parentTeamId: { in: teamIds } },
        select: { id: true },
      });
      const allTeamIds = [...teamIds, ...childTeams.map((t) => t.id)];
      return {
        ...base,
        teamMemberships: {
          some: { teamId: { in: allTeamIds }, isActive: true },
        },
      };
    }
    case PERMISSION_SCOPE.TEAM: {
      // Team lead — only their direct team members
      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { teamId: true },
      });
      const teamIds = teamMemberships.map((m) => m.teamId);
      return {
        ...base,
        teamMemberships: { some: { teamId: { in: teamIds }, isActive: true } },
      };
    }
    default:
      return { ...base, id: user.id };
  }
}

// ── Team tree utility ─────────────────────────────────────────────────────────
// Recursively fetches all teams under a root team.
// Used by delivery manager to see all teams under their ecosystem,
// by admin to build the org chart, etc.

export async function getTeamTree(rootTeamId: string): Promise<any> {
  const team = await prisma.team.findUnique({
    where: { id: rootTeamId },
    include: {
      members: {
        where: { isActive: true },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!team) return null;

  const children = await prisma.team.findMany({
    where: { parentTeamId: rootTeamId, isActive: true },
  });

  const childTrees = await Promise.all(children.map((c) => getTeamTree(c.id)));

  return { ...team, children: childTrees };
}
