// File: platform.routes.ts
// Path: src/routes/platform.routes.ts
//
// Enterprise console (crm-enterprise-console) — its own sign-in, platform
// admins only, across all tenants. CRM sessions can't reach these.

import { Router } from "express";
import { z } from "zod";
import { authenticatePlatform } from "@/middleware/platformAuth";
import { validate, idParams } from "@/validators/validator";
import { loginSchema } from "@/validators/auth.validators";
import { createTenantBody, updateTenantBody } from "@/validators/platform.validators";
import {
  createTenant,
  getPlatformOverview,
  getTenant,
  listPlatformAlerts,
  listPlatformAudit,
  listPlatformServices,
  listTenantUsers,
  platformLogin,
  platformLogout,
  platformMe,
  resendInvite,
  resolvePlatformAlert,
  updateTenant,
} from "@/controller/platform.controller";

const router = Router();

const userParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

router.post("/auth/login", validate.body(loginSchema), platformLogin);
router.post("/auth/logout", platformLogout);

router.use(authenticatePlatform);

router.get("/auth/me", platformMe);
router.get("/overview", getPlatformOverview);
router.post("/tenants", validate.body(createTenantBody), createTenant);
router.get("/tenants/:id", validate.params(idParams), getTenant);
router.patch("/tenants/:id", validate.request({ params: idParams, body: updateTenantBody }), updateTenant);
router.get("/tenants/:id/users", validate.params(idParams), listTenantUsers);
router.post("/tenants/:id/users/:userId/invite", validate.params(userParams), resendInvite);
router.get("/alerts", listPlatformAlerts);
router.patch("/alerts/:id/resolve", validate.params(idParams), resolvePlatformAlert);
router.get("/services", listPlatformServices);
router.get("/audit", listPlatformAudit);

export default router;
