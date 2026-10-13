// File: applicant.routes.ts
// Path: src/routes/applicant.routes.ts

import { Router } from "express";
import { checkPermission } from "@/middleware/scopeFilter.middleware";
import { authenticateUser } from "@/middleware/auth";
import {
  assignApplicants,
  listApplicantRequirements,
  listApplicants,
} from "@/controller/applicants.controller";

const router = Router();
const auth = authenticateUser;

// order matters — /requirements before any /:id route
router.get("/requirements", auth, listApplicantRequirements);
router.get("/", auth, listApplicants);
router.post(
  "/assign",
  auth,

  checkPermission("canEdit"),
  assignApplicants,
);

export default router;
