// File: pipelineStage.routes.ts
// Path: src/routes/pipelineStage.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  getPipelineStages,
  updatePipelineStage,
  reorderPipelineStages,
  deletePipelineStage,
} from "@/controller/pipelineStage.controller";
import {
  reorderStagesSchema,
  updateStageSchema,
} from "@/validators/pipelineStage.validator";

const router = Router();
const scope = scopeFilter("pipeline_stages");
const auth = authenticateUser;

// GET /pipeline-stages
router.get("/", auth, getPipelineStages);

// PATCH /pipeline-stages/reorder — must be before /:id
router.patch(
  "/reorder",
  auth,
  scope,
  checkPermission("canEdit"),
  // validate.body(reorderStagesSchema),
  reorderPipelineStages
);

// PATCH /pipeline-stages/:id
router.patch(
  "/:id",
  auth,
  scope,
  checkPermission("canEdit"),
  validate.body(updateStageSchema),
  updatePipelineStage
);

// DELETE /pipeline-stages/:id
router.delete(
  "/:id",
  auth,
  scope,
  checkPermission("canDelete"),
  deletePipelineStage
);

export default router;
