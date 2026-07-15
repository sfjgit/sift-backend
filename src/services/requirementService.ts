// services/requirementService.ts
import prisma from "@/utils/prisma/client";
import { getSubordinateIds } from "./orgService";

// generates REQ-2025-0001 style codes
// export async function generateReqCode(): Promise<string> {
//   const year = new Date().getFullYear();
//   const prefix = `REQ-${year}-`;

//   const last = await prisma.requirement.findFirst({
//     where: { reqCode: { startsWith: prefix } },
//     orderBy: { createdAt: "desc" },
//     select: { reqCode: true },
//   });

//   const lastNum = last ? parseInt(last.reqCode.replace(prefix, "")) : 0;

//   const next = String(lastNum + 1).padStart(4, "0");
//   return `${prefix}${next}`;
// }

export async function generateReqCode(
  clientName: string,
  serviceLineName: string,
): Promise<string> {
  const year = new Date().getFullYear();

  // 4 uppercase letters — handles KAAS, TAAS style naming
  const clientCode = clientName
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, "X");

  const slCode = serviceLineName
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, "X");

  const prefix = `REQ-${slCode}-${clientCode}-${year}-`;

  const last = await prisma.requirement.findFirst({
    where: { reqCode: { startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    select: { reqCode: true },
  });

  const lastNum = last ? parseInt(last.reqCode.replace(prefix, ""), 10) : 0;

  const next = String(lastNum + 1).padStart(4, "0");
  return `${prefix}${next}`;
}

// resolves what requirements a user can see
// based on their position in the reporting tree
export async function getRequirementScopeWhere(
  userId: string,
  isSuperAdmin: boolean,
) {
  if (isSuperAdmin) return { deletedAt: null };

  // get everyone below this user in the tree
  const subordinateIds = await getSubordinateIds(userId);
  const visibleUserIds = [userId, ...subordinateIds];

  return {
    deletedAt: null,
    OR: [
      // requirements they created
      { createdById: { in: visibleUserIds } },
      // requirements assigned to them or anyone below them
      {
        assignments: {
          some: {
            assignedToId: { in: visibleUserIds },
            status: "ACTIVE",
          },
        },
      },
    ],
  };
}
