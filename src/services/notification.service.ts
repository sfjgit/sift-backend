// File: notification.service.ts
// Path: src/services/notification.service.ts

import {
  NotificationReferenceType,
  NotificationSeverity,
  NotificationType,
  Prisma,
} from "@prisma/client";
import prisma from "@/utils/prisma/client";
import type { PermissionKey } from "@/config/permissions.registry";

type Db = Prisma.TransactionClient | typeof prisma;

export type NotificationInput = {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  link?: string | null; // in-app path, e.g. /clients/<id>?tab=pipeline
  referenceId: string;
  referenceType: NotificationReferenceType;
};

// One row per recipient. The actor never notifies themselves.
export const notifyUsers = async (
  db: Db,
  userIds: string[],
  actorId: string | null,
  n: NotificationInput,
) => {
  const recipients = [...new Set(userIds)].filter((id) => id !== actorId);
  if (!recipients.length) return;

  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: n.type,
      severity: n.severity ?? "INFO",
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      referenceId: n.referenceId,
      referenceType: n.referenceType,
    })),
  });
};

// Active users who hold a permission through their role, plus super admins.
export const usersWithPermission = async (key: PermissionKey) =>
  prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ isSuperAdmin: true }, { role: { permissions: { some: { permissionKey: key } } } }],
    },
    select: { id: true, email: true, firstName: true },
  });

export const notifyPermission = async (
  key: PermissionKey,
  actorId: string | null,
  n: NotificationInput,
) => {
  const users = await usersWithPermission(key);
  await notifyUsers(prisma, users.map((u) => u.id), actorId, n);
  return users;
};
