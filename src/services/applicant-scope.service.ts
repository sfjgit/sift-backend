// File: applicant-scope.service.ts
// Path: src/services/applicant-scope.service.ts

import { RoleCanonical } from "@prisma/client";
import prisma from "@/utils/prisma/client";

/** Roles that see every applicant across all requirements */
const FULL_ACCESS_ROLES = new Set<RoleCanonical>([
  RoleCanonical.SUPER_ADMIN,
  RoleCanonical.ADMIN,
]);

/** Roles that see applicants on requirements they created or are assigned to */
const DELIVERY_ROLES = new Set<RoleCanonical>([
  RoleCanonical.DELIVERY_LEAD,
  RoleCanonical.DELIVERY_MANAGER,
]);

export type ApplicantScope =
  | { type: "ALL" }
  | { type: "REQUIREMENTS"; requirementIds: string[] }
  | { type: "NONE" };

interface ScopeUser {
  id: string;
  isSuperAdmin?: boolean | null;
  role?: { canonical?: RoleCanonical | null } | null;
}

export const getApplicantScope = async (
  user: ScopeUser,
): Promise<ApplicantScope> => {
  const canonical = user.role?.canonical ?? null;

  if (user.isSuperAdmin || (canonical && FULL_ACCESS_ROLES.has(canonical)))
    return { type: "ALL" };

  if (!canonical || !DELIVERY_ROLES.has(canonical)) return { type: "NONE" };

  const [created, assigned] = await Promise.all([
    prisma.requirement.findMany({
      where: { createdById: user.id, deletedAt: null },
      select: { id: true },
    }),
    prisma.requirementAssignment.findMany({
      where: { assignedToId: user.id, status: "ACTIVE" },
      select: { requirementId: true },
      distinct: ["requirementId"],
    }),
  ]);

  return {
    type: "REQUIREMENTS",
    requirementIds: [
      ...new Set([
        ...created.map((r) => r.id),
        ...assigned.map((a) => a.requirementId),
      ]),
    ],
  };
};

/**
 * Turns a scope (+ optional requested requirement ids) into a Prisma
 * requirementId filter. filter undefined = no restriction (ALL scope, nothing picked).
 * Any requested id outside the user's scope → not allowed.
 */
export const resolveRequirementFilter = (
  scope: ApplicantScope,
  requirementIds: string[] = [],
): { allowed: false } | { allowed: true; filter?: { in: string[] } } => {
  if (scope.type === "NONE") return { allowed: false };

  if (scope.type === "ALL")
    return {
      allowed: true,
      filter: requirementIds.length ? { in: requirementIds } : undefined,
    };

  if (requirementIds.length) {
    const inScope = new Set(scope.requirementIds);
    return requirementIds.every((id) => inScope.has(id))
      ? { allowed: true, filter: { in: requirementIds } }
      : { allowed: false };
  }

  return { allowed: true, filter: { in: scope.requirementIds } };
};
