// File: notification.routes.ts
// Path: src/routes/notification.routes.ts
//
// Own notifications only. Rows are created by the system (SPOC assigned,
// note added, step run finished) via services/notification.service.ts.

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate, idParams } from "@/validators/validator";
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
router.delete("/", clearReadNotifications);
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", validate.params(idParams), markAsRead);
router.delete("/:id", validate.params(idParams), deleteNotification);

export default router;
