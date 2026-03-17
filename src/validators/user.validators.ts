import { z } from "zod";

export const getAllUsersSchema = z
  .object({
    roleId: z.string().min(1).optional(),
    buId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    isActive: z.boolean().default(true),
  })
  .optional();

export const getSingleUsersSchema = z.object({
  id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(1),
});

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export const userUpdateBodySchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  workingLocation: z.string().optional(),
  timezone: z.string().optional(),
});
export const deactivateUserParamsSchema = z.object({
  id: z.string().uuid(),
});
export const reportingManagerSchema = z.object({
  reportingToId: z.string().uuid(),
});
