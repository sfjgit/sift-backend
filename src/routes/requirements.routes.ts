// routes/requirement.routes.ts
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
  createRequirement,
  updateRequirement,
  updateRequirementStatus,
  deleteRequirement,
  createAssignment,
  removeAssignment,
  getCandidates,
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
  getActivities,
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

// ── single
router.get("/:id", authenticateUser, scope, getRequirementById);
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

// ── pipeline candidates
// list — all candidates in pipeline for this requirement
router.get("/:id/candidates", authenticateUser, scope, getCandidates);

// push — called internally by Candidate Service after ingest (service-to-service, auth via shared secret)
// creates CandidateSnapshot + RequirementCandidatePipeline row
router.post(
  "/:id/candidates",
  authenticateUser,
  validate.body(pushCandidateSchema),
  pushCandidate
);

// stage transition — recruiter moves candidate forward in pipeline
router.patch(
  "/:id/candidates/:pipelineId/stage",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updatePipelineStageSchema),
  updatePipelineStage
);

// submit to client
router.patch(
  "/:id/candidates/:pipelineId/submit",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(submitCandidateSchema),
  submitCandidate
);

// roll offer
router.patch(
  "/:id/candidates/:pipelineId/offer",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(rollOfferSchema),
  rollOffer
);

// offer response — accepted / declined / revoked
router.patch(
  "/:id/candidates/:pipelineId/offer/status",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateOfferStatusSchema),
  updateOfferStatus
);

// terminal states — reject / withdraw / hold
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

// timeline — full stage log for one candidate in this requirement
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

// ── activities
router.get("/:id/activities", authenticateUser, scope, getActivities);

export default router;
