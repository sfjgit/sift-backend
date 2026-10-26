// File: faq.routes.ts
// Path: src/routes/faq.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  createFaqBody,
  faqFeedbackBody,
  listFaqsQuery,
  updateFaqBody,
} from "@/validators/faq.validators";
import {
  listFaqs,
  listFaqCategories,
  createFaq,
  updateFaq,
  deleteFaq,
  faqFeedback,
} from "@/controller/faq.controller";

const router = Router();
const manage = authorize("help.manage");

router.use(authenticateUser);

router.get("/", validate.query(listFaqsQuery), listFaqs);
router.get("/categories", listFaqCategories);
router.post("/", manage, validate.body(createFaqBody), createFaq);
router.put("/:id", manage, validate.request({ params: idParams, body: updateFaqBody }), updateFaq);
router.delete("/:id", manage, validate.params(idParams), deleteFaq);

// any logged-in reader
router.post(
  "/:id/feedback",
  validate.request({ params: idParams, body: faqFeedbackBody }),
  faqFeedback,
);

export default router;
