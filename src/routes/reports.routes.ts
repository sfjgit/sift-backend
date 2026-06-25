// File: reports.routes.ts
// Path: src/routes/reports.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import {
  getRecruiterReport,
  exportRecruiterReport,
  getCandidateReport,
  exportCandidateReport,
  getRequirementReport,
  exportReportPDF,
} from "@/controller/reports.controller";

const router = Router();
const scope = scopeFilter("reports");

// ── Recruiter reports
// GET /reports/recruiters              → JSON dashboard stats
// GET /reports/recruiters/export       → XLSX download
router.get("/recruiters", authenticateUser, scope, getRecruiterReport);
router.get(
  "/recruiters/export",
  authenticateUser,
  scope,
  exportRecruiterReport
);

// ── Candidate reports
// GET /reports/candidates              → funnel stats JSON
// GET /reports/candidates/export       → XLSX download
//   ?canonicalStage=SCREENING          → filter export by stage
//   ?disposition=ACTIVE                → filter export by disposition
router.get("/candidates", authenticateUser, scope, getCandidateReport);
router.get(
  "/candidates/export",
  authenticateUser,
  scope,
  exportCandidateReport
);

// ── Requirement reports
// GET /reports/requirements            → grouped stats JSON
router.get("/requirements", authenticateUser, scope, getRequirementReport);

// ── PDF export — Puppeteer + Chart.js
// GET /reports/pdf/recruiters          → bar chart PDF
// GET /reports/pdf/candidates          → funnel chart PDF
// GET /reports/pdf/requirements        → status chart PDF
router.get("/pdf/:type", authenticateUser, scope, exportReportPDF);

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// Register in main app:
//
//   import reportsRouter from "@/routes/reports.routes";
//   app.use("/reports", reportsRouter);
//
// ─────────────────────────────────────────────────────────────────────────────
//
// GLOBAL QUERY PARAMS (every route):
//   clientId       → filter by client
//   buId           → filter by BU (ancestorIds — picks up child BUs too)
//   serviceLineId  → filter by service line
//   fromDate       → ISO date, scoped to requirement.createdAt
//   toDate         → ISO date, scoped to requirement.createdAt
//
// RECRUITER-SPECIFIC:
//   recruiterId    → drill into a single recruiter
//
// CANDIDATE-SPECIFIC:
//   canonicalStage → export filter (e.g. SCREENING, INTERVIEW)
//   disposition    → export filter (ACTIVE, PLACED, DROPPED…)
// ─────────────────────────────────────────────────────────────────────────────
