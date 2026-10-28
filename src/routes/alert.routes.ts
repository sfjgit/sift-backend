// File: alert.routes.ts
// Path: src/routes/alert.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import { listAlertsQuery, resolveAlertsBody } from "@/validators/alert.validators";
import { listAlerts, resolveAlerts } from "@/controller/alert.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", authorize("system_alerts.read"), validate.query(listAlertsQuery), listAlerts);
router.post("/resolve", authorize("system_alerts.manage"), validate.body(resolveAlertsBody), resolveAlerts);

export default router;
