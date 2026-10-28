// File: outreach.routes.ts
// Path: src/routes/outreach.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import { listOutreachQuery } from "@/validators/stepRun.validators";
import { editMessageBody, markSentBody, messageParams, packParams, packStatusBody } from "@/validators/outreach.validators";
import {
  editOutreachMessage,
  getOutreachPack,
  listOutreach,
  markOutreachSent,
  setOutreachStatus,
} from "@/controller/outreach.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", authorize("outreach.read"), validate.query(listOutreachQuery), listOutreach);
router.get("/:id", authorize("outreach.read"), validate.params(packParams), getOutreachPack);
router.patch("/:id/status", authorize("outreach.manage"), validate.request({ params: packParams, body: packStatusBody }), setOutreachStatus);
router.patch(
  "/:id/messages/:messageId",
  authorize("outreach.manage"),
  validate.request({ params: messageParams, body: editMessageBody }),
  editOutreachMessage,
);
router.patch(
  "/:id/messages/:messageId/sent",
  authorize("outreach.manage"),
  validate.request({ params: messageParams, body: markSentBody }),
  markOutreachSent,
);

export default router;
