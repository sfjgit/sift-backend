// controller/internal.controller.ts
// Called by Candidate Service after ingest — not exposed to frontend
// Auth via shared secret header: x-internal-secret

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";

export const syncCandidateToCore = async (req: Request, res: Response) => {
  try {
    const {
      candidateServiceId,
      requirementId,
      recruiterId,
      assignmentId,
      fullName,
      email,
      phone,
      currentTitle,
      currentCompany,
      totalExpYears,
      topSkills,
      resumeUrl,
      rawSnapshot,
      sourced,
    } = req.body;

    console.log("[syncCandidateToCore] Body:", req.body);

    // ── validate required fields
    if (
      !candidateServiceId ||
      !requirementId ||
      !recruiterId ||
      !fullName ||
      !email
    ) {
      console.error("[syncCandidateToCore] MISSING_FIELDS:", {
        candidateServiceId: candidateServiceId ?? "MISSING",
        requirementId: requirementId ?? "MISSING",
        recruiterId: recruiterId ?? "MISSING",
        fullName: fullName ?? "MISSING",
        email: email ?? "MISSING",
      });
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
      console.error("[syncCandidateToCore] REQUIREMENT_NOT_FOUND:", {
        requirementId,
      });
      res.status(404).json({
        success: false,
        code: "REQUIREMENT_NOT_FOUND",
        message: "Requirement not found",
      });
      return;
    }

    if (!["ACTIVE", "PENDING_APPROVAL"].includes(requirement.status)) {
      console.error("[syncCandidateToCore] REQUIREMENT_NOT_ACTIVE:", {
        requirementId,
        status: requirement.status,
      });
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
      console.error("[syncCandidateToCore] RECRUITER_NOT_FOUND:", {
        recruiterId,
      });
      res.status(404).json({
        success: false,
        code: "RECRUITER_NOT_FOUND",
        message: "Recruiter not found",
      });
      return;
    }

    // ── check duplicate
    const existingSnapshot = await prisma.candidateSnapshot.findUnique({
      where: {
        candidateServiceId_requirementId: { candidateServiceId, requirementId },
      },
      select: { id: true, pipeline: { select: { id: true } } },
    });

    if (existingSnapshot) {
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

    // ── resolve starting stage
    const sourcedStage = await prisma.pipelineStage.findFirst({
      where: { code: "01", isActive: true },
      select: { id: true },
    });

    if (!sourcedStage) {
      console.error(
        "[syncCandidateToCore] STAGE_NOT_CONFIGURED: Pipeline stage code '01' not found. Run seed."
      );
      res.status(500).json({
        success: false,
        code: "STAGE_NOT_CONFIGURED",
        message: "Pipeline stage 01 not found. Run seed first.",
      });
      return;
    }

    // ── transaction
    const result = await prisma.$transaction(async (tx) => {
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
          sourced: sourced ?? null,
          createdById: recruiterId,
        },
      });

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

      // await tx.requirement.update({
      //   where: { id: requirementId },
      //   data: {  },
      // });

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
    console.error("[syncCandidateToCore] INTERNAL_ERROR:", err);
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: err.message ?? "Failed to sync candidate",
    });
  }
};

// File: syncPublicCandidateToCore.controller.ts
// Path: src/controllers/internal/syncPublicCandidateToCore.controller.ts
//
// Public apply sync — creates a CandidateSnapshot only.
// No pipeline, no stage log. Recruiter assigns manually later.

// import { Request, Response } from "express";
// import { prisma } from "@/config/prisma";

export const syncPublicCandidateToCore = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      candidateServiceId,
      requirementId,
      fullName,
      email,
      phone,
      currentTitle,
      currentCompany,
      totalExpYears,
      topSkills,
      resumeUrl,
      rawSnapshot,
      sourced,
      type = "APPLICANT",
    } = req.body;

    // ── validate required fields ──────────────────────────────────────────────
    if (!candidateServiceId || !requirementId || !fullName || !email) {
      res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message:
          "candidateServiceId, requirementId, fullName, email are required",
      });
      return;
    }

    // ── verify requirement exists ─────────────────────────────────────────────
    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!requirement) {
      res.status(404).json({
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
        message: `Requirement is ${requirement.status} — cannot accept applications`,
      });
      return;
    }

    // ── check duplicate ───────────────────────────────────────────────────────
    const existing = await prisma.candidateSnapshot.findUnique({
      where: {
        candidateServiceId_requirementId: { candidateServiceId, requirementId },
      },
      select: { id: true, type: true },
    });

    if (existing) {
      res.status(200).json({
        success: true,
        alreadyExisted: true,
        data: { snapshotId: existing.id, type: existing.type },
      });
      return;
    }

    // ── create snapshot only ──────────────────────────────────────────────────
    const snapshot = await prisma.candidateSnapshot.create({
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
        sourced: sourced ?? null,
        type,
        createdById: null, // no recruiter for public applies
      },
    });

    res.status(201).json({
      success: true,
      alreadyExisted: false,
      data: { snapshotId: snapshot.id, type: snapshot.type },
    });
  } catch (err: any) {
    console.error("[syncPublicCandidateToCore] INTERNAL_ERROR:", err);
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: err.message ?? "Failed to sync applicant",
    });
  }
};
