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
import { authLogRoutes, auditLogRoutes } from "./auth-logs.routes";
import impersonationRoutes from "./impersonation.routes";
import reportRoutes from "./report.routes";
import searchRoutes from "./search.routes";
import viewRoutes from "./view.routes";
import faqRoutes from "./faq.routes";
import pipelineStepRoutes from "./pipelineStep.routes";
import stepRunRoutes from "./stepRun.routes";
import outreachRoutes from "./outreach.routes";
import integrationRoutes from "./integration.routes";
import svcRoutes from "./svc.routes";

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
router.use("/audit-logs", auditLogRoutes);
router.use("/admin", impersonationRoutes);

// CRM
router.use("/clients", clientRoutes);
router.use("/spocs", spocRoutes);
router.use("/notifications", notificationRoutes);
router.use("/pipeline-steps", pipelineStepRoutes);
router.use("/step-runs", stepRunRoutes);
router.use("/outreach", outreachRoutes);
router.use("/integrations", integrationRoutes);
router.use("/reports", reportRoutes);
router.use("/search", searchRoutes);

// external services — service key, not user JWT
router.use("/svc", svcRoutes);
// per-user + help
router.use("/views", viewRoutes);
router.use("/faqs", faqRoutes);

export default router;
