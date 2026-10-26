// File: pipelineStep.routes.ts
// Path: src/routes/pipelineStep.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { listPipelineSteps } from "@/controller/stepRun.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", authorize("step_runs.read"), listPipelineSteps);

export default router;
