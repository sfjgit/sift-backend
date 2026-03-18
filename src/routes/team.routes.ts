import { createTeam } from "@/controller/team.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import { createTeamSchema, getTeamsSchema } from "@/validators/team.validators";
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
  authorize("ADMIN"),
  validate.body(createTeamSchema),
  createTeam,
);

/**
 * @route   GET /api/teams
 * @desc    Get all teams
 * @access  Admin
 */
// router.get(
//     '/',
//     authenticateUser,
//     authorize('ADMIN'),
//     validate.query(getTeamsSchema)
//     getTeams
// )

export default router;
