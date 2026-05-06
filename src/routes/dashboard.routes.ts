// routes/dashboard.routes.ts
import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  getDashboardActivity,
  getDashboardStats,
  getMyAssignments,
} from "@/controller/dashboard.controller";
// import {
//   getDashboardStats,
//   getMyAssignments,
// } from "@/controller/dashboard.controller";

const router = Router();

router.use(authenticateUser);

// in dashboard.routes.ts
router.get("/activity", getDashboardActivity);

router.get("/stats", getDashboardStats);
router.get("/my-assignments", getMyAssignments);

export default router;
