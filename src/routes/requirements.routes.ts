import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
// import { scopeFilter, checkPermission } from "@/middleware/scope";
import { validate } from "@/validators/validator";
import {
  getRequirementsSchema,
  getReqByIdSchema,
  createRequirementSchema,
  updateRequirementSchema,
  updateStatusSchema,
  createAssignmentSchema,
  updateAssignmentSchema,
  updateProgressSchema,
  addNoteSchema,
  calendarSchema,
} from "@/validators/requirement.validators";
import {
  getRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  updateRequirementStatus,
  createAssignment,
  removeAssignment,
  updateAssignment,
  updateProgress,
  addNote,
  deleteNote,
  getMyQueue,
  getRequirementsCalendar,
  getRequirementStats,
} from "@/controller/requirement.controller";
import {
  checkPermission,
  scopeFilter,
} from "@/middleware/scopeFilter.middleware";
import { getAssignableTargets } from "@/controller/workspace.controller";

const router = Router();
const scope = scopeFilter("requirements");

// ─────────────────────────────────────────────────────────────────────────────
// Aggregates — must be BEFORE /:id to avoid param clash
// ─────────────────────────────────────────────────────────────────────────────

// GET /requirements/stats        — dashboard counts scoped to caller
router.get("/stats", authenticateUser, scope, getRequirementStats);

// // GET /requirements/my-queue     — caller's personal work queue
router.get("/my-queue", authenticateUser, scope, getMyQueue);

// // GET /requirements/calendar     — respondBy calendar view
router.get(
  "/calendar",
  authenticateUser,
  scope,
  validate.query(calendarSchema),
  getRequirementsCalendar
);

// ─────────────────────────────────────────────────────────────────────────────
// Collection
// ─────────────────────────────────────────────────────────────────────────────

// GET  /requirements
router.get(
  "/",
  authenticateUser,
  scope,
  validate.query(getRequirementsSchema),
  getRequirements
);

// POST /requirements
router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createRequirementSchema),
  createRequirement
);
// GET /requirements/:id/assignable-targets
// Returns DM teams (for sales) or child teams+members (for DM)
// based on who is calling and what's already assigned
router.get(
  "/:id/assignable-targets",
  authenticateUser,
  scope,
  getAssignableTargets
);
// ─────────────────────────────────────────────────────────────────────────────
// Single requirement
// ─────────────────────────────────────────────────────────────────────────────

// GET  /requirements/:id
router.get(
  "/:id",
  authenticateUser,
  scope,
  validate.params(getReqByIdSchema),
  getRequirementById
);

// PUT  /requirements/:id
router.put(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.params(getReqByIdSchema),
  validate.body(updateRequirementSchema),
  updateRequirement
);

// PATCH /requirements/:id/status
router.patch(
  "/:id/status",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.params(getReqByIdSchema),
  validate.body(updateStatusSchema),
  updateRequirementStatus
);

// ─────────────────────────────────────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────────────────────────────────────

// POST   /requirements/:id/assign
router.post(
  "/:id/assign",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.params(getReqByIdSchema),
  validate.body(createAssignmentSchema),
  createAssignment
);

// PATCH  /requirements/:id/assignments/:assignmentId
router.patch(
  "/:id/assignments/:assignmentId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.params(getReqByIdSchema),
  validate.body(updateAssignmentSchema),
  updateAssignment
);

// DELETE /requirements/:id/assignments/:assignmentId
router.delete(
  "/:id/assignments/:assignmentId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.params(getReqByIdSchema),
  removeAssignment
);

// PATCH  /requirements/:id/assignments/:assignmentId/progress
// Only the assigned recruiter calls this — no canEdit check, controller guards by recruiterId
router.patch(
  "/:id/assignments/:assignmentId/progress",
  authenticateUser,
  scope,
  validate.params(getReqByIdSchema),
  validate.body(updateProgressSchema),
  updateProgress
);

// ─────────────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────────────

// POST   /requirements/:id/notes
router.post(
  "/:id/notes",
  authenticateUser,
  scope,
  validate.params(getReqByIdSchema),
  validate.body(addNoteSchema),
  addNote
);

// DELETE /requirements/:id/notes/:noteId
router.delete(
  "/:id/notes/:noteId",
  authenticateUser,
  scope,
  validate.params(getReqByIdSchema),
  deleteNote
);

export default router;
