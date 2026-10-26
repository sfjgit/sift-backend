// File: integration.routes.ts
// Path: src/routes/integration.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import { testKeyBody, updatePipelineStepBody, updateServiceBody } from "@/validators/integration.validators";
import {
  listIntegrations,
  getServiceHealth,
  testServiceKey,
  updateService,
  rotateInboundKey,
  updatePipelineStep,
} from "@/controller/integration.controller";

const router = Router();

router.use(authenticateUser, authorize("integrations.manage"));

router.get("/", listIntegrations);
router.patch("/steps/:id", validate.request({ params: idParams, body: updatePipelineStepBody }), updatePipelineStep);
router.get("/:id/health", validate.params(idParams), getServiceHealth);
router.post("/:id/test-key", validate.request({ params: idParams, body: testKeyBody }), testServiceKey);
router.post("/:id/rotate-key", validate.params(idParams), rotateInboundKey);
router.patch("/:id", validate.request({ params: idParams, body: updateServiceBody }), updateService);

export default router;
