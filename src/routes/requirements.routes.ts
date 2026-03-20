import {
  approveRequirement,
  assignRequirement,
  changeRequirementStatus,
  createRequirements,
  getAllRequirements,
  getRequirement,
} from "@/controller/requirement.controller";
import { authenticateUser } from "@/middleware/auth";
import {
  approveRequirementBodySchema,
  approveRequirementParamsSchema,
  assignRequirementBodySchema,
  assignRequirementParamsSchema,
  changeRequirementStatusBodySchema,
  changeRequirementStatusParamsSchema,
  createRequirementsSchema,
  getAllRequirementsSchema,
  getRequirementParamsSchema,
} from "@/validators/requirement.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();

/**
 * @route   POST /api/requirements
 * @desc    Create new requirements
 * @access
 */
router.post(
  "/",
  authenticateUser,
  validate.body(createRequirementsSchema),
  createRequirements,
);

/**
 * @route   GET /api/requirements
 * @desc    Get all requirements
 * @access
 */
router.get(
  "/",
  authenticateUser,
  validate.query(getAllRequirementsSchema),
  getAllRequirements,
);

/**
 * @route   GET /api/requirements/:id
 * @desc    Get single requirement
 * @access
 */
router.get(
  "/:id",
  authenticateUser,
  validate.params(getRequirementParamsSchema),
  getRequirement,
);

/**
 * @route   PATCH /api/requirements/:id/approve
 * @desc    Approve requirement
 * @access
 */
router.patch(
  "/:id/approve",
  authenticateUser,
  validate.params(approveRequirementParamsSchema),
  validate.body(approveRequirementBodySchema),
  approveRequirement,
);

/**
 * @route   PATCH /api/requirements/:id/status
 * @desc    Change requirement status
 * @access
 */
router.patch(
  "/:id/status",
  authenticateUser,
  validate.params(changeRequirementStatusParamsSchema),
  validate.body(changeRequirementStatusBodySchema),
  changeRequirementStatus,
);

/**
 * @route   POST /api/requirements/:id/assign
 * @desc    Assign requirement
 * @access
 */
router.post(
  "/:id/assign",
  authenticateUser,
  validate.params(assignRequirementParamsSchema),
  validate.body(assignRequirementBodySchema),
  assignRequirement,
);

export default router;
