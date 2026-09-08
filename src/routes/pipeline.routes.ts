// File: pipeline.routes.ts
// Path: src/routes/pipeline.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  updatePipelineStageSchema,
  submitCandidateSchema,
  rollOfferSchema,
  updateOfferStatusSchema,
  rejectCandidateSchema,
  withdrawCandidateSchema,
  holdCandidateSchema,
  updateDispositionSchema,
  updatePipelineDetailsSchema,
} from "@/validators/requirement.validators";
import {
  // Pipeline list + stats
  getPipelines,
  getPipelineStats,
  // Pipeline stage admin CRUD
  getPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  // Candidate ingest
  pushCandidate,
  // Single pipeline read
  getPipelineById,
  getPipelineTimeline,
  // Candidate stage actions
  moveCandidateStage,
  submitCandidate,
  rollOffer,
  updateOfferStatus,
  rejectCandidate,
  withdrawCandidate,
  holdCandidate,
  updateDisposition,
  updatePipelineDetails,
  transferPipelineCandidate,
} from "@/controller/pipeline.controller";

const router = Router();
const scope = scopeFilter("candidates");
const auth = authenticateUser;
const edit = checkPermission("canEdit");

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE STAGE ADMIN — /pipeline-stages
// Must be registered BEFORE /pipeline/:pipelineId routes to avoid
// "pipeline-stages" being matched as a pipelineId
// ─────────────────────────────────────────────────────────────────────────────

router.get("/pipeline-stages", auth, getPipelineStages);
router.post("/pipeline-stages", auth, createPipelineStage);
router.patch("/pipeline-stages/:stageId", auth, updatePipelineStage);
router.delete("/pipeline-stages/:stageId", auth, deletePipelineStage);

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE LIST + STATS — /pipeline
// Static paths before dynamic /:pipelineId
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", auth, scope, getPipelines);
router.get("/stats", auth, scope, getPipelineStats);

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE PIPELINE — /pipeline/:pipelineId
// GET routes before PATCH routes, specific paths before dynamic
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:pipelineId", auth, scope, getPipelineById);

router.patch(
  "/:pipelineId/disposition",
  auth,
  scope,
  edit,
  validate.body(updateDispositionSchema),
  updateDisposition,
);

// CTC ladder + joining fields that don't have a dedicated action endpoint.
// Backs the "Update Candidate Details" dialog on the assignment pipeline UI.
// Does NOT touch disposition, stage, or assignment counters — those stay on
// their own routes (/disposition, /stage, /offer, etc.)
router.patch(
  "/:pipelineId/details",
  auth,
  scope,
  edit,
  // validate.body(updatePipelineDetailsSchema),
  updatePipelineDetails,
);

router.get("/:pipelineId/timeline", auth, scope, getPipelineTimeline);

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE STAGE ACTIONS — /pipeline/:pipelineId/*
// offer/status must come BEFORE offer to avoid "status" matching as pipelineId
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  "/:pipelineId/stage",
  auth,
  scope,
  edit,
  validate.body(updatePipelineStageSchema),
  moveCandidateStage,
);
router.patch(
  "/:pipelineId/submit",
  auth,
  scope,
  edit,
  validate.body(submitCandidateSchema),
  submitCandidate,
);
router.patch(
  "/:pipelineId/offer/status",
  auth,
  scope,
  edit,
  validate.body(updateOfferStatusSchema),
  updateOfferStatus,
);
router.patch(
  "/:pipelineId/offer",
  auth,
  scope,
  edit,
  // validate.body(rollOfferSchema),
  rollOffer,
);
router.patch(
  "/:pipelineId/reject",
  auth,
  scope,
  edit,
  validate.body(rejectCandidateSchema),
  rejectCandidate,
);
router.patch(
  "/:pipelineId/withdraw",
  auth,
  scope,
  edit,
  validate.body(withdrawCandidateSchema),
  withdrawCandidate,
);
router.patch(
  "/:pipelineId/hold",
  auth,
  scope,
  edit,
  validate.body(holdCandidateSchema),
  holdCandidate,
);

router.patch(
  "/:pipelineId/transfer",
  auth,
  scope,
  edit,
  transferPipelineCandidate,
);

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE INGEST — POST /requirements/:id/candidates
// Registered on requirement routes, not here — kept for reference
// router.post("/requirements/:id/candidates", auth, scope, edit, pushCandidate);
// ─────────────────────────────────────────────────────────────────────────────

export { pushCandidate }; // re-export for requirement.routes.ts
export default router;
