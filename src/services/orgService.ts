// services/orgService.ts

import prisma from "@/utils/prisma/client";

// export async function getSubordinateIds(userId: string): Promise<string[]> {
//   const rows = await prisma.$queryRaw<{ id: string }[]>`
//       WITH RECURSIVE org_tree AS (
//         SELECT id FROM "User" WHERE id = ${userId}
//         UNION ALL
//         SELECT u.id FROM "User" u
//         INNER JOIN org_tree ot ON u."reportingToId" = ot.id
//       )
//       SELECT id FROM org_tree
//       WHERE id != ${userId}
//     `;
//   return rows.map((r) => r.id);
// }
export async function getSubordinateIds(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE org_tree AS (
      SELECT id FROM "User" WHERE id = ${userId}
      UNION ALL
      SELECT u.id FROM "User" u
      INNER JOIN org_tree ot
        ON u."reportingToId" = ot.id
        OR u."teamLeadId"    = ot.id
    )
    SELECT DISTINCT id FROM org_tree
    WHERE id != ${userId}
  `;
  return rows.map((r) => r.id);
}

export async function getFullOrgTree(rootUserId: string) {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      firstName: string;
      lastName: string;
      reportingToId: string | null;
      teamLeadId: string | null;
      depth: number;
    }[]
  >`
      WITH RECURSIVE org_tree AS (
        SELECT id, "firstName", "lastName", "reportingToId", "teamLeadId", 0 as depth
        FROM "User"
        WHERE id = ${rootUserId}
        UNION ALL
        SELECT u.id, u."firstName", u."lastName", u."reportingToId", u."teamLeadId", ot.depth + 1
        FROM "User" u
        INNER JOIN org_tree ot ON u."reportingToId" = ot.id
      )
      SELECT * FROM org_tree ORDER BY depth
    `;
  return rows;
}
