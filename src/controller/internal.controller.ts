// controller/internal.controller.ts
// Called by Candidate Service after ingest — not exposed to frontend
// Auth via shared secret header: x-internal-secret

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

export const syncCandidateToCore = async (req: Request, res: Response) => {
  try {
    const {
      // who
      candidateServiceId, // Candidate Service UUID
      requirementId,
      recruiterId,
      assignmentId,

      // snapshot display fields
      fullName,
      email,
      phone,
      currentTitle,
      currentCompany,
      totalExpYears,
      topSkills,
      resumeUrl,

      // full profile blob
      rawSnapshot,
    } = req.body;

    // ── validate required fields
    if (
      !candidateServiceId ||
      !requirementId ||
      !recruiterId ||
      !fullName ||
      !email
    ) {
      res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message:
          "candidateServiceId, requirementId, recruiterId, fullName, email are required",
      });
      return;
    }

    // ── verify requirement exists and is active
    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, status: true, serviceLineId: true },
    });

    if (!requirement) {
      res
        .status(404)
        .json({
          success: false,
          code: "REQUIREMENT_NOT_FOUND",
          message: "Requirement not found",
        });
      return;
    }

    if (!["ACTIVE", "PENDING_APPROVAL"].includes(requirement.status)) {
      res.status(400).json({
        success: false,
        code: "REQUIREMENT_NOT_ACTIVE",
        message: `Requirement is ${requirement.status} — cannot add candidates`,
      });
      return;
    }

    // ── verify recruiter exists
    const recruiter = await prisma.user.findFirst({
      where: { id: recruiterId, isActive: true },
      select: { id: true },
    });

    if (!recruiter) {
      res
        .status(404)
        .json({
          success: false,
          code: "RECRUITER_NOT_FOUND",
          message: "Recruiter not found",
        });
      return;
    }

    // ── check duplicate — same candidate already linked to this requirement
    const existingSnapshot = await prisma.candidateSnapshot.findUnique({
      where: {
        candidateServiceId_requirementId: { candidateServiceId, requirementId },
      },
      select: { id: true, pipeline: { select: { id: true } } },
    });

    if (existingSnapshot) {
      // already synced — return existing pipeline id, not an error
      res.status(200).json({
        success: true,
        alreadyExisted: true,
        data: {
          snapshotId: existingSnapshot.id,
          pipelineId: existingSnapshot.pipeline?.id ?? null,
        },
      });
      return;
    }

    // ── resolve starting stage — code "01"
    const sourcedStage = await prisma.pipelineStage.findFirst({
      where: { code: "01", isActive: true },
      select: { id: true },
    });

    if (!sourcedStage) {
      res.status(500).json({
        success: false,
        code: "STAGE_NOT_CONFIGURED",
        message: "Pipeline stage 01 not found. Run seed first.",
      });
      return;
    }

    // ── transaction: snapshot + pipeline row + stage log + counter bump
    const result = await prisma.$transaction(async (tx) => {
      // 1. create snapshot — frozen at this moment
      const snapshot = await tx.candidateSnapshot.create({
        data: {
          candidateServiceId,
          requirementId,
          fullName,
          email,
          phone: phone ?? null,
          currentTitle: currentTitle ?? null,
          currentCompany: currentCompany ?? null,
          totalExpYears: totalExpYears ?? null,
          topSkills: topSkills ?? [],
          resumeUrl: resumeUrl ?? null,
          rawSnapshot: rawSnapshot ?? {},
          createdById: recruiterId,
        },
      });

      // 2. create pipeline row at stage 01
      const pipeline = await tx.requirementCandidatePipeline.create({
        data: {
          snapshotId: snapshot.id,
          requirementId,
          assignmentId: assignmentId ?? null,
          recruiterId,
          currentStageId: sourcedStage.id,
          stageUpdatedAt: new Date(),
          stageUpdatedById: recruiterId,
        },
      });

      // 3. append initial stage log
      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId: pipeline.id,
          fromStageId: null,
          toStageId: sourcedStage.id,
          changedById: recruiterId,
          timeInPrevStageMins: null,
          note: "Candidate synced from Candidate Service",
        },
      });

      // 4. bump activeApplications on requirement
      await tx.requirement.update({
        where: { id: requirementId },
        data: { activeApplications: { increment: 1 } },
      });

      return { snapshot, pipeline };
    });

    res.status(201).json({
      success: true,
      alreadyExisted: false,
      data: {
        snapshotId: result.snapshot.id,
        pipelineId: result.pipeline.id,
      },
    });
  } catch (err: any) {
    console.error("syncCandidateToCore:", err);
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: err.message ?? "Failed to sync candidate",
    });
  }
};
