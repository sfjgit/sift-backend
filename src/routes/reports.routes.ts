// File: reports.routes.ts
// Path: src/routes/reports.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { scopeFilter } from "@/middleware/scopeFilter.middleware";
import {
  getReportsOverview,
  getRecruiterReport,
  exportRecruiterReport,
  getRequirementReport,
  exportRequirementReport,
  getCandidateReport,
  exportCandidateReport,
} from "@/controller/reports.controller";

const router = Router();
const auth = authenticateUser;
const scope = scopeFilter("reports");

// ── Overview / monitoring dashboard ───────────────────────────────────────────
// GET  /reports/overview → KPIs, funnel, time-series, disposition split, leaderboard
router.get("/overview", auth, scope, getReportsOverview);

// ── Recruiter reports ─────────────────────────────────────────────────────────
// GET  /reports/recruiters          → per-recruiter stats with requirement breakdown
// GET  /reports/recruiters/export   → XLSX (?ids=, ?requirementId=, ?standardOnly=)
router.get("/recruiters", auth, scope, getRecruiterReport);
router.get("/recruiters/export", auth, scope, exportRecruiterReport);

// ── Requirement reports ───────────────────────────────────────────────────────
// GET  /reports/requirements            → requirement list with per-row candidate stats
// GET  /reports/requirements/export     → XLSX (?ids= for selected, else all + candidates)
// GET  /reports/requirements/:id/export → single requirement XLSX
router.get("/requirements", auth, scope, getRequirementReport);
router.get("/requirements/export", auth, scope, exportRequirementReport);
router.get("/requirements/:id/export", auth, scope, exportRequirementReport);

// ── Candidate funnel report ───────────────────────────────────────────────────
router.get("/candidates", auth, scope, getCandidateReport);
router.get("/candidates/export", auth, scope, exportCandidateReport);

export default router;
