// routes/pipeline.routes.ts
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
} from "@/validators/requirement.validators";
import {
  getPipelines,
  getPipelineStats,
  getPipelineById,
  updatePipelineStage,
  submitCandidate,
  rollOffer,
  updateOfferStatus,
  rejectCandidate,
  withdrawCandidate,
  holdCandidate,
  getPipelineTimeline,
} from "@/controller/pipeline.controller";

const router = Router();
const scope = scopeFilter("requirements");

// ── list + stats
router.get("/", authenticateUser, scope, getPipelines);
router.get("/stats", authenticateUser, scope, getPipelineStats);

// ── single pipeline
router.get("/:pipelineId", authenticateUser, scope, getPipelineById);
router.get(
  "/:pipelineId/timeline",
  authenticateUser,
  scope,
  getPipelineTimeline
);

// ── stage transitions
router.patch(
  "/:pipelineId/stage",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updatePipelineStageSchema),
  updatePipelineStage
);
router.patch(
  "/:pipelineId/submit",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(submitCandidateSchema),
  submitCandidate
);
router.patch(
  "/:pipelineId/offer",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(rollOfferSchema),
  rollOffer
);
router.patch(
  "/:pipelineId/offer/status",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateOfferStatusSchema),
  updateOfferStatus
);
router.patch(
  "/:pipelineId/reject",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(rejectCandidateSchema),
  rejectCandidate
);
router.patch(
  "/:pipelineId/withdraw",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(withdrawCandidateSchema),
  withdrawCandidate
);
router.patch(
  "/:pipelineId/hold",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(holdCandidateSchema),
  holdCandidate
);

export default router;
