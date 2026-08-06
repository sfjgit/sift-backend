// File: ticket.routes.ts
// Path: src/routes/ticket.routes.ts

import { Router } from "express";
import multer from "multer";
import { authenticateUser } from "@/middleware/auth";
import * as ticketController from "@/controller/ticket.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

const router = Router();

router.use(authenticateUser);

/* static paths first — otherwise they get matched as :id */
router.get("/meta", ticketController.getMeta);

router.get("/notifications", ticketController.listNotifications);
router.get("/notifications/count", ticketController.notificationCount);
router.post(
  "/notifications/read-all",
  ticketController.markAllNotificationsRead
);
router.patch(
  "/notifications/:notificationId/read",
  ticketController.markNotificationRead
);

router
  .route("/categories")
  .get(ticketController.listCategories)
  .post(ticketController.createCategory);
router.patch("/categories/:id", ticketController.updateCategory);

/* tickets */
router
  .route("/")
  .get(ticketController.list)
  .post(upload.array("files", 10), ticketController.create);

router
  .route("/:id")
  .get(ticketController.getOne)
  .patch(ticketController.update);

/* thread — reply now accepts multipart: body + status + files together */
router
  .route("/:id/comments")
  .get(ticketController.listComments)
  .post(upload.array("files", 5), ticketController.addComment);

/* ticket-level attachments */
router.post(
  "/:id/attachments",
  upload.array("files", 10),
  ticketController.uploadAttachments
);
router.delete(
  "/:id/attachments/:attachmentId",
  ticketController.deleteAttachment
);

export default router;
