import {
  deactivateUser,
  getAllUsers,
  getSingleUser,
  reportingManager,
  subordinates,
  updateUsers,
} from "@/controller/user.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import {
  deactivateUserParamsSchema,
  getAllUsersSchema,
  getSingleUsersSchema,
  reportingManagerSchema,
  userIdParamsSchema,
  userUpdateBodySchema,
} from "@/validators/user.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();

/**
 * @route   POST /api/user
 * @desc    get all user
 * @access  Super Admin,admin
 */
router.get(
  "/",
  authenticateUser,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate.query(getAllUsersSchema),
  getAllUsers,
);

/**
 * @route   Get /api/user/:id
 * @desc    get single user
 * @access  Super Admin,admin
 */
router.get(
  "/:id",
  authenticateUser,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate.params(getSingleUsersSchema),
  getSingleUser,
);

/**
 * @route   Patch /api/user/:id
 * @desc    update single user
 * @access  Super Admin,admin
 */
router.patch(
  "/:id",
  authenticateUser,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate.params(userIdParamsSchema),
  validate.body(userUpdateBodySchema),
  updateUsers,
);

/**
 * @route   PATCH /api/users/:id/deactivate
 * @desc    Deactivating the existing user
 * @access  Super Admin,admin
 */

router.patch(
  "/:id/deactivate",
  authenticateUser,
  authorize("SUPER_ADMIN", "ADMIN"),
  validate.params(deactivateUserParamsSchema),
  deactivateUser,
);

/**
 * @route   PATCH /api/users/:id/reporting-to
 * @desc    Adding the reporting manager
 * @access  Super Admin,admin
 */
router.patch(
  "/:id/reporting-to",
  authenticateUser,
  authorize("SUPER_ADMIN", "ADMIN"),
  validate.params(userIdParamsSchema),
  validate.body(reportingManagerSchema),
  reportingManager,
);

// /**
//  * @route   GET /api/users/:id/subordinates
//  * @desc    Fetching subordinates
//  * @access  Super Admin,admin,users
//  */
router.get(
  "/:id/subordinates",
  authenticateUser,
  authorize("SUPER_ADMIN", "ADMIN", "USER"),
  validate.params(userIdParamsSchema),
  subordinates,
);
export default router;
