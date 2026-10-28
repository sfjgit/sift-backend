// File: runQuota.validators.ts
// Path: src/validators/runQuota.validators.ts

import { z } from "zod";
import { QuotaPeriod } from "@prisma/client";

// subject: userId, or roleId, or neither (everyone) — never both
const subject = (b: { userId?: string | null | undefined; roleId?: string | null | undefined }) => !(b.userId && b.roleId);

export const createRunQuotaBody = z
  .object({
    stepId: z.string().uuid().nullable().optional(), // null / missing = all steps together
    roleId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
    period: z.nativeEnum(QuotaPeriod),
    maxRuns: z.number().int().min(0).max(10000),
    isActive: z.boolean().optional(),
  })
  .refine(subject, "Pick a role or a person, not both");

export const updateRunQuotaBody = z
  .object({
    period: z.nativeEnum(QuotaPeriod).optional(),
    maxRuns: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const mySlotsQuery = z.object({ stepId: z.string().uuid().optional() });

export type CreateRunQuotaInput = z.infer<typeof createRunQuotaBody>;
export type UpdateRunQuotaInput = z.infer<typeof updateRunQuotaBody>;
