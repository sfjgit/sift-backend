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

/* static paths first — otherwise "meta" / "categories" get matched as :id */
router.get("/meta", ticketController.getMeta);

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

/* thread */
router
  .route("/:id/comments")
  .get(ticketController.listComments)
  .post(ticketController.addComment);

/* attachments */
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
