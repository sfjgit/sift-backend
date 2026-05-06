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

const router = Router();
import notificationRoutes from "./notification.routes";
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

export default router;
