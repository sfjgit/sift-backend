// File: impersonation.routes.ts
// Path: src/routes/impersonation.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  startImpersonation,
  stopImpersonation,
} from "@/controller/reports/impersonation.controller";

const router = Router();

router.post("/users/:id/impersonate", authenticateUser, startImpersonation);
router.post("/impersonation/stop", stopImpersonation);

export default router;
