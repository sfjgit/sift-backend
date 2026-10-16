// File: applicant.routes.ts
// Path: src/routes/applicant.routes.ts

import {
  assignApplicants,
  exportApplicants,
  listApplicants,
} from "@/controller/applicants.controller";
import { authenticateUser } from "@/middleware/auth";
import { Router } from "express";

const router = Router();
const auth = authenticateUser;

router.get("/", auth, listApplicants);
router.get("/export", auth, exportApplicants);

router.post("/assign", auth, assignApplicants);

export default router;
