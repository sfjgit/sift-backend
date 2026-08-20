// File: pipelineStage.controller.ts
// Path: src/controller/pipelineStage.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { CanonicalStage, Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// SELECT — includes the two new flags
// ─────────────────────────────────────────────────────────────────────────────

const stageSelect = {
  id: true,
  code: true,
  label: true,
  order: true,
  canonicalStage: true,
  isMandatory: true,
  isTerminal: true,
  isActive: true,
  isStandard: true,
  pipeline: true,
  isSourced: true, // ← NEW
  isNearTerminal: true, // ← NEW
  serviceLineId: true,
  serviceLine: {
    select: { id: true, name: true },
  },
  createdAt: true,
} satisfies Prisma.PipelineStageSelect;

// ─────────────────────────────────────────────────────────────────────────────
// FLAG VALIDATION — server-side mutual exclusion guard
// ─────────────────────────────────────────────────────────────────────────────

function validateStageFlags(s: {
  isSourced: boolean;
  isTerminal: boolean;
  isNearTerminal: boolean;
  pipeline: boolean;
}): string | null {
  if (s.isSourced && s.isTerminal)
    return "Stage cannot be both Sourced and Terminal";
  if (s.isSourced && s.isNearTerminal)
    return "Stage cannot be both Sourced and Near-terminal";
  if (s.isTerminal && s.isNearTerminal)
    return "Stage cannot be both Terminal and Near-terminal";
  if (!s.pipeline && s.isTerminal)
    return "Exit stage (pipeline=false) cannot be Terminal";
  if (!s.pipeline && s.isSourced)
    return "Exit stage (pipeline=false) cannot be Sourced";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline-stages
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStages = async (req: Request, res: Response) => {
  try {
    const { includeInactive, serviceLineId, standardOnly } =
      req.query as Record<string, string | undefined>;

    const where: Prisma.PipelineStageWhereInput = {};
    if (includeInactive !== "true") where.isActive = true;
    if (standardOnly === "true") where.isStandard = true;
    if (serviceLineId) {
      where.OR = [{ serviceLineId }, { serviceLineId: null }];
    }

    const stages = await prisma.pipelineStage.findMany({
      where,
      orderBy: { order: "asc" },
      select: stageSelect,
    });

    res.json({ success: true, data: stages });
  } catch (err) {
    console.error("getPipelineStages:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline stages" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/reorder
// ─────────────────────────────────────────────────────────────────────────────

export const reorderPipelineStages = async (req: Request, res: Response) => {
  try {
    const { stages, deletedIds = [] } = req.body as {
      deletedIds?: string[];
      stages: {
        id?: string;
        code: string;
        label: string;
        isMandatory: boolean;
        isTerminal: boolean;
        isActive: boolean;
        isStandard: boolean;
        pipeline: boolean;
        isSourced: boolean; // ← NEW
        isNearTerminal: boolean; // ← NEW
        isNew: boolean;
        canonicalStage: CanonicalStage | null;
        serviceLineId: string | null;
      }[];
    };

    if (!Array.isArray(stages) || stages.length === 0) {
      res
        .status(400)
        .json({ success: false, message: "stages array is required" });
      return;
    }

    // Validate flags on each stage before touching the DB
    for (const s of stages) {
      const err = validateStageFlags({
        isSourced: s.isSourced ?? false,
        isTerminal: s.isTerminal,
        isNearTerminal: s.isNearTerminal ?? false,
        pipeline: s.pipeline ?? true,
      });
      if (err) {
        res
          .status(400)
          .json({ success: false, message: `"${s.label}": ${err}` });
        return;
      }
    }

    // Block delete if active pipelines reference those stages
    if (deletedIds.length > 0) {
      const blocked = await prisma.requirementCandidatePipeline.count({
        where: { currentStageId: { in: deletedIds } },
      });
      if (blocked > 0) {
        res.status(409).json({
          success: false,
          message: `${blocked} active pipeline(s) are at a stage you're trying to delete`,
        });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      // Step 1: delete removed stages
      if (deletedIds.length > 0) {
        await tx.pipelineStage.deleteMany({
          where: { id: { in: deletedIds } },
        });
      }

      // Step 2: create new stages with temp order to avoid conflicts
      const createdMap = new Map<number, string>();
      for (let idx = 0; idx < stages.length; idx++) {
        const s = stages[idx];
        if (!s?.isNew) continue;
        const created = await tx.pipelineStage.create({
          data: {
            code: `Z${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            label: s.label,
            order: 99999 + idx,
            isMandatory: s.isMandatory,
            isTerminal: s.isTerminal,
            isActive: s.isActive,
            isStandard: s.isStandard,
            pipeline: s.pipeline ?? true,
            isSourced: s.isSourced ?? false, // ← NEW
            isNearTerminal: s.isNearTerminal ?? false, // ← NEW
            serviceLineId: s.serviceLineId ?? null,
            ...(s.canonicalStage ? { canonicalStage: s.canonicalStage } : {}),
          },
          select: { id: true },
        });
        createdMap.set(idx, created.id);
      }

      // Step 3: update ALL stages with final order from array position
      for (let idx = 0; idx < stages.length; idx++) {
        const s = stages[idx];
        if (!s) throw new Error(`Missing stage at index ${idx}`);

        const realId = s.isNew ? createdMap.get(idx)! : s.id!;

        if (!realId) throw new Error(`Missing id for stage at index ${idx}`);

        await tx.pipelineStage.update({
          where: { id: realId },
          data: {
            code: s.code,
            label: s.label,
            order: idx + 1,
            isMandatory: s.isMandatory,
            isTerminal: s.isTerminal,
            isActive: s.isActive,
            isStandard: s.isStandard,
            pipeline: s.pipeline ?? true,
            isSourced: s.isSourced ?? false, // ← NEW
            isNearTerminal: s.isNearTerminal ?? false, // ← NEW
            serviceLineId: s.serviceLineId ?? null,
            canonicalStage: s.canonicalStage ?? null,
          },
        });
      }
    });

    const result = await prisma.pipelineStage.findMany({
      orderBy: { order: "asc" },
      select: stageSelect,
    });

    res.json({ success: true, message: "Stages saved", stages: result });
  } catch (err) {
    console.error("reorderPipelineStages:", err);
    res.status(500).json({ success: false, message: "Failed to save stages" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/:id  — single row quick edit
// ─────────────────────────────────────────────────────────────────────────────

export const updatePipelineStage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      label,
      isMandatory,
      isTerminal,
      isActive,
      isStandard,
      pipeline,
      isSourced, // ← NEW
      isNearTerminal, // ← NEW
      serviceLineId,
    } = req.body as {
      label?: string;
      isMandatory?: boolean;
      isTerminal?: boolean;
      isActive?: boolean;
      isStandard?: boolean;
      pipeline?: boolean;
      isSourced?: boolean;
      isNearTerminal?: boolean;
      serviceLineId?: string | null;
    };

    const existing = await prisma.pipelineStage.findUnique({
      where: { id },
      select: {
        id: true,
        isSourced: true,
        isTerminal: true,
        isNearTerminal: true,
        pipeline: true,
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    // Validate flags against merged state (patch over existing)
    const merged = {
      isSourced: isSourced ?? existing.isSourced,
      isTerminal: isTerminal ?? existing.isTerminal,
      isNearTerminal: isNearTerminal ?? existing.isNearTerminal,
      pipeline: pipeline ?? existing.pipeline,
    };
    const flagErr = validateStageFlags(merged);
    if (flagErr) {
      res.status(400).json({ success: false, message: flagErr });
      return;
    }

    const updated = await prisma.pipelineStage.update({
      where: { id },
      data: {
        ...(label !== undefined && { label: label.trim() }),
        ...(isMandatory !== undefined && { isMandatory }),
        ...(isTerminal !== undefined && { isTerminal }),
        ...(isActive !== undefined && { isActive }),
        ...(isStandard !== undefined && { isStandard }),
        ...(pipeline !== undefined && { pipeline }),
        ...(isSourced !== undefined && { isSourced }), // ← NEW
        ...(isNearTerminal !== undefined && { isNearTerminal }), // ← NEW
        ...(serviceLineId !== undefined && { serviceLineId }),
      },
      select: stageSelect,
    });

    res.json({ success: true, message: "Stage updated", data: updated });
  } catch (err) {
    console.error("updatePipelineStage:", err);
    res.status(500).json({ success: false, message: "Failed to update stage" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /pipeline-stages/:id
// ─────────────────────────────────────────────────────────────────────────────

export const deletePipelineStage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.pipelineStage.findUnique({
      where: { id },
      select: { id: true, label: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    const blocked = await prisma.requirementCandidatePipeline.count({
      where: { currentStageId: id },
    });
    if (blocked > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete "${existing.label}" — ${blocked} active pipeline(s) are at this stage`,
      });
      return;
    }

    await prisma.pipelineStage.delete({ where: { id } });
    res.json({ success: true, message: `Stage "${existing.label}" deleted` });
  } catch (err) {
    console.error("deletePipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete pipeline stage" });
  }
};
