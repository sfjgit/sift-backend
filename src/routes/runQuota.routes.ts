// File: runQuota.routes.ts
// Path: src/routes/runQuota.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import { createRunQuotaBody, updateRunQuotaBody } from "@/validators/runQuota.validators";
import { createRunQuota, deleteRunQuota, listRunQuotas, updateRunQuota } from "@/controller/runQuota.controller";

const router = Router();
const manage = authorize("run_slots.manage");

router.use(authenticateUser);

router.get("/", manage, listRunQuotas);
router.post("/", manage, validate.body(createRunQuotaBody), createRunQuota);
router.patch("/:id", manage, validate.params(idParams), validate.body(updateRunQuotaBody), updateRunQuota);
router.delete("/:id", manage, validate.params(idParams), deleteRunQuota);

export default router;
