import { z } from "zod";
import { TeamRole } from "@prisma/client";

export const createTeamSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" }),
  description: z
    .string()
    .min(2, { message: "Description must be at least 2 characters long" }),
  isActive: z.boolean().default(true),
  category: z.string().optional(),
  parentTeamId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
});

export const getTeamsSchema = z.object({
  name: z.string().optional(),
  isActive: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  category: z.string().optional(),
  parentTeamId: z.string().optional(),
  businessUnitId: z.string().optional(),
  search: z.string().optional(),
});

export const updateTeamsParamsSchema = z.object({
  id: z.string(),
});

export const updateTeamsBodySchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" })
    .optional(),
  description: z
    .string()
    .min(2, { message: "Description must be at least 2 characters long" })
    .optional(),
  isActive: z.boolean().default(true).optional(),
  category: z.string().optional(),
  parentTeamId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
});

export const addTeamMembersParamsSchema = z.object({
  id: z.string().uuid(),
});

export const addTeamMembersBodySchema = z.array(
  z.object({
    userId: z.string(),
    teamRole: z.enum(TeamRole).optional(),
    isActive: z.boolean().optional(),
  }),
);

export const removeTeamMembersParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export const getTeamMembersParamsSchema = z.object({
  id: z.string().uuid(),
});
