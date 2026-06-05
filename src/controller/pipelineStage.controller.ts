// File: pipelineStage.controller.ts
// Path: src/controller/pipelineStage.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { CanonicalStage } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// shared select — single source of truth for all queries
// ─────────────────────────────────────────────────────────────────────────────

const stageSelect = {
  id: true,
  code: true,
  label: true,
  order: true,
  isMandatory: true,
  isTerminal: true,
  isActive: true,
  canonicalStage: true,
  serviceLineId: true,
  serviceLine: { select: { id: true, name: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline-stages
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStages = async (req: Request, res: Response) => {
  try {
    const { serviceLineId, includeInactive } = req.query as any;
    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (serviceLineId === "universal") {
      where.serviceLineId = null;
    } else if (serviceLineId) {
      where.serviceLineId = serviceLineId;
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
    const {
      stages,
      serviceLineId,
      deletedIds = [],
    } = req.body as {
      serviceLineId: string | null;
      deletedIds?: string[];
      stages: {
        id?: string;
        label: string;
        isMandatory: boolean;
        isTerminal: boolean;
        isActive: boolean;
        isNew: boolean;
        canonicalStage: CanonicalStage;
      }[];
    };

    if (!Array.isArray(stages) || stages.length === 0) {
      res
        .status(400)
        .json({ success: false, message: "stages array is required" });
      return;
    }

    const missing = stages.filter((s) => !s.canonicalStage);
    if (missing.length > 0) {
      res.status(400).json({
        success: false,
        message: `${missing.length} stage(s) are missing canonicalStage`,
      });
      return;
    }

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

    // capture for closure — serviceLineId from body is string | null
    const scopedServiceLineId: string | null = serviceLineId;

    await prisma.$transaction(async (tx) => {
      if (deletedIds.length > 0) {
        await tx.pipelineStage.deleteMany({
          where: { id: { in: deletedIds } },
        });
      }

      // ── Step 2: create new stages with temp code
      const createdMap = new Map<number, string>();

      for (let idx = 0; idx < stages.length; idx++) {
        const s = stages[idx];

        if (!s) {
          throw new Error(`Missing stage at index ${idx}`);
        }

        if (!s.isNew) continue;
        const created = await tx.pipelineStage.create({
          data: {
            code: `Z${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
            label: s.label,
            order: 9999,
            isMandatory: s.isMandatory,
            isTerminal: s.isTerminal,
            isActive: s.isActive,
            canonicalStage: s.canonicalStage,
            ...(scopedServiceLineId !== null
              ? { serviceLineId: scopedServiceLineId }
              : {}),
          },
          select: { id: true },
        });
        createdMap.set(idx, created.id);
      }

      // ── Step 3: update ALL with final order + code + canonicalStage
      for (let idx = 0; idx < stages.length; idx++) {
        const s = stages[idx];
        if (!s) {
          throw new Error(`Missing stage at index ${idx}`);
        }
        let realId: string;
        if (s.isNew) {
          const mapped = createdMap.get(idx);
          if (!mapped) throw new Error(`Missing created id for index ${idx}`);
          realId = mapped;
        } else {
          if (!s.id)
            throw new Error(`Existing stage at index ${idx} missing id`);
          realId = s.id;
        }

        await tx.pipelineStage.update({
          where: { id: realId },
          data: {
            order: idx + 1,
            code: (idx + 1).toString().padStart(2, "0"),
            label: s.label,
            isMandatory: s.isMandatory,
            isTerminal: s.isTerminal,
            isActive: s.isActive,
            canonicalStage: s.canonicalStage,
          },
        });
      }
    });

    const result = await prisma.pipelineStage.findMany({
      where: {
        ...(scopedServiceLineId !== null
          ? { serviceLineId: scopedServiceLineId }
          : { serviceLineId: null }),
      },
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
// POST /pipeline-stages
// ─────────────────────────────────────────────────────────────────────────────

export const createPipelineStage = async (req: Request, res: Response) => {
  try {
    const {
      code,
      label,
      order,
      serviceLineId,
      isMandatory,
      isTerminal,
      canonicalStage,
    } = req.body as {
      code: string;
      label: string;
      order: number;
      serviceLineId?: string | null;
      isMandatory?: boolean;
      isTerminal?: boolean;
      canonicalStage: CanonicalStage;
    };

    const existing = await prisma.pipelineStage.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        message: `Stage code "${code}" already exists`,
      });
      return;
    }

    if (serviceLineId) {
      const sl = await prisma.serviceLine.findUnique({
        where: { id: serviceLineId },
        select: { id: true },
      });
      if (!sl) {
        res
          .status(404)
          .json({ success: false, message: "Service line not found" });
        return;
      }
    }

    await prisma.pipelineStage.updateMany({
      where: {
        order: { gte: order },
        ...(serviceLineId != null
          ? { serviceLineId }
          : { serviceLineId: null }),
      },
      data: { order: { increment: 1 } },
    });

    const stage = await prisma.pipelineStage.create({
      data: {
        code: code.trim().toUpperCase(),
        label: label.trim(),
        order,
        isMandatory: isMandatory ?? true,
        isTerminal: isTerminal ?? false,
        isActive: true,
        canonicalStage,
        ...(serviceLineId != null ? { serviceLineId } : {}),
      },
      select: stageSelect,
    });

    res
      .status(201)
      .json({ success: true, message: "Stage created", data: stage });
  } catch (err) {
    console.error("createPipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create pipeline stage" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/:id
// canonicalStage intentionally NOT updatable — changing it corrupts historical logs
// ─────────────────────────────────────────────────────────────────────────────

export const updatePipelineStage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { label, isMandatory, isActive, serviceLineId } = req.body as {
      label?: string;
      isMandatory?: boolean;
      isActive?: boolean;
      serviceLineId?: string | null;
    };

    const existing = await prisma.pipelineStage.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    const updated = await prisma.pipelineStage.update({
      where: { id },
      data: {
        ...(label !== undefined && { label: label.trim() }),
        ...(isMandatory !== undefined && { isMandatory }),
        ...(isActive !== undefined && { isActive }),
        ...(serviceLineId !== undefined && {
          serviceLineId: serviceLineId ?? null,
        }),
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
      select: { id: true, code: true, label: true, serviceLineId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    const activePipelineCount = await prisma.requirementCandidatePipeline.count(
      {
        where: { currentStageId: id },
      }
    );
    if (activePipelineCount > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete "${existing.label}" — ${activePipelineCount} active pipeline(s) are at this stage`,
      });
      return;
    }

    await prisma.pipelineStage.delete({ where: { id } });

    const remaining = await prisma.pipelineStage.findMany({
      where: {
        ...(existing.serviceLineId != null
          ? { serviceLineId: existing.serviceLineId }
          : { serviceLineId: null }),
      },
      orderBy: { order: "asc" },
      select: { id: true },
    });

    await prisma.$transaction(
      remaining.map((s, idx) =>
        prisma.pipelineStage.update({
          where: { id: s.id },
          data: {
            order: idx + 1,
            code: (idx + 1).toString().padStart(2, "0"),
          },
        })
      )
    );

    res.json({ success: true, message: `Stage "${existing.label}" deleted` });
  } catch (err) {
    console.error("deletePipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete pipeline stage" });
  }
};
