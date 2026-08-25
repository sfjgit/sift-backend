import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";
import businessUnitRoutes from "./businessUnit.routes";
import clientRoutes from "./client.routes";
import requirementRoutes from "./requirements.routes";
import dashboardRoutes from "./dashboard.routes";
import departmentRoutes from "./department.routes";
import serviceLineRoutes from "./serviceLine.routes";
// import pipelineStages from "./pipelineStage.routes";
import pipelineRoutes from "@/routes/pipeline.routes";
import pipelineStageRoutes from "@/routes/pipelineStage.routes";
import notificationRoutes from "./notification.routes";
import internalRoutes from "@/routes/internal.routes";
import moduleRoutes from "./module.routes";
import jdRoutes from "./jd.routes";
import assignmentRoutes from "./assignment.routes";
import candidateRoutes from "./candidate.routes";
import reportRoutes from "./reports.routes";
import authLogs from "./auth-logs.routes";
import internalUsers from "./internal-users.routes";
import { authenticateUser } from "@/middleware/auth";
import naukriAccountabilityRoutes from "./naukriAccountability.routes";
import ticketRoutes from "./ticket.routes";
import publicRoutes from "./public.routes";
import requirementCategoryRoutes from "./requirementCategory.routes";

const router = Router();

// in your core router index, behind auth:
router.use("/naukri", authenticateUser, naukriAccountabilityRoutes);
router.use("/tickets", ticketRoutes);
router.use("/reports", reportRoutes);
router.use("/internal-users", internalUsers);
router.use("/auth-logs", authLogs);
router.use("/modules", moduleRoutes);
router.use("/jd", jdRoutes);
router.use("/internal", internalRoutes);
router.use("/notifications", notificationRoutes);
router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/clients", clientRoutes);
router.use("/business-units", businessUnitRoutes);
router.use("/departments", departmentRoutes);
router.use("/service-lines", serviceLineRoutes);
router.use("/requirements", requirementRoutes);
router.use("/requirementCategories", requirementCategoryRoutes);
router.use("/pipeline", pipelineRoutes);
router.use("/pipeline-stages", pipelineStageRoutes);
router.use("/assignments", assignmentRoutes);
router.use("/candidates", candidateRoutes); // ← new, clean, no nesting
router.use("/public", publicRoutes); // ← new, clean, no nesting

export default router;
