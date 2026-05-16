// File: module.validator.ts
// Path: src/validators/module.validator.ts

import { z } from "zod";

export const createModuleBody = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100)
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_]+$/,
      "Name must be lowercase letters, numbers, or underscores only"
    ),
  label: z.string().min(1, "Label is required").max(100).trim(),
  order: z.number().int().positive().optional(),
});

export const updateModuleBody = z.object({
  label: z.string().min(1).max(100).trim().optional(),
  order: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const moduleIdParams = z.object({
  id: z.string().uuid("Invalid module id"),
});

export type CreateModuleInput = z.infer<typeof createModuleBody>;
export type UpdateModuleInput = z.infer<typeof updateModuleBody>;
