// File: reports.routes.ts
// Path: src/routes/reports.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { scopeFilter } from "@/middleware/scopeFilter.middleware";

import {
  getReportsOverview,
  getOverviewFilters,
} from "@/controller/reports/reports.overview.controller";
import {
  getOverviewDrill,
  getRequirementCandidateDrill,
} from "@/controller/reports/reports.overview.drill.controller";
import { getMyRequirements } from "@/controller/reports/reports.my.requirements.controller";
import {
  getSalesReport,
  getSalesDrillByReq,
} from "@/controller/reports/reports.sales.controller";
import {
  getRecruiterReport,
  exportRecruiterReport,
  // exportRequirementReport,
  getCandidateReport,
  exportCandidateReport,
} from "@/controller/reports/reports.controller";

import {
  getRecruiterActivity,
  getRecruiterActivityDrill,
  exportRecruiterActivity,
  getActivityExportColumns,
} from "@/controller/reports/reports.recruiter.activity.controller";

// getRequirementReport now lives in its own controller —
// it returns saleValueSummary and enriched rows with computedSaleValue etc.
import { getRequirementReport } from "@/controller/reports/reports.requirements.controller";
import { exportRequirementReport } from "@/controller/reports/reports.requirements.export.controller";

import { getRecruiterStats } from "@/controller/reports/reports.recruiter.stats.controller";
import {
  getRecruiterDrill,
  getRecruiterDrillMojOptions,
} from "@/controller/reports/reports.recruiter.drill.controller";

import {
  getCandidatesList,
  getCandidatesStats,
  getCandidatesFilters,
  getCandidatesDrill,
} from "@/controller/reports/reports.candidates.controller";
import {
  exportCandidates,
  getCandidateExportColumns,
} from "@/controller/reports/reports.candidates.export.controller";
import { getFunnelStats } from "@/controller/reports/reports.funnel.stats.controller";

const router = Router();
const auth = authenticateUser;
const scope = scopeFilter("reports");

// ── Overview ────────────────────────────────────────────────────────────────
router.get("/overview", auth, scope, getReportsOverview);
router.get("/overview/filters", auth, getOverviewFilters);
router.get("/overview/drill", auth, scope, getOverviewDrill);

// ── My requirements ─────────────────────────────────────────────────────────
router.get("/my-requirements", auth, getMyRequirements);

// ── Sales ────────────────────────────────────────────────────────────────────
router.get("/sales", auth, scope, getSalesReport);
router.get("/sales/drill", auth, scope, getSalesDrillByReq);

// ── Recruiters — ORDER MATTERS: specific routes before param routes ──────────
router.get(
  "/recruiters/activity/drill",
  auth,
  scope,
  getRecruiterActivityDrill
);

router.get(
  "/recruiters/drill/moj-options",
  auth,
  scope,
  getRecruiterDrillMojOptions
);
router.get("/recruiters/drill", auth, scope, getRecruiterDrill);
router.get(
  "/recruiters/activity/export/columns",
  auth,
  scope,
  getActivityExportColumns
);
router.get("/recruiters/stats", auth, scope, getRecruiterStats);
router.get("/recruiters/activity/export", auth, scope, exportRecruiterActivity);
router.get("/recruiters/activity", auth, scope, getRecruiterActivity);
router.get("/recruiters/export", auth, scope, exportRecruiterReport);
router.get("/recruiters", auth, scope, getRecruiterReport);

// ── Recruiters ───────────────────────────────────────────────────────────────
// router.get("/recruiters", auth, scope, getRecruiterReport);
// router.get("/recruiters/export", auth, scope, exportRecruiterReport);

// ── Requirements — ORDER MATTERS ─────────────────────────────────────────────
// Specific string routes MUST come before param routes.
// If /:requirementId/candidates were before /export, Express would match
// the literal string "export" as requirementId and call the wrong handler.
router.get("/requirements", auth, scope, getRequirementReport);
router.get("/requirements/export", auth, scope, exportRequirementReport);
router.get("/requirements/funnel-stats", auth, scope, getFunnelStats);
router.get(
  "/requirements/:requirementId/candidates",
  auth,
  scope,
  getRequirementCandidateDrill
);
router.get("/requirements/:id/export", auth, scope, exportRequirementReport);

router.get(
  "/candidates/export/columns",
  auth,
  scope,
  getCandidateExportColumns
);
router.get("/candidates/filters", auth, scope, getCandidatesFilters);
router.get("/candidates/stats", auth, scope, getCandidatesStats);
router.get("/candidates/drill", auth, scope, getCandidatesDrill);
router.get("/candidates/list", auth, scope, getCandidatesList);

// ── Candidates ───────────────────────────────────────────────────────────────
router.get("/candidates", auth, scope, getCandidateReport);
router.get("/candidates/export", auth, scope, exportCandidateReport);

export default router;
