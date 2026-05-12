// File: requirement.routes.ts
// Path: src/routes/requirement.routes.ts

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
  getRequirements,
  getRequirementById,
  getRequirementTree,
  getRequirementDetail, // ← NEW full detail with pipeline summary
  createRequirement,
  updateRequirement,
  updateRequirementStatus,
  deleteRequirement,
  createAssignment,
  removeAssignment,
  getCandidates, // ← UPDATED (paginated + aging)
  getCandidateDetail, // ← NEW single candidate detail
  getActivities, // ← NEW activities
  getRequirementStats,
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
} from "@/controller/pipeline.controller";
import {
  addNote,
  deleteNote,
  addDocument,
  getDocuments,
  resolveDocument,
} from "@/controller/requirementExtras.controller";
import { upload } from "@/services/s3.service";

const router = Router();
const scope = scopeFilter("requirements");

// ── stats
router.get("/stats", authenticateUser, scope, getRequirementStats);

// ── collection
router.get("/", authenticateUser, scope, getRequirements);
router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createRequirementSchema),
  createRequirement
);

// ── single — basic (used by edit forms etc.)
router.get("/:id", authenticateUser, scope, getRequirementById);

// ── FULL DETAIL — header + pipeline stage counts + assignments + notes + docs
// This is the main endpoint for the requirement detail page
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

// ── CANDIDATES — paginated list with aging, filters, search
// Query: stageCode, stageId, assignmentId, recruiterId, isRejected, isWithdrawn,
//        isOnHold, activeOnly, search, page, limit, sortBy, sortDir
router.get("/:id/candidates", authenticateUser, scope, getCandidates);

// ── push candidate — called by Candidate Service after ingest (internal / service-to-service)
router.post(
  "/:id/candidates",
  authenticateUser,
  validate.body(pushCandidateSchema),
  pushCandidate
);

// ── single candidate full detail in this requirement
router.get(
  "/:id/candidates/:pipelineId",
  authenticateUser,
  scope,
  getCandidateDetail
);

// ── stage transition
router.patch(
  "/:id/candidates/:pipelineId/stage",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updatePipelineStageSchema),
  updatePipelineStage
);

// ── submit to client
router.patch(
  "/:id/candidates/:pipelineId/submit",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(submitCandidateSchema),
  submitCandidate
);

// ── offer
router.patch(
  "/:id/candidates/:pipelineId/offer",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(rollOfferSchema),
  rollOffer
);
router.patch(
  "/:id/candidates/:pipelineId/offer/status",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateOfferStatusSchema),
  updateOfferStatus
);

// ── terminal states
router.patch(
  "/:id/candidates/:pipelineId/reject",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(rejectCandidateSchema),
  rejectCandidate
);
router.patch(
  "/:id/candidates/:pipelineId/withdraw",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(withdrawCandidateSchema),
  withdrawCandidate
);
router.patch(
  "/:id/candidates/:pipelineId/hold",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(holdCandidateSchema),
  holdCandidate
);

// ── stage timeline for one candidate
router.get(
  "/:id/candidates/:pipelineId/timeline",
  authenticateUser,
  scope,
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
