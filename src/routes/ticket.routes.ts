// File: ticket.routes.ts
// Path: src/routes/ticket.routes.ts
//
// Support tickets. Anyone signed in can report and follow their own tickets;
// triage needs support.manage, the AI diagnosis support.diagnose.

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import {
  addComment,
  addRecording,
  createTicket,
  diagnoseTicket,
  getAttachment,
  getTicket,
  listTickets,
  requestRepro,
  updateTicket,
} from "@/controller/ticket.controller";

const router = Router();
router.use(authenticateUser);

router.get("/", listTickets);
router.post("/", createTicket);
router.get("/:id", getTicket);
router.get("/:id/attachments/:aid", getAttachment);
router.post("/:id/attachments", addRecording);
router.post("/:id/comments", addComment);
router.patch("/:id", authorize("support.manage"), updateTicket);
router.post("/:id/request-repro", authorize("support.manage"), requestRepro);
router.post("/:id/diagnose", authorize("support.diagnose"), diagnoseTicket);

export default router;
