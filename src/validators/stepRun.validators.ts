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

// POST /step-runs — one step (or "run_all") for one client
export const startStepRunBody = z.object({
  stepKey: z.string().trim().min(1).max(60),
  clientId: z.string().uuid(),
  spocIds: z.array(z.string().uuid()).max(500).optional(),
  businessUnitId: z.string().uuid().optional(),
  serviceLineId: z.string().uuid().optional(),
  // step options are forwarded to the engine as-is; run_all: { steps[], stepOptions{} }
  options: z.record(z.string(), z.unknown()).optional(),
});

export const stepOverviewQuery = z.object({ clientId: z.string().uuid() });

export type StartStepRunInput = z.infer<typeof startStepRunBody>;
