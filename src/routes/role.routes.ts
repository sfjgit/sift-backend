import {
  createRole,
  deleteRole,
  getAllRoles,
  setRolePermissions,
} from "@/controller/role.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import {
  createRoleSchema,
  deleteRoleSchema,
  rolePermissionsBodySchema,
  rolePermissionsParamsSchema,
} from "@/validators/role.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();

/**
 * @route   POST /api/roles
 * @desc    Create new role
 * @access  Admin
 */
router.post(
  "/",
  authenticateUser,
  // authorize('ADMIN'),
  validate.body(createRoleSchema),
  createRole,
);

/**
 * @route   GET /api/roles
 * @desc    Get all roles
 * @access  Super Admin
 */
router.get(
  "/",
  authenticateUser,
  //  authorize("SUPER_ADMIN"),
  getAllRoles,
);

/**
 * @route   DELETE /api/roles/:id
 * @desc    Delete role
 * @access  Super Admin
 */
router.delete(
  "/:id",
  authenticateUser,
  //   authorize("SUPER_ADMIN"),
  validate.params(deleteRoleSchema),
  deleteRole,
);

router.put(
  "/:id/permissions",
  authenticateUser,
  //   authorize("SUPER_ADMIN"),
  validate.params(rolePermissionsParamsSchema),
  validate.body(rolePermissionsBodySchema),
  setRolePermissions,
);

export default router;
