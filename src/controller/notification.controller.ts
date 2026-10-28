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

    const take = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;

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
          severity: true,
          title: true,
          body: true,
          link: true,
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
    const { id } = req.validatedParams;
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
    const { id } = req.validatedParams;
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
