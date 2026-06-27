// File: reports.routes.ts
// Path: src/routes/reports.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { scopeFilter } from "@/middleware/scopeFilter.middleware";
import {
  getRecruiterReport,
  exportRecruiterReport,
  getRequirementReport,
  exportRequirementReport,
  getAssignmentReport,
  exportAssignmentReport,
  getCandidateReport,
  exportCandidateReport,
} from "@/controller/reports.controller";

const router = Router();
const auth = authenticateUser;
const scope = scopeFilter("reports");

// ── Recruiter reports ─────────────────────────────────────────────────────────
// GET  /reports/recruiters          → per-recruiter stats with requirement breakdown
// GET  /reports/recruiters/export   → XLSX (view=summary|funnel|pipeline)
router.get("/recruiters", auth, scope, getRecruiterReport);
router.get("/recruiters/export", auth, scope, exportRecruiterReport);

// ── Requirement reports ───────────────────────────────────────────────────────
// GET  /reports/requirements        → requirement list with per-row candidate stats
// GET  /reports/requirements/export → XLSX (all requirements + candidates sheet)
// GET  /reports/requirements/:id/export → single requirement XLSX
router.get("/requirements", auth, scope, getRequirementReport);
router.get("/requirements/export", auth, scope, exportRequirementReport);
router.get("/requirements/:id/export", auth, scope, exportRequirementReport);

// ── Assignment reports ────────────────────────────────────────────────────────
// GET  /reports/assignments         → assignment list with candidate stats
// GET  /reports/assignments/export  → XLSX (all assignments + candidates sheet)
// GET  /reports/assignments/:id/export → single assignment XLSX
router.get("/assignments", auth, scope, getAssignmentReport);
router.get("/assignments/export", auth, scope, exportAssignmentReport);
router.get("/assignments/:id/export", auth, scope, exportAssignmentReport);

// ── Candidate funnel report ───────────────────────────────────────────────────
router.get("/candidates", auth, scope, getCandidateReport);
router.get("/candidates/export", auth, scope, exportCandidateReport);

export default router;
