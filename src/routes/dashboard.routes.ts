// File: dashboard.routes.ts
// Path: src/routes/dashboard.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  getDashboardStats,
  getPipelineOverview,
  getMyAssignments,
  getDashboardActivity,
} from "@/controller/dashboard.controller";

const router = Router();

router.use(authenticateUser);

router.get("/stats", getDashboardStats);
router.get("/pipeline-overview", getPipelineOverview);
router.get("/my-assignments", getMyAssignments);
router.get("/activity", getDashboardActivity);

export default router;
