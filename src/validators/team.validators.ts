import { z } from "zod";

const uuid = z.string().min(1).max(100);

const teamRoleEnum = z.enum(["LEAD", "CO_LEAD", "MEMBER"]);
const nodeTypeEnum = z.enum(["MANAGEMENT", "GROUP", "INDIVIDUAL"]);
const categoryEnum = z.enum(["DELIVERY", "SALES", "SUPPORT", "MANAGEMENT"]);
const edgeTypeEnum = z.enum(["ASSIGNS_TO", "REPORTS_TO", "VISIBILITY"]);

// ── GET /teams ───────────────────────────────────────────────────────────────

export const getTeamsSchema = z.object({
  buId: uuid.optional(),
  category: categoryEnum.optional(),
  nodeType: nodeTypeEnum.optional(),
  isActive: z.enum(["true", "false"]).optional(),
  search: z.string().min(1).max(100).optional(),
});

// ── GET /teams/:id ───────────────────────────────────────────────────────────

export const getTeamByIdSchema = z.object({
  id: uuid,
});

// ── POST /teams ──────────────────────────────────────────────────────────────

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional().nullable(),
  nodeType: nodeTypeEnum.optional().default("GROUP"),
  category: categoryEnum.optional().nullable(),
  businessUnitId: uuid.optional().nullable(),
  parentTeamId: uuid.optional().nullable(),
});

// ── PUT /teams/:id ───────────────────────────────────────────────────────────

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).optional().nullable(),
  nodeType: nodeTypeEnum.optional(),
  category: categoryEnum.optional().nullable(),
  isActive: z.boolean().optional(),
  parentTeamId: uuid.optional().nullable(),
});

// ── DELETE /teams/:id ────────────────────────────────────────────────────────

export const deleteTeamSchema = z.object({
  id: uuid,
});

// ── PATCH /teams/:id/edges/:edgeId ───────────────────────────────────────────

export const updateTeamEdgeSchema = z.object({
  isActive: z.boolean(),
});

// ── POST /teams/:id/members ──────────────────────────────────────────────────

export const addTeamMembersSchema = z.object({
  members: z
    .array(
      z.object({
        userId: uuid,
        teamRole: teamRoleEnum.optional().default("MEMBER"),
      })
    )
    .min(1, "At least one member required")
    .max(50, "Cannot add more than 50 members at once"),
});

// ── PATCH /teams/:id/members/:userId/role ────────────────────────────────────

export const updateMemberRoleSchema = z.object({
  id: uuid.optional(), // params
  userId: uuid.optional(), // params
  teamRole: teamRoleEnum, // body
});

// ── DELETE /teams/:id/members/:userId ────────────────────────────────────────

export const removeTeamMemberSchema = z.object({
  id: uuid,
  userId: uuid,
  reason: z.string().max(500).optional(),
});

// ── GET /teams/:id/members ───────────────────────────────────────────────────

export const getTeamMembersSchema = z.object({
  id: uuid,
});

// ── GET /teams/:id/available-users ───────────────────────────────────────────

export const getAvailableUsersSchema = z.object({
  id: uuid,
});
