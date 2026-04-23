import {
  addTeamMembers,
  createTeam,
  deleteTeams,
  getAllTeamMembers,
  getSingleTeam,
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
  getSingleTeamSchema,
  getTeamMembersParamsSchema,
  getTeamsSchema,
  removeTeamMembersParamsSchema,
  updateTeamsBodySchema,
  updateTeamsParamsSchema,
} from "@/validators/team.validators";
import { validate, validateParams } from "@/validators/validator";
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
  authorize("teams", "canAdd"),
  validate.body(createTeamSchema),
  createTeam
);

/**
 * @route   GET /api/teams
 * @desc    Get all teams
 * @access  Admin
 */
router.get(
  "/",
  authenticateUser,
  authorize("teams", "canView"),
  validate.query(getTeamsSchema),
  getTeams
);

/**
 * @route   GET /api/teams/:id
 * @desc    Get single team
 * @access  Admin
 */
router.get(
  "/:id",
  authenticateUser,
  authorize("teams", "canView"),
  validate.params(getSingleTeamSchema),
  getSingleTeam
);

/**
 * @route   PATCH /api/teams/:id
 * @desc    Update teams
 * @access  Admin
 */
router.patch(
  "/:id",
  authenticateUser,
  authorize("teams", "canEdit"),
  validate.params(updateTeamsParamsSchema),
  validate.body(updateTeamsBodySchema),
  updateTeams
);

/**
 * @route   POST /api/teams/:id/members
 * @desc    Add team members
 * @access  Admin
 */
router.post(
  "/:id/members",
  authenticateUser,
  authorize("teams", "canAdd"),
  validate.params(addTeamMembersParamsSchema),
  validate.body(addTeamMembersBodySchema),
  addTeamMembers
);

/**
 * @route   DELETE /api/teams/:id/members/:userId
 * @desc    Remove team members
 * @access  Admin
 */
router.delete(
  "/:id/members/:userId",
  authenticateUser,
  authorize("teams", "canDelete"),
  validate.params(removeTeamMembersParamsSchema),
  removeTeamMembers
);

/**
 * @route   GET /api/teams/:id/members
 * @desc    Get all team members
 * @access  Admin
 */
router.get(
  "/:id/members",
  authenticateUser,
  authorize("teams", "canView"),
  validate.params(getTeamMembersParamsSchema),
  getAllTeamMembers
);

/**
 * @route   DELETE /api/teams
 * @desc    delete team
 * @access  Admin
 */
router.delete(
  "/:id",
  authenticateUser,
  validateParams(updateTeamsParamsSchema),
  deleteTeams
);
export default router;
