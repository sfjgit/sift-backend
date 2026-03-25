import {
  createOrgFlows,
  deleteOrgFlow,
  orgFlows,
  updateOrgFlows,
} from "@/controller/orgFlow.controller";
import { authenticateUser } from "@/middleware/auth";
import {
  createOrgFlowSchema,
  idParamSchema,
  orgFlowSchema,
  updateOrgFlowSchema,
} from "@/validators/orgFlow.validator";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();

/**
 * @route   GET /api/org-flow
 * @desc    Get all flow nodes and edges
 * @access  Super Admin,Admin
 */
router.get("/", authenticateUser, validate.query(orgFlowSchema), orgFlows);

/**
 * @route   POST /api/org-flow
 * @desc    Create a flow edge
 * @access  Super Admin,Admin
 */
router.post(
  "/",
  authenticateUser,
  validate.body(createOrgFlowSchema),
  createOrgFlows,
);

/**
 * @route   PATCH /api/org-flow
 * @desc    Update a flow edge
 * @access  Super Admin,Admin
 */
router.patch(
  "/:id",
  authenticateUser,
  validate.params(idParamSchema),
  validate.body(updateOrgFlowSchema),
  updateOrgFlows,
);

/**
 * @route   DELETE /api/org-flow
 * @desc    Remove a flow edge.
 * @access  Super Admin,Admin
 */
router.delete(
  "/:id",
  authenticateUser,
  validate.params(idParamSchema),
  // validate.query(deleteOrgFlowSchema),
  deleteOrgFlow,
);

export default router;
