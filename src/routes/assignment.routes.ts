// File: assignment.routes.ts
// Path: src/routes/assignment.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createAssignmentSchema,
  subAssignSchema,
  updateAssignmentSchema,
} from "@/validators/assignment.validator";
import {
  getAssignments,
  getAssignmentById,
  getAssignmentsByRequirement,
  getMyAssignments,
  getAssignableTargets,
  createAssignment,
  subAssign,
  updateAssignment,
  removeAssignment,
  getAssignmentPipeline,
} from "@/controller/assignment.controller";

const router = Router();
const scope = scopeFilter("assignments");
const auth = authenticateUser;

// ── Named routes FIRST — must come before /:id to avoid route collision ───────

// Shortcut — my assignments (always OWN, no scope middleware needed)
router.get("/my", auth, getMyAssignments);

// Assignable targets for the assign dialog — no canAdd check, just auth
router.get("/assignable-targets", auth, scope, getAssignableTargets);

// All assignments for one requirement (full tree)
router.get(
  "/requirement/:requirementId",
  auth,
  scope,
  getAssignmentsByRequirement,
);

// ── Collection ────────────────────────────────────────────────────────────────

router.get("/", auth, scope, getAssignments);

router.post(
  "/",
  auth,
  scope,
  checkPermission("canAdd"),
  validate.body(createAssignmentSchema),
  createAssignment,
);

// ── Single — :id routes last ──────────────────────────────────────────────────

router.get("/:id", auth, scope, getAssignmentById);

router.patch(
  "/:id",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(updateAssignmentSchema),
  updateAssignment,
);

router.delete(
  "/:id",
  auth,
  scope,
  checkPermission("canDelete"),
  removeAssignment,
);

// Sub-assign (DM → TL/Recruiter)
router.post(
  "/:id/sub-assign",
  auth,
  scope,
  checkPermission("canAdd"),
  validate.body(subAssignSchema),
  subAssign,
);

// Paginated candidate rows under a specific assignment
router.get("/:id/pipeline", auth, scope, getAssignmentPipeline);

export default router;
