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
  updateCandidateStageSchema,
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
  pushCandidate,
  updateCandidateStage,
  getCandidates,
  getRequirementStats,
} from "@/controller/requirement.controller";

const router = Router();
const scope = scopeFilter("requirements");

router.get("/stats", authenticateUser, scope, getRequirementStats);
// collection
router.get("/", authenticateUser, scope, getRequirements);
router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createRequirementSchema),
  createRequirement
);

// single
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

// tree view
router.get("/:id/tree", authenticateUser, scope, getRequirementTree);

// assignments
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

// candidates
router.get("/:id/candidates", authenticateUser, scope, getCandidates);
router.post(
  "/:id/candidates",
  authenticateUser,
  scope,
  validate.body(pushCandidateSchema),
  pushCandidate
);
router.patch(
  "/:id/candidates/:candidateId/stage",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateCandidateStageSchema),
  updateCandidateStage
);

// add to requirement.routes.ts

// import { upload } from "@/utils/s3";
import {
  addNote,
  deleteNote,
  addDocument,
  getDocuments,
  resolveDocument,
  getActivities,
} from "@/controller/requirementExtras.controller";
import { upload } from "@/services/s3.service";

// notes
router.post(
  "/:id/notes",
  authenticateUser,
  scope,
  validate.body(addNoteSchema),
  addNote
);
router.delete("/:id/notes/:noteId", authenticateUser, scope, deleteNote);

// documents — multer on the upload route only
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

// activities
router.get("/:id/activities", authenticateUser, scope, getActivities);

export default router;
