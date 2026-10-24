// File: bu.validator.ts
// Path: src/validators/bu.validator.ts

import { z } from "zod";
import { optionalId, optionalText } from "@/validators/validator";

export const createBUBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  code: optionalText(20),
  parentBUId: optionalId,
  serviceLineIds: z.array(z.string().uuid()).default([]),
});

export const updateBUBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: optionalText(20),
  isActive: z.boolean().optional(),
  parentBUId: optionalId,
  serviceLineIds: z.array(z.string().uuid()).optional(), // full replace when sent
});

export type CreateBUInput = z.infer<typeof createBUBody>;
export type UpdateBUInput = z.infer<typeof updateBUBody>;
