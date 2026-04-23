import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";
import businessUnitRoutes from "./businessUnit.routes";
import teamRoutes from "./team.routes";
import clientRoutes from "./client.routes";
import requirementRoutes from "./requirements.routes";
import orgFlowRoutes from "./orgFlow.routes";
import { getDashboardSummary } from "@/controller/dashboard.Controller";
import { authenticateUser } from "@/middleware/auth";

const router = Router();

router.use("/auth", authRoutes);

// In your routes file
router.get("/dashboard/summary", authenticateUser, getDashboardSummary);

router.use("/users", userRoutes);

router.use("/roles", roleRoutes);

router.use("/clients", clientRoutes);

router.use("/business-units", businessUnitRoutes);

// router.use("/teams", teamRoutes);

// router.use("/business-units", businessUnitRoutes);

router.use("/teams", teamRoutes);

router.use("/requirements", requirementRoutes);
router.use("/org-flow", orgFlowRoutes);

export default router;
