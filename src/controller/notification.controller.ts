// controller/notification.controller.ts
import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

// GET /notifications
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      isRead,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 50);

    const where: any = { userId };
    if (isRead !== undefined) where.isRead = isRead === "true";

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          referenceId: true,
          referenceType: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      success: true,
      data: notifications,
      meta: {
        total,
        unread: await prisma.notification.count({
          where: { userId, isRead: false },
        }),
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getNotifications:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch notifications" });
  }
};

// PATCH /notifications/:id/read
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      res
        .status(404)
        .json({ success: false, message: "Notification not found" });
      return;
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    console.error("markAsRead:", err);
    res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
};

// PATCH /notifications/read-all
export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    console.error("markAllAsRead:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to mark all as read" });
  }
};

// DELETE /notifications/:id
export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      res
        .status(404)
        .json({ success: false, message: "Notification not found" });
      return;
    }

    await prisma.notification.delete({ where: { id } });
    res.json({ success: true, message: "Notification deleted" });
  } catch (err) {
    console.error("deleteNotification:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete notification" });
  }
};

// DELETE /notifications — clear all read
export const clearReadNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const { count } = await prisma.notification.deleteMany({
      where: { userId, isRead: true },
    });

    res.json({ success: true, message: `Cleared ${count} notifications` });
  } catch (err) {
    console.error("clearReadNotifications:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to clear notifications" });
  }
};

// ─────────────────────────────────────────
// POST /notifications/send
//
// SuperAdmin / any permitted actor sends a manual
// notification to a SINGLE user.
//
// Body:
//   userId        string   — recipient
//   type          NotificationType
//   title         string
//   body?         string
//   referenceId   string
//   referenceType NotificationReferenceType
// ─────────────────────────────────────────

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    if (!isSuperAdmin) {
      res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Only super admins can send manual notifications",
      });
      return;
    }

    const { userId, type, title, body, referenceId, referenceType } = req.body;

    if (!userId || !type || !title || !referenceId || !referenceType) {
      res.status(422).json({
        success: false,
        code: "MISSING_FIELDS",
        message:
          "userId, type, title, referenceId and referenceType are required",
      });
      return;
    }

    const recipient = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, firstName: true, lastName: true },
    });

    if (!recipient) {
      res.status(404).json({ success: false, message: "Recipient not found" });
      return;
    }

    if (!recipient.isActive) {
      res.status(400).json({
        success: false,
        code: "USER_INACTIVE",
        message: "Cannot notify an inactive user",
      });
      return;
    }

    const notif = await prisma.$transaction(async (tx) => {
      const n = await tx.notification.create({
        data: {
          userId,
          type,
          title,
          body: body ?? null,
          referenceId,
          referenceType,
          isRead: false,
        },
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          referenceId: true,
          referenceType: true,
          createdAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "SEND_NOTIFICATION",
          module: "notifications",
          recordId: n.id,
          newData: { recipientId: userId, type, title },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return n;
    });

    res.status(201).json({
      success: true,
      message: `Notification sent to ${recipient.firstName} ${recipient.lastName}`,
      data: notif,
    });
  } catch (err) {
    console.error("sendNotification:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to send notification" });
  }
};

// ─────────────────────────────────────────
// POST /notifications/broadcast
//
// Send the SAME notification to multiple users at once.
// SuperAdmin only.
//
// Body:
//   userIds?       string[]   — explicit list  (one of userIds / filters required)
//   filters?:
//     roleId?       string
//     departmentId? string
//     isActive?     boolean    (default: true)
//   type          NotificationType
//   title         string
//   body?         string
//   referenceId   string
//   referenceType NotificationReferenceType
//
// Priority: if userIds is provided, filters are ignored.
// ─────────────────────────────────────────

export const broadcastNotification = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    if (!isSuperAdmin) {
      res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Only super admins can broadcast notifications",
      });
      return;
    }

    const { userIds, filters, type, title, body, referenceId, referenceType } =
      req.body;

    if (!type || !title || !referenceId || !referenceType) {
      res.status(422).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "type, title, referenceId and referenceType are required",
      });
      return;
    }

    const hasExplicitList = Array.isArray(userIds) && userIds.length > 0;
    const hasFilters = filters && typeof filters === "object";

    if (!hasExplicitList && !hasFilters) {
      res.status(422).json({
        success: false,
        code: "NO_TARGET",
        message: "Provide either userIds[] or a filters object",
      });
      return;
    }

    // ── resolve target user IDs ───────────────────────────────────────────────
    let targetIds: string[] = [];

    if (hasExplicitList) {
      // validate all IDs exist and are active
      const found = await prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true },
      });
      targetIds = found.map((u) => u.id);

      if (targetIds.length === 0) {
        res.status(404).json({
          success: false,
          code: "NO_VALID_RECIPIENTS",
          message: "None of the provided user IDs are active",
        });
        return;
      }
    } else {
      // build where from filters
      const userWhere: any = {
        isActive: filters.isActive !== false, // default true
      };
      if (filters.roleId) userWhere.roleId = filters.roleId;
      if (filters.departmentId) userWhere.departmentId = filters.departmentId;

      const found = await prisma.user.findMany({
        where: userWhere,
        select: { id: true },
      });
      targetIds = found.map((u) => u.id);

      if (targetIds.length === 0) {
        res.status(404).json({
          success: false,
          code: "NO_MATCHING_USERS",
          message: "No active users match the provided filters",
        });
        return;
      }
    }

    // ── createMany — one row per recipient ────────────────────────────────────
    const now = new Date();

    const { count } = await prisma.$transaction(async (tx) => {
      const result = await tx.notification.createMany({
        data: targetIds.map((uid) => ({
          userId: uid,
          type,
          title,
          body: body ?? null,
          referenceId,
          referenceType,
          isRead: false,
          // createdAt handled by @default(now()) — no need to pass
        })),
        skipDuplicates: false,
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "BROADCAST_NOTIFICATION",
          module: "notifications",
          recordId: referenceId,
          newData: {
            type,
            title,
            recipientCount: result.count,
            targetIds: hasExplicitList ? userIds : "filter-based",
            filters: hasFilters ? filters : null,
          },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return result;
    });

    res.status(201).json({
      success: true,
      message: `Broadcast sent to ${count} user(s)`,
      data: { recipientCount: count },
    });
  } catch (err) {
    console.error("broadcastNotification:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to broadcast notification" });
  }
};
