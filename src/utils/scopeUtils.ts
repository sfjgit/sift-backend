// File: scopeUtils.ts
// Path: src/utils/scopeUtils.ts

import { getSubordinateIds } from "@/services/orgService";

/**
 * Returns the list of recruiter IDs visible to this user based on org tree.
 * - superAdmin → null (means no filter, see all)
 * - everyone else → [userId, ...all subordinate IDs]
 *
 * Usage in Prisma where:
 *   const ids = await getVisibleRecruiterIds(userId, isSuperAdmin);
 *   where: { recruiterId: ids ? { in: ids } : undefined }
 */
export async function getVisibleRecruiterIds(
  userId: string,
  isSuperAdmin: boolean
): Promise<string[] | null> {
  if (isSuperAdmin) return null; // null = no filter = see all

  const subordinateIds = await getSubordinateIds(userId);
  return [userId, ...subordinateIds];
}
