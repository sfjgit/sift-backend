// routes/department.routes.ts
import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from "@/validators/department.validators";
import {
  getDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  toggleDepartment,
} from "@/controller/department.controller";

const router = Router();
const scope = scopeFilter("departments");

router.get("/", authenticateUser, scope, getDepartments);
router.get("/:id", authenticateUser, scope, getDepartmentById);
router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createDepartmentSchema),
  createDepartment
);
router.put(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateDepartmentSchema),
  updateDepartment
);
router.patch(
  "/:id/toggle",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  toggleDepartment
);

export default router;
