// File: csrSnapshot.service.ts
// Path: src/services/csrSnapshot.service.ts
//
// The newest CSR spent figure, copied onto the client row (csrFy /
// csrSpentRs) so lists filter and sort on it without a join (2M+ clients).
// Call after a client's ClientCsrFinancial rows change.

import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/** Bring the client's CSR snapshot in line with its figures. */
export const syncCsrSnapshot = async (clientId: string, db: Db = prisma): Promise<void> => {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { csrFy: true, csrSpentRs: true },
  });
  if (!client) return;

  const latestSpent = await db.clientCsrFinancial.findFirst({
    where: { clientId, spentRs: { not: null } },
    select: { fy: true, spentRs: true },
    orderBy: { fy: "desc" },
  });
  const snapshot = { csrFy: latestSpent?.fy ?? null, csrSpentRs: latestSpent?.spentRs ?? null };
  if (snapshot.csrFy !== client.csrFy || String(snapshot.csrSpentRs) !== String(client.csrSpentRs)) {
    await db.client.update({ where: { id: clientId }, data: snapshot });
  }
};
