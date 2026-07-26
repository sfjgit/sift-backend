// File: auth-logs.routes.ts
// Path: src/routes/auth-logs.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { scopeFilter } from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import { listAuthLogsQuery } from "@/validators/authLogs.validators";
import { listAuthLogs } from "@/controller/authLogs.controller";

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("auth-logs"));

// GET /auth-logs
router.get("/", validate.query(listAuthLogsQuery), listAuthLogs);

export default router;
