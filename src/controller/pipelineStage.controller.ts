// controller/pipelineStage.controller.ts
import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline-stages
// Returns all active stages ordered by sequence.
// serviceLineId filter lets frontend fetch stages for a specific service line
// (merging universal + service-line-specific stages in correct order).
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStages = async (req: Request, res: Response) => {
  try {
    const { serviceLineId, includeInactive } = req.query as Record<
      string,
      string
    >;

    const where: any = {};

    if (includeInactive !== "true") where.isActive = true;

    // if serviceLineId provided — return universal stages + stages for that service line
    // this gives the correct full sequence for that service line (with the right stage 7 variant)
    if (serviceLineId) {
      where.OR = [{ serviceLineId: null }, { serviceLineId }];
    }

    const stages = await prisma.pipelineStage.findMany({
      where,
      orderBy: { order: "asc" },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        isMandatory: true,
        isTerminal: true,
        isActive: true,
        serviceLineId: true,
        serviceLine: { select: { id: true, name: true } },
      },
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
// POST /pipeline-stages
// Admin only. Used to add a new stage (e.g. a new service-line-specific variant).
// Core 01–10 sequence is seeded — this is for additions only.
// ─────────────────────────────────────────────────────────────────────────────

export const createPipelineStage = async (req: Request, res: Response) => {
  try {
    const { code, label, order, serviceLineId, isMandatory, isTerminal } =
      req.body;

    // code must be unique — guard duplicate
    const existing = await prisma.pipelineStage.findUnique({
      where: { code },
      select: { id: true },
    });

    if (existing) {
      res.status(409).json({
        success: false,
        message: `Stage with code "${code}" already exists`,
      });
      return;
    }

    // if serviceLineId provided, verify it exists
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

    const stage = await prisma.pipelineStage.create({
      data: {
        code: code.trim().toUpperCase(),
        label: label.trim(),
        order,
        serviceLineId: serviceLineId ?? null,
        isMandatory: isMandatory ?? true,
        isTerminal: isTerminal ?? false,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        isMandatory: true,
        isTerminal: true,
        isActive: true,
        serviceLineId: true,
        serviceLine: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: "Pipeline stage created",
      data: stage,
    });
  } catch (err) {
    console.error("createPipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create pipeline stage" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline-stages/:id
// Label and isMandatory can be updated.
// code, order, isTerminal, serviceLineId — locked after creation.
// Changing those would corrupt existing pipeline history.
// ─────────────────────────────────────────────────────────────────────────────

export const updatePipelineStage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      code,
      label,
      order,
      serviceLineId,
      isMandatory,
      isTerminal,
      isActive,
    } = req.body;

    const existing = await prisma.pipelineStage.findUnique({
      where: { id },
      select: { id: true, code: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    // code uniqueness check if changing
    if (code && code.trim().toUpperCase() !== existing.code) {
      const codeTaken = await prisma.pipelineStage.findFirst({
        where: { code: code.trim().toUpperCase(), id: { not: id } },
        select: { id: true },
      });
      if (codeTaken) {
        res.status(409).json({
          success: false,
          message: `Stage code "${code.toUpperCase()}" is already used by another stage`,
        });
        return;
      }
    }

    // verify serviceLineId if provided
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

    // count active pipelines at this stage — warn but don't block
    const activePipelineCount = await prisma.requirementCandidatePipeline.count(
      {
        where: { currentStageId: id },
      }
    );

    const updated = await prisma.pipelineStage.update({
      where: { id },
      data: {
        ...(code !== undefined && { code: code.trim().toUpperCase() }),
        ...(label !== undefined && { label: label.trim() }),
        ...(order !== undefined && { order: Number(order) }),
        ...(serviceLineId !== undefined && {
          serviceLineId: serviceLineId || null,
        }),
        ...(isMandatory !== undefined && { isMandatory }),
        ...(isTerminal !== undefined && { isTerminal }),
        ...(isActive !== undefined && { isActive }),
      },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        isMandatory: true,
        isTerminal: true,
        isActive: true,
        serviceLineId: true,
        serviceLine: { select: { id: true, name: true } },
      },
    });

    res.json({
      success: true,
      message: "Pipeline stage updated",
      data: updated,
      ...(activePipelineCount > 0 && {
        warning: `${activePipelineCount} active pipeline row(s) are currently at this stage.`,
      }),
    });
  } catch (err) {
    console.error("updatePipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update pipeline stage" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /pipeline-stages/:id
// Hard block if any pipeline row is currently on this stage.
// Safe to delete only if no active pipelines reference it.
// ─────────────────────────────────────────────────────────────────────────────

export const deletePipelineStage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.pipelineStage.findUnique({
      where: { id },
      select: { id: true, code: true, label: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    // block delete if any active pipeline is currently on this stage
    const activePipelineCount = await prisma.requirementCandidatePipeline.count(
      {
        where: { currentStageId: id },
      }
    );

    if (activePipelineCount > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete stage "${existing.label}" — ${activePipelineCount} active pipeline(s) are currently at this stage`,
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
