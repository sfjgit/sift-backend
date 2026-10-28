// File: integration.validators.ts
// Path: src/validators/integration.validators.ts

import { z } from "zod";

export const updatePipelineStepBody = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
    userClientLimit: z.number().int().min(1).max(100000).nullable().optional(),
    rerunAfterDays: z.number().int().min(1).max(3650).nullable().optional(),
    config: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const updateServiceBody = z
  .object({
    baseUrl: z.string().trim().url().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    timeoutMins: z.number().int().min(5).max(24 * 60).optional(),
    maxDispatchTries: z.number().int().min(1).max(20).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const testKeyBody = z.object({
  provider: z.enum(["apollo", "anthropic", "brightdata", "bouncer", "s3"]),
});

export type UpdatePipelineStepInput = z.infer<typeof updatePipelineStepBody>;
export type UpdateServiceInput = z.infer<typeof updateServiceBody>;
