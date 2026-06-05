// File: pipelineStage.validator.ts
// Path: src/validators/pipelineStage.validator.ts

import { z } from "zod";

// mirrors CanonicalStage enum from Prisma
export const canonicalStageEnum = z.enum([
  "SOURCED",
  "SCREENING",
  "INTERVIEW",
  "OFFER_IN_PROGRESS",
  "OFFERED",
  "HIRED",
  "JOINED",
  "DROPPED",
]);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/reorder
// ─────────────────────────────────────────────────────────────────────────────

const reorderStageItemSchema = z.object({
  // id absent = new stage
  id: z.string().uuid().optional(),

  code: z.string().min(1, "Code is required").max(20, "Code too long").trim(),

  label: z
    .string()
    .min(1, "Label is required")
    .max(100, "Label too long")
    .trim(),

  isMandatory: z.boolean(),
  isTerminal: z.boolean(),
  isActive: z.boolean(),
  isNew: z.boolean(),

  // optional — stages can exist without a canonical mapping
  canonicalStage: canonicalStageEnum.nullable().optional(),
});

export const reorderStagesSchema = z.object({
  deletedIds: z.array(z.string().uuid()).default([]),
  stages: z
    .array(reorderStageItemSchema)
    .min(1, "At least one stage is required")
    .refine(
      (stages) => {
        // existing stages must carry an id
        const existingWithoutId = stages.filter((s) => !s.isNew && !s.id);
        return existingWithoutId.length === 0;
      },
      { message: "All existing stages must have an id" }
    )
    .refine(
      (stages) => {
        // codes must be unique within the submission
        const codes = stages.map((s) => s.code.toUpperCase());
        return codes.length === new Set(codes).size;
      },
      { message: "Stage codes must be unique" }
    ),
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/:id
// canonicalStage deliberately excluded — only editable via reorder
// ─────────────────────────────────────────────────────────────────────────────

export const updateStageSchema = z
  .object({
    label: z.string().min(1).max(100).trim().optional(),
    isMandatory: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
