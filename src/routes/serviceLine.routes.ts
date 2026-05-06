// routes/serviceLine.routes.ts
import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createServiceLineSchema,
  updateServiceLineSchema,
} from "@/validators/serviceLine.validators";
import {
  getServiceLines,
  getServiceLineById,
  createServiceLine,
  updateServiceLine,
  toggleServiceLine,
} from "@/controller/serviceLine.controller";

const router = Router();
const scope = scopeFilter("serviceLines");

router.get("/", authenticateUser, scope, getServiceLines);
router.get("/:id", authenticateUser, scope, getServiceLineById);
router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createServiceLineSchema),
  createServiceLine
);
router.put(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateServiceLineSchema),
  updateServiceLine
);
router.patch(
  "/:id/toggle",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  toggleServiceLine
);

export default router;
