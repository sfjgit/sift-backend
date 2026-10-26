// File: report.routes.ts
// Path: src/routes/report.routes.ts
//
// reports.read opens the section; the figures themselves stay limited to the
// caller's clients.read / spocs.read / step_runs.read scope (resolved in the controller).

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import {
  breakdownQuery,
  overviewQuery,
  reportActivitiesQuery,
  trendQuery,
} from "@/validators/report.validators";
import {
  getOverview,
  getBreakdown,
  getTrend,
  listReportActivities,
} from "@/controller/report.controller";

const router = Router();

router.use(authenticateUser, authorize("reports.read"));

router.get("/overview", validate.query(overviewQuery), getOverview);
router.get("/breakdown", validate.query(breakdownQuery), getBreakdown);
router.get("/trend", validate.query(trendQuery), getTrend);
router.get("/activities", validate.query(reportActivitiesQuery), listReportActivities);

export default router;
