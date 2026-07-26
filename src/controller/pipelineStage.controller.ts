// File: pipelineStage.controller.ts
// Path: src/controller/pipelineStage.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { CanonicalStage, Prisma } from "@prisma/client";

// File: pipelineStage.controller.ts
// Path: src/modules/pipeline-stages/pipelineStage.controller.ts

// import { Prisma } from "@prisma/client";
// import { Request, Response } from "express";
// import { prisma } from "..."; // keep your existing prisma import

// ─────────────────────────────────────────────────────────────────────────────
// select — everything that matters and can be edited from the settings UI
// NOTE: assumes ServiceLine has a `name` field; rename below if yours differs.
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
  isStandard: true, // new — used later to fetch "standard" stages only
  serviceLineId: true, // null == common / unscoped
  serviceLine: {
    select: {
      id: true,
      name: true,
    },
  },
  createdAt: true,
} satisfies Prisma.PipelineStageSelect;

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline-stages
//   ?includeInactive=true  -> also return isActive:false rows
//   ?standardOnly=true     -> only isStandard:true rows
//   ?serviceLineId=<uuid>  -> that service line's rows + all common (null) rows
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStages = async (req: Request, res: Response) => {
  try {
    const { includeInactive, serviceLineId, standardOnly } =
      req.query as Record<string, string | undefined>;

    const where: Prisma.PipelineStageWhereInput = {};

    if (includeInactive !== "true") where.isActive = true;
    if (standardOnly === "true") where.isStandard = true;

    // When scoped to a service line, always fold in the common (unscoped) stages.
    // Anything without a serviceLineId is treated as shared across all lines.
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
// full state replace — frontend sends complete ordered array
// order derived from array index — never trusted from payload
// ─────────────────────────────────────────────────────────────────────────────
// File: pipelineStage.controller.ts
// Path: src/controller/pipelineStage.controller.ts

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/reorder
// full state replace — frontend sends complete ordered array
// order derived from array index — never trusted from payload
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

    // block delete if active pipelines reference those stages
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
      // ── Step 1: delete removed stages
      if (deletedIds.length > 0) {
        await tx.pipelineStage.deleteMany({
          where: { id: { in: deletedIds } },
        });
      }

      // ── Step 2: create new stages with temp order to avoid conflicts
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
            serviceLineId: s.serviceLineId ?? null,
            ...(s.canonicalStage ? { canonicalStage: s.canonicalStage } : {}),
          },
          select: { id: true },
        });
        createdMap.set(idx, created.id);
      }

      // ── Step 3: update ALL stages with final order from array position
      for (let idx = 0; idx < stages.length; idx++) {
        const s = stages[idx];
        if (!s) throw new Error(`Missing stage at index ${idx}`);

        let realId: string;
        if (s.isNew) {
          const mapped = createdMap.get(idx);
          if (!mapped)
            throw new Error(`Missing created id for new stage at index ${idx}`);
          realId = mapped;
        } else {
          if (!s.id)
            throw new Error(`Existing stage at index ${idx} missing id`);
          realId = s.id;
        }

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
// PATCH /pipeline-stages/:id
// single-row quick edit — canonicalStage / order still go through reorder only
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
      serviceLineId,
    } = req.body as {
      label?: string;
      isMandatory?: boolean;
      isTerminal?: boolean;
      isActive?: boolean;
      isStandard?: boolean;
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
        ...(isTerminal !== undefined && { isTerminal }),
        ...(isActive !== undefined && { isActive }),
        ...(isStandard !== undefined && { isStandard }),
        // serviceLineId can legitimately be set to null (→ common), so check key presence
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
// PATCH /pipeline-stages/:id
// label, isMandatory, isActive only — canonicalStage via reorder only
// ─────────────────────────────────────────────────────────────────────────────

// export const updatePipelineStage = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { label, isMandatory, isActive } = req.body as {
//       label?: string;
//       isMandatory?: boolean;
//       isActive?: boolean;
//     };

//     const existing = await prisma.pipelineStage.findUnique({
//       where: { id },
//       select: { id: true },
//     });
//     if (!existing) {
//       res.status(404).json({ success: false, message: "Stage not found" });
//       return;
//     }

//     const updated = await prisma.pipelineStage.update({
//       where: { id },
//       data: {
//         ...(label !== undefined && { label: label.trim() }),
//         ...(isMandatory !== undefined && { isMandatory }),
//         ...(isActive !== undefined && { isActive }),
//       },
//       select: stageSelect,
//     });

//     res.json({ success: true, message: "Stage updated", data: updated });
//   } catch (err) {
//     console.error("updatePipelineStage:", err);
//     res.status(500).json({ success: false, message: "Failed to update stage" });
//   }
// };

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

    res.json({
      success: true,
      message: `Stage "${existing.label}" deleted`,
    });
  } catch (err) {
    console.error("deletePipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete pipeline stage" });
  }
};
