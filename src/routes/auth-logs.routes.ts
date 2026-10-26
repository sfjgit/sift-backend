// File: auth-logs.routes.ts
// Path: src/routes/auth-logs.routes.ts
//
// Mounted at /auth-logs and /audit-logs (see routes/index.ts).

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import { listAuditLogsQuery, listAuthLogsQuery } from "@/validators/authLogs.validators";
import { listAuthLogs } from "@/controller/authLogs.controller";
import { listAuditLogs } from "@/controller/auditLog.controller";

export const authLogRoutes = Router()
  .use(authenticateUser)
  .get(
    "/",
    authorize("audit.view_login_history"),
    validate.query(listAuthLogsQuery),
    listAuthLogs,
  );

export const auditLogRoutes = Router()
  .use(authenticateUser)
  .get("/", authorize("audit.view_audit_log"), validate.query(listAuditLogsQuery), listAuditLogs);
