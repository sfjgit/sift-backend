// File: csrSnapshot.service.ts
// Path: src/services/csrSnapshot.service.ts
//
// The newest CSR spent figure, kept on the client's CSR add-on (ClientCsr.latestFy / latestSpentRs)
// so lists filter and sort on it with one indexed join (Client.isCsr narrows to CSR clients first).
// Call after a client's ClientCsrFinancial rows change. Creating the ClientCsr row also sets
// Client.isCsr (database trigger).

import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/** Bring the client's CSR snapshot in line with its figures. */
export const syncCsrSnapshot = async (clientId: string, db: Db = prisma): Promise<void> => {
  const csr = await db.clientCsr.findUnique({ where: { clientId }, select: { latestFy: true, latestSpentRs: true } });
  const latestSpent = await db.clientCsrFinancial.findFirst({
    where: { clientId, spentRs: { not: null } },
    select: { fy: true, spentRs: true },
    orderBy: { fy: "desc" },
  });
  const snapshot = { latestFy: latestSpent?.fy ?? null, latestSpentRs: latestSpent?.spentRs ?? null };
  if (!csr) {
    // CSR figures without a CSR profile yet → the profile starts here
    if (snapshot.latestFy) await db.clientCsr.create({ data: { clientId, ...snapshot } });
    return;
  }
  if (snapshot.latestFy !== csr.latestFy || String(snapshot.latestSpentRs) !== String(csr.latestSpentRs)) {
    await db.clientCsr.update({ where: { clientId }, data: snapshot });
  }
};
