// File: impersonation.routes.ts
// Path: src/routes/impersonation.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { requireSuperAdmin } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  startImpersonation,
  stopImpersonation,
} from "@/controller/impersonation.controller";

const router = Router();

router.post(
  "/users/:id/impersonate",
  authenticateUser,
  requireSuperAdmin,
  validate.params(idParams),
  startImpersonation,
);
// no auth — works even if the impersonated token expired
router.post("/impersonation/stop", stopImpersonation);

export default router;
