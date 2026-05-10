// controller/pipeline.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Resolve the correct stage sequence for a requirement based on its service line.
// Filters out the variant stage that doesn't apply (07A vs 07B).
async function getStageSequence(requirementId: string) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { serviceLineId: true },
  });

  return prisma.pipelineStage.findMany({
    where: {
      isActive: true,
      OR: [
        { serviceLineId: null },
        { serviceLineId: requirement?.serviceLineId ?? undefined },
      ],
    },
    orderBy: { order: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      isMandatory: true,
      isTerminal: true,
      serviceLineId: true,
    },
  });
}

// Find the pipeline row and verify it belongs to the requirement
async function findPipeline(pipelineId: string, requirementId: string) {
  return prisma.requirementCandidatePipeline.findFirst({
    where: { id: pipelineId, requirementId },
    select: {
      id: true,
      requirementId: true,
      recruiterId: true,
      isRejected: true,
      isWithdrawn: true,
      isOnHold: true,
      stageUpdatedAt: true,
      currentStageId: true,
      currentStage: {
        select: { id: true, code: true, order: true, isTerminal: true },
      },
      offerStatus: true,
    },
  });
}

// Compute minutes spent in current stage before transitioning
function computeTimeInStage(stageUpdatedAt: Date): number {
  return Math.floor((Date.now() - stageUpdatedAt.getTime()) / 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/candidates
// Called by Candidate Service after ingest.
// Creates CandidateSnapshot + RequirementCandidatePipeline in one transaction.
// ─────────────────────────────────────────────────────────────────────────────

export const pushCandidate = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const actorId = req.user!.id;
    const body = req.body;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, status: true, serviceLineId: true },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    if (!["ACTIVE", "PENDING_APPROVAL"].includes(requirement.status)) {
      res.status(400).json({
        success: false,
        message: "Cannot add candidates to a requirement that is not active",
      });
      return;
    }

    // check duplicate — same candidate already in this requirement's pipeline
    const duplicate = await prisma.candidateSnapshot.findUnique({
      where: {
        candidateServiceId_requirementId: {
          candidateServiceId: body.candidateServiceId,
          requirementId,
        },
      },
      select: { id: true },
    });

    if (duplicate) {
      res.status(409).json({
        success: false,
        message: "Candidate already in pipeline for this requirement",
      });
      return;
    }

    // resolve starting stage — always "01" / Sourced
    const sourced = await prisma.pipelineStage.findFirst({
      where: { code: "01", isActive: true },
      select: { id: true },
    });

    if (!sourced) {
      res.status(500).json({
        success: false,
        message:
          "Pipeline stage configuration missing. Seed PipelineStage first.",
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. create snapshot — frozen point-in-time copy
      const snapshot = await tx.candidateSnapshot.create({
        data: {
          candidateServiceId: body.candidateServiceId,
          requirementId,
          fullName: body.fullName,
          email: body.email,
          phone: body.phone ?? null,
          currentTitle: body.currentTitle ?? null,
          currentCompany: body.currentCompany ?? null,
          totalExpYears: body.totalExpYears ?? null,
          topSkills: body.topSkills ?? [],
          resumeUrl: body.resumeUrl ?? null,
          rawSnapshot: body.rawSnapshot,
          createdById: actorId,
        },
      });

      // 2. create pipeline row at stage 01
      const pipeline = await tx.requirementCandidatePipeline.create({
        data: {
          snapshotId: snapshot.id,
          requirementId,
          assignmentId: body.assignmentId ?? null,
          recruiterId: body.recruiterId,
          currentStageId: sourced.id,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
        },
        select: {
          id: true,
          currentStage: { select: { id: true, code: true, label: true } },
          createdAt: true,
        },
      });

      // 3. write initial stage log entry (fromStage null = entry point)
      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId: pipeline.id,
          fromStageId: null,
          toStageId: sourced.id,
          changedById: actorId,
          timeInPrevStageMins: null,
          note: "Candidate entered pipeline",
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
      message: "Candidate added to pipeline",
      data: {
        snapshotId: result.snapshot.id,
        pipelineId: result.pipeline.id,
        currentStage: result.pipeline.currentStage,
      },
    });
  } catch (err) {
    console.error("pushCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to add candidate to pipeline" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/stage
// Move candidate to next stage. Enforces sequence.
// Mandatory stages can only be skipped with skipReason.
// ─────────────────────────────────────────────────────────────────────────────

export const updatePipelineStage = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { stageId, skipReason, note } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.isRejected || pipeline.isWithdrawn) {
      res.status(400).json({
        success: false,
        message: "Cannot move stage on a rejected or withdrawn candidate",
      });
      return;
    }

    if (pipeline.currentStage.isTerminal) {
      res.status(400).json({
        success: false,
        message: "Candidate has already reached a terminal stage",
      });
      return;
    }

    // resolve target stage
    const targetStage = await prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: {
        id: true,
        code: true,
        order: true,
        isMandatory: true,
        isTerminal: true,
        label: true,
      },
    });

    if (!targetStage || !targetStage) {
      res
        .status(404)
        .json({ success: false, message: "Target stage not found" });
      return;
    }

    // must move forward
    if (targetStage.order <= pipeline.currentStage.order) {
      res.status(400).json({
        success: false,
        message: "Stage must move forward in sequence",
      });
      return;
    }

    // check if any mandatory stages are being skipped
    const stages = await getStageSequence(requirementId);
    const currentIdx = stages.findIndex(
      (s) => s.id === pipeline.currentStageId
    );
    const targetIdx = stages.findIndex((s) => s.id === stageId);

    if (targetIdx === -1) {
      res.status(400).json({
        success: false,
        message:
          "Target stage is not valid for this requirement's service line",
      });
      return;
    }

    const skippedMandatory = stages
      .slice(currentIdx + 1, targetIdx)
      .filter((s) => s.isMandatory);

    if (skippedMandatory.length > 0 && !skipReason) {
      res.status(400).json({
        success: false,
        message: `Skipping mandatory stage(s): ${skippedMandatory
          .map((s) => s.label)
          .join(", ")}. Provide skipReason.`,
        skippedStages: skippedMandatory.map((s) => ({
          code: s.code,
          label: s.label,
        })),
      });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    await prisma.$transaction(async (tx) => {
      // update pipeline current stage
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          currentStageId: stageId,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
          // lift hold if moving forward
          isOnHold: false,
          onHoldAt: null,
          onHoldReason: null,
        },
      });

      // append stage log
      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: stageId,
          changedById: actorId,
          wasSkipped: skippedMandatory.length > 0,
          skipReason: skipReason ?? null,
          timeInPrevStageMins,
          note: note ?? null,
        },
      });

      // bump interviewsScheduled counter on requirement if moving into an interview stage
      const interviewCodes = ["05", "06", "07A", "07B", "08"];
      if (interviewCodes.includes(targetStage.code)) {
        await tx.requirement.update({
          where: { id: requirementId },
          data: { interviewsScheduled: { increment: 1 } },
        });

        // bump assignment interviewsCount if assignment exists
        if (pipeline.recruiterId) {
          await tx.requirementAssignment.updateMany({
            where: {
              requirementId,
              assignedToId: pipeline.recruiterId,
              status: "ACTIVE",
            },
            data: { interviewsCount: { increment: 1 } },
          });
        }
      }

      // bump filledOpenings if joined
      if (targetStage.isTerminal) {
        await tx.requirement.update({
          where: { id: requirementId },
          data: {
            filledOpenings: { increment: 1 },
            activeApplications: { decrement: 1 },
          },
        });
      }
    });

    res.json({
      success: true,
      message: `Stage moved to ${targetStage.label}`,
      data: {
        pipelineId,
        stageCode: targetStage.code,
        stageLabel: targetStage.label,
      },
    });
  } catch (err) {
    console.error("updatePipelineStage:", err);
    res.status(500).json({ success: false, message: "Failed to update stage" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/submit
// Mark candidate as submitted to client.
// ─────────────────────────────────────────────────────────────────────────────

export const submitCandidate = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { submissionNote } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.isRejected || pipeline.isWithdrawn) {
      res
        .status(400)
        .json({
          success: false,
          message: "Candidate is rejected or withdrawn",
        });
      return;
    }

    if (pipeline.currentStage.order < 3) {
      res.status(400).json({
        success: false,
        message:
          "Candidate must be at least Shortlisted before submission to client",
      });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    // resolve submitted_to_client stage
    const submittedStage = await prisma.pipelineStage.findFirst({
      where: { code: "04", isActive: true },
      select: { id: true, label: true },
    });

    if (!submittedStage) {
      res
        .status(500)
        .json({ success: false, message: "Stage 04 not configured" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          submissionNote,
          submittedAt: new Date(),
          submittedById: actorId,
          currentStageId: submittedStage.id,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
        },
      });

      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: submittedStage.id,
          changedById: actorId,
          timeInPrevStageMins,
          note: submissionNote,
        },
      });

      // bump submissionsCount on assignment
      await tx.requirementAssignment.updateMany({
        where: {
          requirementId,
          assignedToId: pipeline.recruiterId,
          status: "ACTIVE",
        },
        data: { submissionsCount: { increment: 1 } },
      });
    });

    res.json({ success: true, message: "Candidate submitted to client" });
  } catch (err) {
    console.error("submitCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to submit candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/offer
// Roll an offer — moves to stage 09.
// ─────────────────────────────────────────────────────────────────────────────

export const rollOffer = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { offeredCtc, salaryCurrency, salaryType, expectedJoiningDate } =
      req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.isRejected || pipeline.isWithdrawn) {
      res
        .status(400)
        .json({
          success: false,
          message: "Candidate is rejected or withdrawn",
        });
      return;
    }

    const offerStage = await prisma.pipelineStage.findFirst({
      where: { code: "09", isActive: true },
      select: { id: true, label: true },
    });

    if (!offerStage) {
      res
        .status(500)
        .json({ success: false, message: "Stage 09 not configured" });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    await prisma.$transaction(async (tx) => {
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          offeredCtc,
          salaryCurrency: salaryCurrency ?? "INR",
          salaryType,
          offeredAt: new Date(),
          offeredById: actorId,
          offerStatus: "PENDING",
          expectedJoiningDate: expectedJoiningDate
            ? new Date(expectedJoiningDate)
            : null,
          currentStageId: offerStage.id,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
        },
      });

      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: offerStage.id,
          changedById: actorId,
          timeInPrevStageMins,
          note: `Offer rolled: ${offeredCtc} ${salaryCurrency ?? "INR"}`,
        },
      });

      await tx.requirement.update({
        where: { id: requirementId },
        data: { offersRolledOut: { increment: 1 } },
      });
    });

    res.json({ success: true, message: "Offer rolled out" });
  } catch (err) {
    console.error("rollOffer:", err);
    res.status(500).json({ success: false, message: "Failed to roll offer" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/offer/status
// Accept / decline / revoke offer.
// ─────────────────────────────────────────────────────────────────────────────

export const updateOfferStatus = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { offerStatus, actualJoiningDate, declineReason, revocationReason } =
      req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.offerStatus !== "PENDING") {
      res.status(400).json({
        success: false,
        message: "Offer is not in PENDING state",
      });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    // if accepted move to joined stage, otherwise stay on offer stage
    let nextStageId = pipeline.currentStageId;
    let stageNote = "";

    if (offerStatus === "ACCEPTED") {
      const joinedStage = await prisma.pipelineStage.findFirst({
        where: { code: "10", isActive: true },
        select: { id: true },
      });
      if (joinedStage) nextStageId = joinedStage.id;
      stageNote = "Offer accepted — moved to Joined";
    } else if (offerStatus === "DECLINED") {
      stageNote = `Offer declined: ${declineReason ?? ""}`;
    } else if (offerStatus === "REVOKED") {
      stageNote = `Offer revoked: ${revocationReason ?? ""}`;
    }

    await prisma.$transaction(async (tx) => {
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          offerStatus,
          actualJoiningDate: actualJoiningDate
            ? new Date(actualJoiningDate)
            : null,
          currentStageId: nextStageId,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
        },
      });

      if (nextStageId !== pipeline.currentStageId) {
        await tx.candidatePipelineStageLog.create({
          data: {
            pipelineId,
            fromStageId: pipeline.currentStageId,
            toStageId: nextStageId,
            changedById: actorId,
            timeInPrevStageMins,
            note: stageNote,
          },
        });

        // joined — bump counters
        await tx.requirement.update({
          where: { id: requirementId },
          data: {
            filledOpenings: { increment: 1 },
            activeApplications: { decrement: 1 },
          },
        });
      }
    });

    res.json({ success: true, message: `Offer ${offerStatus.toLowerCase()}` });
  } catch (err) {
    console.error("updateOfferStatus:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update offer status" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/reject
// ─────────────────────────────────────────────────────────────────────────────

export const rejectCandidate = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { rejectionReason } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.isRejected) {
      res
        .status(400)
        .json({ success: false, message: "Candidate already rejected" });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    await prisma.$transaction(async (tx) => {
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          isRejected: true,
          rejectedAt: new Date(),
          rejectedById: actorId,
          rejectionReason,
        },
      });

      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: pipeline.currentStageId, // stays on same stage, just marked rejected
          changedById: actorId,
          timeInPrevStageMins,
          note: `Rejected: ${rejectionReason}`,
        },
      });

      await tx.requirement.update({
        where: { id: requirementId },
        data: { activeApplications: { decrement: 1 } },
      });
    });

    res.json({ success: true, message: "Candidate rejected" });
  } catch (err) {
    console.error("rejectCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to reject candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/withdraw
// ─────────────────────────────────────────────────────────────────────────────

export const withdrawCandidate = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { withdrawnReason } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.isWithdrawn) {
      res
        .status(400)
        .json({ success: false, message: "Candidate already withdrawn" });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    await prisma.$transaction(async (tx) => {
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          isWithdrawn: true,
          withdrawnAt: new Date(),
          withdrawnReason,
        },
      });

      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: pipeline.currentStageId,
          changedById: actorId,
          timeInPrevStageMins,
          note: `Withdrawn: ${withdrawnReason}`,
        },
      });

      await tx.requirement.update({
        where: { id: requirementId },
        data: { activeApplications: { decrement: 1 } },
      });
    });

    res.json({ success: true, message: "Candidate withdrawn" });
  } catch (err) {
    console.error("withdrawCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to withdraw candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/candidates/:pipelineId/hold
// ─────────────────────────────────────────────────────────────────────────────

export const holdCandidate = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { onHoldReason } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId, requirementId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.isRejected || pipeline.isWithdrawn) {
      res
        .status(400)
        .json({
          success: false,
          message: "Candidate is rejected or withdrawn",
        });
      return;
    }

    if (pipeline.isOnHold) {
      res
        .status(400)
        .json({ success: false, message: "Candidate is already on hold" });
      return;
    }

    await prisma.requirementCandidatePipeline.update({
      where: { id: pipelineId },
      data: {
        isOnHold: true,
        onHoldAt: new Date(),
        onHoldReason,
      },
    });

    res.json({ success: true, message: "Candidate placed on hold" });
  } catch (err) {
    console.error("holdCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to hold candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates/:pipelineId/timeline
// Full stage log — source of TAT and aging display.
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineTimeline = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;

    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: { id: pipelineId, requirementId },
      select: {
        id: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        rejectionReason: true,
        withdrawnReason: true,
        onHoldReason: true,
        submittedAt: true,
        offeredCtc: true,
        offerStatus: true,
        expectedJoiningDate: true,
        actualJoiningDate: true,
        createdAt: true,
        currentStage: { select: { code: true, label: true, order: true } },
        recruiter: { select: { id: true, firstName: true, lastName: true } },
        snapshot: {
          select: {
            candidateServiceId: true,
            fullName: true,
            email: true,
            currentTitle: true,
            currentCompany: true,
            topSkills: true,
            resumeUrl: true,
          },
        },
        stageHistory: {
          select: {
            id: true,
            fromStageId: true,
            toStageId: true,
            wasSkipped: true,
            skipReason: true,
            timeInPrevStageMins: true,
            note: true,
            createdAt: true,
            fromStage: { select: { code: true, label: true } },
            toStage: { select: { code: true, label: true } },
            changedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    // compute total time in pipeline so far
    const totalMins = pipeline.stageHistory.reduce(
      (acc, log) => acc + (log.timeInPrevStageMins ?? 0),
      0
    );

    res.json({
      success: true,
      data: {
        ...pipeline,
        totalTimeInPipelineMins: totalMins,
        totalTimeInPipelineDays: parseFloat((totalMins / 60 / 24).toFixed(1)),
      },
    });
  } catch (err) {
    console.error("getPipelineTimeline:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch timeline" });
  }
};
