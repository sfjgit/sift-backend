// File: requirements.routes.patch.ts
// Path: src/routes/requirements.routes.ts
//
// ADDITIONS ONLY — splice these into the existing routes file.
// Two changes:
//
//  1. Add the export route (before the /:id routes so it doesn't get caught by param)
//  2. Document the new ?createdByScope param on the GET / route
//
// ─────────────────────────────────────────────────────────────────────────────

// ── ADD this import to the existing imports block:
// import { exportRequirements } from "@/controller/requirement.controller";
//
// ── ADD before the  router.get("/:id", ...) line:

// ── Requirements export — downloads .xlsx
// Query params (same as GET /requirements):
//   createdByScope: OWN | TEAM | REPORTING | ALL (default: OWN)
//   createdById: string (override — specific user, manager use case)
//   status, priority, clientId, serviceLineId, buId, search
//
// Returns: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
//   Sheet 1: Requirement summary + canonical stage counts (columns from DB)
//   Sheet 2: All candidates with stage history, aging, offer status
//
// router.get(
//   "/export",
//   authenticateUser,
//   scope,
//   exportRequirements
// );
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY /export MUST come before /:id
// Express matches routes in declaration order.
// If /:id is declared first, GET /export gets caught with id="export"
// and returns a 404 "requirement not found". Always put literal paths first.
// ─────────────────────────────────────────────────────────────────────────────

// The full updated route block for the collection section looks like this:

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createRequirementSchema,
  updateRequirementSchema,
  updateRequirementStatusSchema,
  createAssignmentSchema,
  pushCandidateSchema,
  updatePipelineStageSchema,
  submitCandidateSchema,
  rollOfferSchema,
  updateOfferStatusSchema,
  rejectCandidateSchema,
  withdrawCandidateSchema,
  holdCandidateSchema,
  addNoteSchema,
} from "@/validators/requirement.validators";
import {
  // getRequirements,
  getRequirementById,
  getRequirementTree,
  getRequirementDetail,
  createRequirement,
  updateRequirement,
  updateRequirementStatus,
  deleteRequirement,
  createAssignment,
  removeAssignment,
  getCandidates,
  getCandidateDetail,
  getActivities,
  getRequirementStats,
  getRequirementCandidates,
  getRequirementCandidateById,
  // exportRequirements,
  bulkUploadRequirementsController,
  // getRequirementsFilters,
  // getSaleValueStats,
  // getRequirementsPipelineSummary,
} from "@/controller/requirement.controller";
import {
  pushCandidate,
  updatePipelineStage,
  submitCandidate,
  rollOffer,
  updateOfferStatus,
  rejectCandidate,
  withdrawCandidate,
  holdCandidate,
  getPipelineTimeline,
  assignApplicantRecruiter,
} from "@/controller/pipeline.controller";
import {
  addNote,
  deleteNote,
  addDocument,
  getDocuments,
  resolveDocument,
} from "@/controller/requirementExtras.controller";
import { upload } from "@/services/s3.service";
import { bulkUploadMulter } from "@/middleware/bulkUploadMulter";
import {
  exportRequirements,
  getRequirements,
  getRequirementsFilters,
  getRequirementsPipelineSummary,
  getSaleValueStats,
} from "@/controller/requirementsController";

const router = Router();
const scope = scopeFilter("requirements");

// ── stats
router.get("/stats", authenticateUser, scope, getRequirementStats);

// ── EXPORT (must be before /:id — literal paths take priority)
// GET /requirements/export?createdByScope=OWN&status=ACTIVE
router.get("/export", authenticateUser, scope, exportRequirements);

router.get(
  "/pipeline-summary",
  authenticateUser,
  scope,
  getRequirementsPipelineSummary
);

// ── collection
// GET /requirements?createdByScope=OWN|TEAM|REPORTING|ALL
// createdByScope defaults to OWN — you only see what you created.
// Widen to TEAM or REPORTING to see your team's requirements.
router.get("/", authenticateUser, scope, getRequirements);

router.get("/filters", authenticateUser, scope, getRequirementsFilters);
router.get("/sale-value-stats", authenticateUser, scope, getSaleValueStats);

router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createRequirementSchema),
  createRequirement
);

//bulk-requirement upload
//requirements/bulk-upload
router.post(
  "/bulk-upload",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  bulkUploadMulter.single("file"),
  bulkUploadRequirementsController
);

// ── single — basic (used by edit forms etc.)
router.get("/:id", authenticateUser, scope, getRequirementById);

// ── FULL DETAIL
router.get("/:id/detail", authenticateUser, scope, getRequirementDetail);

router.put(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateRequirementSchema),
  updateRequirement
);
router.patch(
  "/:id/status",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateRequirementStatusSchema),
  updateRequirementStatus
);
router.delete(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canDelete"),
  deleteRequirement
);

// ── tree view
router.get("/:id/tree", authenticateUser, scope, getRequirementTree);

// ── assignments
router.post(
  "/:id/assignments",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(createAssignmentSchema),
  createAssignment
);
router.delete(
  "/:id/assignments/:assignmentId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  removeAssignment
);

// ── candidates
router.get(
  "/:id/candidates",
  authenticateUser,
  scopeFilter("candidates"),
  getRequirementCandidates
);
router.get(
  "/:id/candidates/:pipelineId",
  authenticateUser,
  scopeFilter("candidates"),
  getRequirementCandidateById
);
router.post(
  "/:id/candidates",
  authenticateUser,
  validate.body(pushCandidateSchema),
  pushCandidate
);

// ── stage transitions
router.patch(
  "/:id/candidates/:pipelineId/stage",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(updatePipelineStageSchema),
  updatePipelineStage
);
router.patch(
  "/:id/candidates/:pipelineId/submit",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(submitCandidateSchema),
  submitCandidate
);
// PATCH /requirements/:id/candidates/:pipelineId/assign   body: { recruiterId }
router.patch(
  "/:id/candidates/:pipelineId/assign",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  assignApplicantRecruiter
);
router.patch(
  "/:id/candidates/:pipelineId/offer",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(rollOfferSchema),
  rollOffer
);
router.patch(
  "/:id/candidates/:pipelineId/offer/status",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(updateOfferStatusSchema),
  updateOfferStatus
);
router.patch(
  "/:id/candidates/:pipelineId/reject",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(rejectCandidateSchema),
  rejectCandidate
);
router.patch(
  "/:id/candidates/:pipelineId/withdraw",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(withdrawCandidateSchema),
  withdrawCandidate
);
router.patch(
  "/:id/candidates/:pipelineId/hold",
  authenticateUser,
  scopeFilter("candidates"),
  checkPermission("canEdit"),
  validate.body(holdCandidateSchema),
  holdCandidate
);
router.get(
  "/:id/candidates/:pipelineId/timeline",
  authenticateUser,
  scopeFilter("candidates"),
  getPipelineTimeline
);

// ── notes
router.post(
  "/:id/notes",
  authenticateUser,
  scope,
  validate.body(addNoteSchema),
  addNote
);
router.delete("/:id/notes/:noteId", authenticateUser, scope, deleteNote);

// ── documents
router.get("/:id/documents", authenticateUser, scope, getDocuments);
router.post(
  "/:id/documents",
  authenticateUser,
  scope,
  upload.single("file"),
  addDocument
);
router.patch(
  "/:id/documents/:docId/resolve",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  resolveDocument
);

// ── activity log
router.get("/:id/activities", authenticateUser, scope, getActivities);

export default router;
