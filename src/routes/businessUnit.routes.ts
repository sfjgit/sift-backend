// File: businessUnit.routes.ts
// Path: src/routes/businessUnit.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import { createBUBody, updateBUBody } from "@/validators/bu.validator";
import {
  listBusinessUnits,
  getBusinessUnitById,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
} from "@/controller/bu.controller";

const router = Router();
const manage = authorize("admin.manage_lookups");

router.use(authenticateUser);

router.get("/", listBusinessUnits);
router.get("/:id", validate.params(idParams), getBusinessUnitById);
router.post("/", manage, validate.body(createBUBody), createBusinessUnit);
router.put(
  "/:id",
  manage,
  validate.request({ params: idParams, body: updateBUBody }),
  updateBusinessUnit,
);
router.delete("/:id", manage, validate.params(idParams), deleteBusinessUnit);

export default router;
