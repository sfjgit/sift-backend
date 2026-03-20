import { upload } from "@/config/multer.config";
import {
  addNotes,
  approveRequirement,
  assignRequirement,
  changeRequirementStatus,
  createRequirements,
  fillAssignment,
  getAllRequirements,
  getRequirement,
  getRequirementStatusHistory,
  resolveIssue,
  uploadDocument,
} from "@/controller/requirement.controller";
import { authenticateUser } from "@/middleware/auth";
import {
  addNotesBodySchema,
  addNotesParamsSchema,
  approveRequirementBodySchema,
  approveRequirementParamsSchema,
  assignRequirementBodySchema,
  assignRequirementParamsSchema,
  changeRequirementStatusBodySchema,
  changeRequirementStatusParamsSchema,
  createRequirementsSchema,
  fillAssignmentBodySchema,
  fillAssignmentParamsSchema,
  getAllRequirementsSchema,
  getRequirementParamsSchema,
  getRequirementStatusHistoryParamsSchema,
  resolveIssuesParamsSchema,
  uploadDocumentsParamsSchema,
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

/**
 * @route   POST /api/requirements/:id/notes
 * @desc    Add notes
 * @access
 */
router.post(
  "/:id/notes",
  authenticateUser,
  // authorize('ADMIN'),
  validate.params(addNotesParamsSchema),
  validate.body(addNotesBodySchema),
  addNotes,
);

/**
 * @route   GET /api/requirements/:id/history
 * @desc    Get requirement status history
 * @access
 */
router.get(
  "/:id/history",
  authenticateUser,
  validate.params(getRequirementStatusHistoryParamsSchema),
  getRequirementStatusHistory,
);

/**
 * @route   PATCH /api/requirements/:id/assignments/:assignmentId/fill
 * @desc    Fill assignment
 * @access
 */
router.patch(
  "/:id/assignments/:assignmentId/fill",
  authenticateUser,
  validate.params(fillAssignmentParamsSchema),
  validate.body(fillAssignmentBodySchema),
  fillAssignment,
);

/**
 * @route   POST /api/requirements/:id/documents
 * @desc    Upload document
 * @access
 */
router.post(
  "/:id/documents",
  authenticateUser,
  validate.params(uploadDocumentsParamsSchema),
  upload.single("file"),
  uploadDocument,
);

/**
 * @route   PATCH /api/requirements/:id/documents/:documentId/resolve
 * @desc    Resolve issue
 * @access
 */
router.patch(
  "/:id/documents/:documentId/resolve",
  authenticateUser,
  validate.params(resolveIssuesParamsSchema),
  resolveIssue,
);
export default router;
