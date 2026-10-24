// File: notification.service.ts
// Path: src/services/notification.service.ts

import { NotificationReferenceType, NotificationType, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

// One row per recipient. The actor never notifies themselves.
export const notifyUsers = async (
  db: Db,
  userIds: string[],
  actorId: string | null,
  n: {
    type: NotificationType;
    title: string;
    body?: string | null;
    referenceId: string;
    referenceType: NotificationReferenceType;
  },
) => {
  const recipients = [...new Set(userIds)].filter((id) => id !== actorId);
  if (!recipients.length) return;

  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      referenceId: n.referenceId,
      referenceType: n.referenceType,
    })),
  });
};
