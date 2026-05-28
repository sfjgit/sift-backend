// routes/notification.routes.ts
import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  sendNotification,
  broadcastNotification,
} from "@/controller/notification.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", getNotifications);
router.delete("/", clearReadNotifications);

// ── Admin send / broadcast ────────────────────────────────────────────────────
// POST /notifications/send     → single user
// POST /notifications/broadcast → bulk
router.post("/send", sendNotification);
router.post("/broadcast", broadcastNotification);

router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);

export default router;
