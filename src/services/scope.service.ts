// File: scope.service.ts
// Path: src/services/scope.service.ts
//
// scope → visible user IDs → Prisma `where` per module.
// The owner field per module is structural, so it lives here in code.

import { PermissionScope, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import type { AuthUser } from "@/types/express";

type ScopeUser = Pick<AuthUser, "id" | "departmentId">;

// null = no filter (ALL)
export const resolveScopeUserIds = async (
  user: ScopeUser,
  scope: PermissionScope,
): Promise<string[] | null> => {
  switch (scope) {
    case "ALL":
      return null;

    case "OWN":
      return [user.id];

    case "TEAM": {
      const rows = await prisma.user.findMany({
        where: { teamLeadId: user.id },
        select: { id: true },
      });
      return [user.id, ...rows.map((r) => r.id)];
    }

    case "REPORTING": {
      const rows = await prisma.user.findMany({
        where: { reportingToId: user.id },
        select: { id: true },
      });
      return [user.id, ...rows.map((r) => r.id)];
    }

    case "REPORTING_LINE":
      return [user.id, ...(await getReportingLineIds(user.id))];

    case "DEPARTMENT": {
      if (!user.departmentId) return [user.id];
      const rows = await prisma.user.findMany({
        where: { departmentId: user.departmentId },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    case "BU": {
      const myBUs = await prisma.userBusinessUnit.findMany({
        where: { userId: user.id },
        select: { businessUnitId: true },
      });
      if (!myBUs.length) return [user.id];
      const rows = await prisma.user.findMany({
        where: {
          businessUnits: {
            some: { businessUnitId: { in: myBUs.map((b) => b.businessUnitId) } },
          },
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
  }
};

// Everyone below userId via reportingToId, any depth (excludes userId).
// UNION (not UNION ALL) stops infinite loops if a reporting cycle exists.
export const getReportingLineIds = async (userId: string): Promise<string[]> => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM "User" WHERE "reportingToId" = ${userId}
      UNION
      SELECT u.id FROM "User" u JOIN tree t ON u."reportingToId" = t.id
    )
    SELECT id FROM tree WHERE id <> ${userId}`;
  return rows.map((r) => r.id);
};

export const isUserInScope = async (
  user: ScopeUser,
  scope: PermissionScope,
  targetUserId: string,
) => {
  const ids = await resolveScopeUserIds(user, scope);
  return ids === null || ids.includes(targetUserId);
};

// ── per-module where builders ────────────────────────────────────────────────

export const userScopeWhere = async (
  user: ScopeUser,
  scope: PermissionScope,
): Promise<Prisma.UserWhereInput> => {
  const ids = await resolveScopeUserIds(user, scope);
  return ids ? { id: { in: ids } } : {};
};

export const spocScopeWhere = async (
  user: ScopeUser,
  scope: PermissionScope,
): Promise<Prisma.ClientSpocWhereInput> => {
  const ids = await resolveScopeUserIds(user, scope);
  return ids ? { handlerId: { in: ids } } : {};
};

// implicit access: created it, or can see any of its SPOCs
export const clientScopeWhere = async (
  user: ScopeUser,
  scope: PermissionScope,
): Promise<Prisma.ClientWhereInput> => {
  const ids = await resolveScopeUserIds(user, scope);
  return ids
    ? {
        OR: [
          { createdById: { in: ids } },
          { spocs: { some: { handlerId: { in: ids } } } },
        ],
      }
    : {};
};

export const stepRunScopeWhere = async (
  user: ScopeUser,
  scope: PermissionScope,
): Promise<Prisma.StepRunWhereInput> => {
  const ids = await resolveScopeUserIds(user, scope);
  return ids ? { requestedById: { in: ids } } : {};
};
