// File: clientActivity.service.ts
// Path: src/services/clientActivity.service.ts
//
// Timeline rows shown on the client page. Pass the transaction client so the
// activity commits (or rolls back) with the change it describes.

import { ClientActivityType, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

export const logClientActivity = (
  db: Db,
  data: {
    clientId: string;
    spocId?: string | null;
    actorId: string | null; // null = system / external service
    type: ClientActivityType;
    summary: string;
    meta?: Prisma.InputJsonValue;
  },
) =>
  db.clientActivity.create({
    data: {
      clientId: data.clientId,
      spocId: data.spocId ?? null,
      actorId: data.actorId,
      type: data.type,
      summary: data.summary,
      ...(data.meta !== undefined && { meta: data.meta }),
    },
  });
