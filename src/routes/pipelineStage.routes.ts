// routes/pipelineStage.routes.ts
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
  deletePipelineStage,
} from "@/controller/pipelineStage.controller";

const router = Router();
const scope = scopeFilter("pipeline_stages");

const createPipelineStageSchema = z.object({
  code: z.string().min(1).max(10).trim(),
  label: z.string().min(1).max(100).trim(),
  order: z.number().int().min(1),
  serviceLineId: z.string().optional().nullable(),
  isMandatory: z.boolean().default(true),
  isTerminal: z.boolean().default(false),
});

const updatePipelineStageSchema = z.object({
  label: z.string().min(1).max(100).trim().optional(),
  isMandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.get("/", authenticateUser, getPipelineStages);

router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createPipelineStageSchema),
  createPipelineStage
);

router.patch(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updatePipelineStageSchema),
  updatePipelineStage
);

router.delete(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canDelete"),
  deletePipelineStage
);

export default router;
