// File: index.ts
// Path: src/routes/index.ts

import { Router } from "express";
import authRoutes from "./auth.routes";
import meRoutes from "./me.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";
import permissionRoutes from "./permission.routes";
import businessUnitRoutes from "./businessUnit.routes";
import { masterRouter } from "./master.routes";
import lookupRoutes from "./lookup.routes";
import clientRoutes from "./client.routes";
import spocRoutes from "./spoc.routes";
import notificationRoutes from "./notification.routes";
import authLogRoutes from "./auth-logs.routes";
import impersonationRoutes from "./impersonation.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/me", meRoutes);

// org + admin
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/permissions", permissionRoutes);
router.use("/business-units", businessUnitRoutes);
router.use("/service-lines", masterRouter("serviceLine", "Service line"));
router.use("/departments", masterRouter("department", "Department"));
router.use("/designations", masterRouter("designation", "Designation"));
router.use("/lookups", lookupRoutes);
router.use("/auth-logs", authLogRoutes);
router.use("/admin", impersonationRoutes);

// CRM
router.use("/clients", clientRoutes);
router.use("/spocs", spocRoutes);
router.use("/notifications", notificationRoutes);

export default router;
