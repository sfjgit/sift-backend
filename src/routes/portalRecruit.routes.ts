// File: portalRecruit.routes.ts
// Path: src/routes/portalRecruit.routes.ts

import { Router } from "express";
import {
  logPortalRecruit,
  getPortalRecruitStatus,
  getPortalRecruitLogs,
  exportPortalRecruitLogs, // ← NEW
} from "@/controller/portalRecruit.controller";
import { scopeFilter } from "@/middleware/scopeFilter.middleware";

const router = Router();

router.post("/log", logPortalRecruit);
router.get("/status", getPortalRecruitStatus);
router.get("/logs", scopeFilter("assignments"), getPortalRecruitLogs);

// ← NEW: CSV export (same RBAC + same filters as /logs)
router.get("/logs/export", scopeFilter("assignments"), exportPortalRecruitLogs);

export default router;
