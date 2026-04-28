import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
// import { validate } from "@/middleware/validate";
import {
  createBUBody,
  updateBUBody,
  buIdParams,
} from "@/validators/bu.validator";
import {
  listBusinessUnits,
  getBusinessUnitById,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
} from "@/controller/bu.controller";
import { validate } from "@/validators/validator";

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("business_units"));

router.get("/", listBusinessUnits);

router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createBUBody),
  createBusinessUnit
);

router.get("/:id", validate.params(buIdParams), getBusinessUnitById);

router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: buIdParams, body: updateBUBody }),
  updateBusinessUnit
);

router.delete(
  "/:id",
  checkPermission("canDelete"),
  validate.params(buIdParams),
  deleteBusinessUnit
);

export default router;
