// File: pipelineStage.routes.ts
// Path: src/routes/pipelineStage.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import { z } from "zod";
import {
  getPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  reorderPipelineStages,
  deletePipelineStage,
} from "@/controller/pipelineStage.controller";

const router = Router();
const scope = scopeFilter("pipeline_stages");
const auth = authenticateUser;

// CanonicalStage enum values mirrored from Prisma for Zod validation
const canonicalStageEnum = z.enum([
  "SOURCED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "JOINED",
  "DROPPED",
]);

const createStageSchema = z.object({
  code: z.string().min(1).max(10).trim(),
  label: z.string().min(1).max(100).trim(),
  order: z.number().int().min(1),
  serviceLineId: z.string().optional().nullable(),
  isMandatory: z.boolean().default(true),
  isTerminal: z.boolean().default(false),
  canonicalStage: canonicalStageEnum, // required on create
});

// canonicalStage intentionally excluded — not updatable after creation
const updateStageSchema = z.object({
  label: z.string().min(1).max(100).trim().optional(),
  isMandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
  serviceLineId: z.string().optional().nullable(),
});

const reorderStageSchema = z.object({
  serviceLineId: z.string().nullable(),
  deletedIds: z.array(z.string()).default([]),
  stages: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1).max(100).trim(),
        isMandatory: z.boolean(),
        isTerminal: z.boolean(),
        isActive: z.boolean(),
        isNew: z.boolean(),
        canonicalStage: canonicalStageEnum, // required on every stage in the array
      })
    )
    .min(1),
});

router.get("/", auth, getPipelineStages);

router.post(
  "/",
  auth,
  scope,
  checkPermission("canAdd"),
  validate.body(createStageSchema),
  createPipelineStage
);

router.patch(
  "/reorder",
  auth,
  scope,
  checkPermission("canEdit"),
  // validate.body(reorderStageSchema),
  reorderPipelineStages
);

router.patch(
  "/:id",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(updateStageSchema),
  updatePipelineStage
);

router.delete(
  "/:id",
  auth,
  scope,
  checkPermission("canDelete"),
  deletePipelineStage
);

export default router;
