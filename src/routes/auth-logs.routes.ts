// File: auth-logs.routes.ts
// Path: src/routes/auth-logs.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import { listAuthLogsQuery } from "@/validators/authLogs.validators";
import { listAuthLogs } from "@/controller/authLogs.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", authorize("admin.view_auth_logs"), validate.query(listAuthLogsQuery), listAuthLogs);

export default router;
