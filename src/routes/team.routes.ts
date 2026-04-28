import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate } from "@/validators/validator";
import {
  getTeamsSchema,
  getTeamByIdSchema,
  createTeamSchema,
  updateTeamSchema,
  deleteTeamSchema,
  createTeamEdgeSchema,
  updateTeamEdgeSchema,
  deleteTeamEdgeSchema,
  addTeamMembersSchema,
  updateMemberRoleSchema,
  removeTeamMemberSchema,
  getTeamMembersSchema,
  getAvailableUsersSchema,
  getArcsSchema,
  getArcByIdSchema,
  createArcSchema,
  updateArcSchema,
  deleteArcSchema,
} from "@/validators/team.validators";
import {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  createTeamEdge,
  updateTeamEdge,
  deleteTeamEdge,
  addTeamMembers,
  updateMemberRole,
  removeTeamMember,
  getTeamMembers,
  getAvailableUsers,
  getArcs,
  getArcById,
  createArc,
  updateArc,
  deleteArc,
} from "@/controller/team.controller";

const router = Router();

// ═════════════════════════════════════════════════════════════════════════════
// TEAM ARC ROUTES
// Prefix: /arcs (mounted at /api/arcs or nested under /teams/arcs — your call)
// ═════════════════════════════════════════════════════════════════════════════

// GET    /arcs              — list all arcs (filter by buId, isActive, search)
// POST   /arcs              — create a new arc
// GET    /arcs/:id          — full arc detail + all its teams (tree + flat)
// PUT    /arcs/:id          — rename / toggle isActive
// DELETE /arcs/:id          — delete (blocked if has active teams)

router.get("/arcs", authenticateUser, validate.query(getArcsSchema), getArcs);

router.post(
  "/arcs",
  authenticateUser,
  validate.body(createArcSchema),
  createArc
);

router.get(
  "/arcs/:id",
  authenticateUser,
  validate.params(getArcByIdSchema),
  getArcById
);

router.put(
  "/arcs/:id",
  authenticateUser,
  validate.params(getArcByIdSchema),
  validate.body(updateArcSchema),
  updateArc
);

router.delete(
  "/arcs/:id",
  authenticateUser,
  validate.params(deleteArcSchema),
  deleteArc
);

// ═════════════════════════════════════════════════════════════════════════════
// TEAM ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── Collection ───────────────────────────────────────────────────────────────

// GET    /teams              — list (filter by buId, arcId, category, nodeType…)
// POST   /teams              — create team (teamArcId required)

router.get("/", authenticateUser, validate.query(getTeamsSchema), getTeams);

router.post("/", authenticateUser, validate.body(createTeamSchema), createTeam);

// ── Single team ───────────────────────────────────────────────────────────────

// GET    /teams/:id          — full detail
// PUT    /teams/:id          — update name, nodeType, category, arcId, parentId…
// DELETE /teams/:id          — delete (blocked if has members / assignments / children)

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

// POST   /teams/:id/edges            — create a manual edge (cross-arc links etc.)
// PATCH  /teams/:id/edges/:edgeId    — toggle isActive on one edge
// DELETE /teams/:id/edges/:edgeId    — hard-delete edge (logs unlink history)

router.post(
  "/:id/edges",
  authenticateUser,
  validate.params(getTeamByIdSchema),
  validate.body(createTeamEdgeSchema),
  createTeamEdge
);

router.patch(
  "/:id/edges/:edgeId",
  authenticateUser,
  validate.body(updateTeamEdgeSchema),
  updateTeamEdge
);

router.delete(
  "/:id/edges/:edgeId",
  authenticateUser,
  validate.params(deleteTeamEdgeSchema),
  deleteTeamEdge
);

// ── Member management ────────────────────────────────────────────────────────

// GET    /teams/:id/members                  — list active members
// POST   /teams/:id/members                  — add member(s) (batch, writes history)
// PATCH  /teams/:id/members/:userId/role     — change role
// DELETE /teams/:id/members/:userId          — soft-remove (writes LEFT history)

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

// ── Available users ──────────────────────────────────────────────────────────

// GET    /teams/:id/available-users  — BU users not already in this team

router.get(
  "/:id/available-users",
  authenticateUser,
  validate.params(getAvailableUsersSchema),
  getAvailableUsers
);

export default router;
