// File: stepRun.validators.ts
// Path: src/validators/stepRun.validators.ts

import { z } from "zod";
import { StepRunStatus } from "@prisma/client";
import { paginationQuery } from "@/validators/validator";

export const listStepRunsQuery = z.object({
  clientId: z.string().uuid().optional(),
  spocId: z.string().uuid().optional(),
  status: z.nativeEnum(StepRunStatus).optional(),
  stepId: z.string().uuid().optional(),
  requestedById: z.string().uuid().optional(),
  ...paginationQuery,
});

export const listOutreachQuery = z.object({
  clientId: z.string().uuid().optional(),
  spocId: z.string().uuid().optional(),
  ...paginationQuery,
});

export type ListStepRunsQuery = z.infer<typeof listStepRunsQuery>;
export type ListOutreachQuery = z.infer<typeof listOutreachQuery>;
