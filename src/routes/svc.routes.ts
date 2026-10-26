// File: svc.routes.ts
// Path: src/routes/svc.routes.ts
//
// External services only (X-Service-Key). See docs/PIPELINE_INTEGRATION.md.

import { Router } from "express";
import { authenticateService, requireServiceScope } from "@/middleware/serviceAuth";
import { validate, idParams } from "@/validators/validator";
import { svcEventBody, svcResultsBody } from "@/validators/svc.validators";
import { getRunInput, postRunEvent, postRunResults } from "@/controller/svc.controller";

const router = Router();
const write = requireServiceScope("step-runs:write");

router.use(authenticateService);

router.get("/health", (req, res) => {
  res.json({ success: true, data: { service: req.service!.code, time: new Date().toISOString() } });
});
router.get("/step-runs/:id", requireServiceScope("clients:read"), validate.params(idParams), getRunInput);
router.post(
  "/step-runs/:id/events",
  write,
  validate.request({ params: idParams, body: svcEventBody }),
  postRunEvent,
);
router.post(
  "/step-runs/:id/results",
  write,
  validate.request({ params: idParams, body: svcResultsBody }),
  postRunResults,
);

export default router;
