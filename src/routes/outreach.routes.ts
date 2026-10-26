// File: outreach.routes.ts
// Path: src/routes/outreach.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import { listOutreachQuery } from "@/validators/stepRun.validators";
import { listOutreach } from "@/controller/outreach.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", authorize("outreach.read"), validate.query(listOutreachQuery), listOutreach);

export default router;
