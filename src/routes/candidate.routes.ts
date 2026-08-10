// File: candidate.routes.ts
// Path: src/routes/candidate.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  addCandidateSchema,
  moveStageSchema,
  submitCandidateSchema,
  recordOfferSchema,
  updateOfferStatusSchema,
  rejectCandidateSchema,
  withdrawCandidateSchema,
  holdCandidateSchema,
  setDispositionSchema,
} from "@/validators/candidate.validator";
import {
  getCandidates,
  addCandidate,
  getCandidateById,
  moveToStage,
  submitCandidate,
  recordOffer,
  updateOfferStatus,
  rejectCandidate,
  withdrawCandidate,
  holdCandidate,
  setDisposition,
  removeCandidate,
  getCandidateMeta,
  getCanonicalStages,
  getCandidatePipeline,
} from "@/controller/candidate.controller";

const router = Router();
const auth = authenticateUser;
const scope = scopeFilter("candidates");

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTION
// ─────────────────────────────────────────────────────────────────────────────

// GET  /candidates?requirementId=&assignmentId=&canonicalStage=&disposition=&search=
router.get("/", auth, scope, getCandidates);

router.get("/canonical-stages", auth, scope, getCanonicalStages);
// File: candidate.routes.ts (addition)
// Path: src/routes/candidate.routes.ts

// GET /candidates/meta — must be before /:candidateId to avoid param collision
router.get("/meta", auth, scope, getCandidateMeta);

// POST /candidates  — add candidate to pipeline (snapshot + pipeline row)
router.post(
  "/",
  auth,
  scope,
  checkPermission("canAdd"),
  validate.body(addCandidateSchema),
  addCandidate,
);

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE — named action routes before /:candidateId to avoid collision
// ─────────────────────────────────────────────────────────────────────────────

// GET  /candidates/:candidateId/pipeline-stages
router.get(
  "/by-candidate/:candidateServiceId/pipeline",
  auth,
  scope,
  getCandidatePipeline,
);

// GET  /candidates/:candidateId
router.get("/:candidateId", auth, scope, getCandidateById);

// PATCH /candidates/:candidateId/stage
router.patch(
  "/:candidateId/stage",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(moveStageSchema),
  moveToStage,
);

// PATCH /candidates/:candidateId/submit
router.patch(
  "/:candidateId/submit",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(submitCandidateSchema),
  submitCandidate,
);

// PATCH /candidates/:candidateId/offer
router.patch(
  "/:candidateId/offer",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(recordOfferSchema),
  recordOffer,
);

// PATCH /candidates/:candidateId/offer-status
router.patch(
  "/:candidateId/offer-status",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(updateOfferStatusSchema),
  updateOfferStatus,
);

// PATCH /candidates/:candidateId/reject
router.patch(
  "/:candidateId/reject",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(rejectCandidateSchema),
  rejectCandidate,
);

// PATCH /candidates/:candidateId/withdraw
router.patch(
  "/:candidateId/withdraw",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(withdrawCandidateSchema),
  withdrawCandidate,
);

// PATCH /candidates/:candidateId/hold
router.patch(
  "/:candidateId/hold",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(holdCandidateSchema),
  holdCandidate,
);

// PATCH /candidates/:candidateId/disposition
router.patch(
  "/:candidateId/disposition",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(setDispositionSchema),
  setDisposition,
);

// DELETE /candidates/:candidateId
router.delete(
  "/:candidateId",
  auth,
  scope,
  checkPermission("canDelete"),
  removeCandidate,
);

export default router;
