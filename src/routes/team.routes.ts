import {
  addTeamMembers,
  createTeam,
  getAllTeamMembers,
  getTeams,
  removeTeamMembers,
  updateTeams,
} from "@/controller/team.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import {
  addTeamMembersBodySchema,
  addTeamMembersParamsSchema,
  createTeamSchema,
  getTeamMembersParamsSchema,
  getTeamsSchema,
  removeTeamMembersParamsSchema,
  updateTeamsBodySchema,
  updateTeamsParamsSchema,
} from "@/validators/team.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();

/**
 * @route   POST /api/teams
 * @desc    Create new team
 * @access  Admin
 */
router.post(
  "/",
  authenticateUser,
  // authorize("ADMIN"),
  validate.body(createTeamSchema),
  createTeam,
);

/**
 * @route   GET /api/teams
 * @desc    Get all teams
 * @access  Admin
 */
router.get(
  "/",
  authenticateUser,
  // authorize("ADMIN"),
  validate.query(getTeamsSchema),
  getTeams,
);

/**
 * @route   PATCH /api/teams/:id
 * @desc    Update teams
 * @access  Admin
 */
router.patch(
  "/:id",
  authenticateUser,
  // authorize("ADMIN"),
  validate.params(updateTeamsParamsSchema),
  validate.body(updateTeamsBodySchema),
  updateTeams,
);

/**
 * @route   POST /api/teams/:id/members
 * @desc    Add team members
 * @access  Admin
 */
router.post(
  "/:id/members",
  authenticateUser,
  // authorize('ADMIN'),
  validate.params(addTeamMembersParamsSchema),
  validate.body(addTeamMembersBodySchema),
  addTeamMembers,
);

/**
 * @route   DELETE /api/teams/:id/members/:userId
 * @desc    Remove team members
 * @access  Admin
 */
router.delete(
  "/:id/members/:userId",
  authenticateUser,
  // authorize('ADMIN'),
  validate.params(removeTeamMembersParamsSchema),
  removeTeamMembers,
);

/**
 * @route   GET /api/teams/:id/members
 * @desc    Get all team members
 * @access  Admin
 */
router.get(
  "/:id/members",
  authenticateUser,
  // authorize('ADMIN'),
  validate.params(getTeamMembersParamsSchema),
  getAllTeamMembers,
);

export default router;
