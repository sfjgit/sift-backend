// File: reports.routes.ts
// Path: src/routes/reports.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { scopeFilter } from "@/middleware/scopeFilter.middleware";

import {
  getReportsOverview,
  getOverviewFilters,
} from "@/controller/reports/reports.overview.controller";
import { getOverviewDrill } from "@/controller/reports/reports.overview.drill.controller";
import { getMyRequirements } from "@/controller/reports/reports.my.requirements.controller";
import {
  getSalesReport,
  getSalesDrillByReq,
} from "@/controller/reports/reports.sales.controller";
import {
  getRecruiterReport,
  exportRecruiterReport,
  getRequirementReport,
  exportRequirementReport,
  getCandidateReport,
  exportCandidateReport,
} from "@/controller/reports/reports.controller";

const router = Router();
const auth = authenticateUser;
const scope = scopeFilter("reports");

router.get("/overview", auth, scope, getReportsOverview);
router.get("/overview/filters", auth, getOverviewFilters);
router.get("/overview/drill", auth, scope, getOverviewDrill);

router.get("/my-requirements", auth, getMyRequirements);

// Sales tab — drill returns requirement-level stats, not candidate list
router.get("/sales", auth, scope, getSalesReport);
router.get("/sales/drill", auth, scope, getSalesDrillByReq);

router.get("/recruiters", auth, scope, getRecruiterReport);
router.get("/recruiters/export", auth, scope, exportRecruiterReport);

router.get("/requirements", auth, scope, getRequirementReport);
router.get("/requirements/export", auth, scope, exportRequirementReport);
router.get("/requirements/:id/export", auth, scope, exportRequirementReport);

router.get("/candidates", auth, scope, getCandidateReport);
router.get("/candidates/export", auth, scope, exportCandidateReport);

export default router;
