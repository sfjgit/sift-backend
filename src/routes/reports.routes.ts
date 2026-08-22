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

// getRequirementReport now lives in its own controller —
// it returns saleValueSummary and enriched rows with computedSaleValue etc.
import { getRequirementReport } from "@/controller/reports/reports.requirements.controller";
import { exportRequirementReport } from "@/controller/reports/reports.requirements.export.controller";

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

// ── Recruiters ───────────────────────────────────────────────────────────────
router.get("/recruiters", auth, scope, getRecruiterReport);
router.get("/recruiters/export", auth, scope, exportRecruiterReport);

// ── Requirements — ORDER MATTERS ─────────────────────────────────────────────
// Specific string routes MUST come before param routes.
// If /:requirementId/candidates were before /export, Express would match
// the literal string "export" as requirementId and call the wrong handler.
router.get("/requirements", auth, scope, getRequirementReport);
router.get("/requirements/export", auth, scope, exportRequirementReport);
router.get(
  "/requirements/:requirementId/candidates",
  auth,
  scope,
  getRequirementCandidateDrill
);
router.get("/requirements/:id/export", auth, scope, exportRequirementReport);

// ── Candidates ───────────────────────────────────────────────────────────────
router.get("/candidates", auth, scope, getCandidateReport);
router.get("/candidates/export", auth, scope, exportCandidateReport);

export default router;
