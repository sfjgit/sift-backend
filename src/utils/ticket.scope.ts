// File: ticket.scope.ts
// Path: src/utils/ticket.scope.ts

import type { Prisma } from "@prisma/client";

/**
 * Single place that decides what a user can see.
 * Default: tickets they raised or are assigned to.
 * Swap the bypass condition once RBAC middleware lands — nothing else changes.
 */
export const buildTicketScope = (user: {
  id: string;
  role?: string | null;
}): Prisma.TicketWhereInput => {
  const allTicketRoles = (process.env.TICKET_ALL_ACCESS_ROLES ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  if (user.role && allTicketRoles.includes(user.role)) return {};

  return {
    OR: [{ raisedById: user.id }, { assignedToId: user.id }],
  };
};
