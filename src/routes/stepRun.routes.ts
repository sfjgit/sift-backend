// File: stepRun.routes.ts
// Path: src/routes/stepRun.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import { listStepRunsQuery } from "@/validators/stepRun.validators";
import { listStepRuns, getStepRunById } from "@/controller/stepRun.controller";

const router = Router();
const read = authorize("step_runs.read");

router.use(authenticateUser);

router.get("/", read, validate.query(listStepRunsQuery), listStepRuns);
// out of scope = 404, never 403
router.get("/:id", read, validate.params(idParams), getStepRunById);

export default router;
