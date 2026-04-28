import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate } from "@/validators/validator";
import {
  getTeamsSchema,
  getTeamByIdSchema,
  createTeamSchema,
  updateTeamSchema,
  deleteTeamSchema,
  updateTeamEdgeSchema,
  addTeamMembersSchema,
  updateMemberRoleSchema,
  removeTeamMemberSchema,
  getTeamMembersSchema,
  getAvailableUsersSchema,
} from "@/validators/team.validators";
import {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  updateTeamEdge,
  addTeamMembers,
  updateMemberRole,
  removeTeamMember,
  getTeamMembers,
  getAvailableUsers,
} from "@/controller/team.controller";

const router = Router();

// ── Collection ──────────────────────────────────────────────────────────────

router.get("/", authenticateUser, validate.query(getTeamsSchema), getTeams);

router.post("/", authenticateUser, validate.body(createTeamSchema), createTeam);

// ── Single team ──────────────────────────────────────────────────────────────

router.get(
  "/:id",
  authenticateUser,
  validate.params(getTeamByIdSchema),
  getTeamById
);

router.put(
  "/:id",
  authenticateUser,
  validate.params(getTeamByIdSchema),
  validate.body(updateTeamSchema),
  updateTeam
);

router.delete(
  "/:id",
  authenticateUser,
  validate.params(deleteTeamSchema),
  deleteTeam
);

// ── Edge management ──────────────────────────────────────────────────────────

router.patch(
  "/:id/edges/:edgeId",
  authenticateUser,
  validate.body(updateTeamEdgeSchema),
  updateTeamEdge
);

// ── Member management ────────────────────────────────────────────────────────

router.get(
  "/:id/members",
  authenticateUser,
  validate.params(getTeamMembersSchema),
  getTeamMembers
);

router.post(
  "/:id/members",
  authenticateUser,
  validate.params(getTeamMembersSchema),
  validate.body(addTeamMembersSchema),
  addTeamMembers
);

router.patch(
  "/:id/members/:userId/role",
  authenticateUser,
  validate.params(updateMemberRoleSchema),
  validate.body(updateMemberRoleSchema),
  updateMemberRole
);

router.delete(
  "/:id/members/:userId",
  authenticateUser,
  validate.params(removeTeamMemberSchema),
  removeTeamMember
);

// ── Available users for adding to team ───────────────────────────────────────

router.get(
  "/:id/available-users",
  authenticateUser,
  validate.params(getAvailableUsersSchema),
  getAvailableUsers
);

export default router;
