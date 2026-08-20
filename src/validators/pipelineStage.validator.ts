// File: pipelineStage.validator.ts
// Path: src/validators/pipelineStage.validator.ts

import { z } from "zod";

export const canonicalStageEnum = z.enum([
  "SOURCED",
  "SCREENING",
  "SUBMMITED",
  "SHORTLISTED",
  "REJECTED",
  "DECLINED",
  "INTERVIEW",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_HOLD",
  "INTERVIEW_RESCHEDULED",
  "INTERVIEW_CANCELLED",
  "OFFER_IN_PROGRESS",
  "OFFERED",
  "HIRED",
  "JOINED",
  "DROPPED",
  "TRAINING_STARTED",
  "TRAINING_CANCELLED",
  "TRAINING_HOLD",
  "TRAINING_IN_PROGRESS",
  "TRAINING_COMPLETED",
]);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/reorder
// ─────────────────────────────────────────────────────────────────────────────

const reorderStageItemSchema = z
  .object({
    id: z.string().uuid().optional(),
    code: z.string().min(1, "Code is required").max(20).trim(),
    label: z.string().min(1, "Label is required").max(100).trim(),
    isMandatory: z.boolean(),
    isTerminal: z.boolean(),
    isActive: z.boolean(),
    isStandard: z.boolean(),
    pipeline: z.boolean().default(true),
    isSourced: z.boolean().default(false), // ← NEW
    isNearTerminal: z.boolean().default(false), // ← NEW
    isNew: z.boolean(),
    canonicalStage: canonicalStageEnum.nullable().optional(),
    serviceLineId: z.string().uuid().nullable().optional(),
  })
  // Mutual exclusion — same rules as server validateStageFlags
  .refine((s) => !(s.isSourced && s.isTerminal), {
    message: "Stage cannot be both Sourced and Terminal",
  })
  .refine((s) => !(s.isSourced && s.isNearTerminal), {
    message: "Stage cannot be both Sourced and Near-terminal",
  })
  .refine((s) => !(s.isTerminal && s.isNearTerminal), {
    message: "Stage cannot be both Terminal and Near-terminal",
  })
  .refine((s) => !(!s.pipeline && s.isTerminal), {
    message: "Exit stage (pipeline=false) cannot be Terminal",
  })
  .refine((s) => !(!s.pipeline && s.isSourced), {
    message: "Exit stage (pipeline=false) cannot be Sourced",
  });

export const reorderStagesSchema = z.object({
  deletedIds: z.array(z.string().uuid()).default([]),
  stages: z
    .array(reorderStageItemSchema)
    .min(1, "At least one stage is required")
    .refine((stages) => stages.filter((s) => !s.isNew && !s.id).length === 0, {
      message: "All existing stages must have an id",
    })
    .refine(
      (stages) => {
        const codes = stages.map((s) => s.code.toUpperCase());
        return codes.length === new Set(codes).size;
      },
      { message: "Stage codes must be unique" }
    ),
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/:id  — single row quick edit
// ─────────────────────────────────────────────────────────────────────────────

export const updateStageSchema = z
  .object({
    label: z.string().min(1).max(100).trim().optional(),
    isMandatory: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isTerminal: z.boolean().optional(),
    isStandard: z.boolean().optional(),
    pipeline: z.boolean().optional(),
    isSourced: z.boolean().optional(), // ← NEW
    isNearTerminal: z.boolean().optional(), // ← NEW
    serviceLineId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
