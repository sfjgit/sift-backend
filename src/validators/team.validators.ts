import { z } from "zod";

export const createTeamSchema = z.object({
    name: z.string().min(2, {message: "Name must be at least 2 characters long"}),
    description: z.string().min(2, {message: "Description must be at least 2 characters long"}),
    isActive: z.boolean().default(true),
    category: z.string().optional(),
    parentTeamId: z.string().uuid().optional(),
    businessUnitId: z.string().uuid().optional(),
})

export const getTeamsSchema = z.object({
  name: z.string().optional(),
  isActive: z.string().transform((val) => val === "true").optional(),
  category: z.string().optional(),
  parentTeamId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.string().transform((val) => parseInt(val)).optional(),
  limit: z.string().transform((val) => parseInt(val)).optional(),
});