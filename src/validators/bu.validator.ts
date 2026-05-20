// File: bu.validator.ts
// Path: src/validators/bu.validator.ts

import { z } from "zod";

export const createBUBody = z.object({
  name: z.string().min(1, "Name is required").max(100).trim(),
  code: z.string().max(20).trim().optional().nullable(),
  parentBUId: z
    .string()
    .uuid("parentBUId must be a valid UUID")
    .optional()
    .nullable(),
});

export const updateBUBody = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  code: z.string().max(20).trim().optional().nullable(),
  isActive: z.boolean().optional(),
  parentBUId: z
    .string()
    .uuid("parentBUId must be a valid UUID")
    .optional()
    .nullable(),
});

export const buIdParams = z.object({
  id: z.string().uuid("BU ID must be a valid UUID"),
});

export type CreateBUInput = z.infer<typeof createBUBody>;
export type UpdateBUInput = z.infer<typeof updateBUBody>;
