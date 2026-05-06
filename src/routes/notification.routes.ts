// routes/notification.routes.ts
import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
} from "@/controller/notification.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", getNotifications);
router.patch("/read-all", markAllAsRead);
router.delete("/", clearReadNotifications);
router.patch("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);

export default router;
