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
 * Turns a scope (+ optional requested requirementId) into a Prisma
 * requirementId filter. filter undefined = no restriction (ALL scope).
 */
export const resolveRequirementFilter = (
  scope: ApplicantScope,
  requirementId?: string,
):
  | { allowed: false }
  | { allowed: true; filter?: string | { in: string[] } } => {
  if (scope.type === "NONE") return { allowed: false };

  if (scope.type === "ALL") return { allowed: true, filter: requirementId };

  if (requirementId)
    return scope.requirementIds.includes(requirementId)
      ? { allowed: true, filter: requirementId }
      : { allowed: false };

  return { allowed: true, filter: { in: scope.requirementIds } };
};
