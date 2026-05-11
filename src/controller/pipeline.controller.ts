// controller/pipeline.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { getRequirementScopeWhere } from "@/services/requirementService";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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

// Works from both /pipeline/:pipelineId and /requirements/:id/candidates/:pipelineId
// requirementId param is optional — used only for extra scope check when coming from requirement route
async function findPipeline(pipelineId: string, requirementId?: string) {
  return prisma.requirementCandidatePipeline.findFirst({
    where: {
      id: pipelineId,
      ...(requirementId ? { requirementId } : {}),
    },
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

function computeTimeInStage(stageUpdatedAt: Date): number {
  return Math.floor((Date.now() - stageUpdatedAt.getTime()) / 60_000);
}

// shared pipeline select — used in list and detail
const PIPELINE_SELECT = {
  id: true,
  recruiterId: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  rejectionReason: true,
  withdrawnReason: true,
  onHoldReason: true,
  submittedAt: true,
  submissionNote: true,
  offeredCtc: true,
  salaryCurrency: true,
  salaryType: true,
  offerStatus: true,
  offeredAt: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  currentStage: {
    select: { id: true, code: true, label: true, order: true },
  },
  snapshot: {
    select: {
      id: true,
      candidateServiceId: true,
      fullName: true,
      email: true,
      phone: true,
      currentTitle: true,
      currentCompany: true,
      totalExpYears: true,
      topSkills: true,
      resumeUrl: true,
    },
  },
  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      status: true,
      priority: true,
      totalOpenings: true,
      filledOpenings: true,
      client: { select: { id: true, name: true } },
      serviceLine: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true } },
    },
  },
  recruiter: { select: { id: true, firstName: true, lastName: true } },
  assignment: {
    select: {
      id: true,
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline
// All pipeline rows scoped to the current user.
// Filters: stageCode, recruiterId, requirementId, clientId, isRejected,
//          isWithdrawn, isOnHold, search (candidate name/email)
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelines = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const {
      stageCode,
      recruiterId,
      requirementId,
      clientId,
      isRejected,
      isWithdrawn,
      isOnHold,
      search,
      page = "1",
      limit = "25",
      sortBy = "stageUpdatedAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    // scope: non-superadmin sees only pipelines on requirements they can access
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const where: any = {
      requirement: { ...scopeWhere, deletedAt: null },
    };

    if (stageCode) where.currentStage = { code: stageCode };
    if (requirementId) where.requirementId = requirementId;
    if (clientId) where.requirement = { ...where.requirement, clientId };
    if (recruiterId) where.recruiterId = recruiterId;
    if (isRejected !== undefined) where.isRejected = isRejected === "true";
    if (isWithdrawn !== undefined) where.isWithdrawn = isWithdrawn === "true";
    if (isOnHold !== undefined) where.isOnHold = isOnHold === "true";

    if (search) {
      where.snapshot = {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { currentCompany: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const SORTABLE: Record<string, any> = {
      stageUpdatedAt: { stageUpdatedAt: sortDir },
      createdAt: { createdAt: sortDir },
    };
    const orderBy = SORTABLE[sortBy] ?? { stageUpdatedAt: "desc" };

    const [total, pipelines] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: PIPELINE_SELECT,
        orderBy,
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: pipelines,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getPipelines:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipelines" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline/stats
// Count by stage for the scoped user — drives the kanban header numbers.
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const { requirementId, recruiterId, clientId } = req.query as Record<
      string,
      string
    >;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const where: any = {
      requirement: { ...scopeWhere, deletedAt: null },
      isRejected: false,
      isWithdrawn: false,
    };

    if (requirementId) where.requirementId = requirementId;
    if (clientId) where.requirement = { ...where.requirement, clientId };
    if (recruiterId) where.recruiterId = recruiterId;

    const [byStage, rejected, withdrawn, onHold] = await Promise.all([
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where,
        _count: { _all: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { ...where, isRejected: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { ...where, isWithdrawn: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { ...where, isOnHold: true },
      }),
    ]);

    // resolve stage details for the grouped counts
    const stageIds = byStage.map((s) => s.currentStageId);
    const stages = stageIds.length
      ? await prisma.pipelineStage.findMany({
          where: { id: { in: stageIds } },
          select: { id: true, code: true, label: true, order: true },
        })
      : [];

    const stageMap = new Map(stages.map((s) => [s.id, s]));

    const stageBreakdown = byStage
      .map((row) => {
        const stage = stageMap.get(row.currentStageId);
        return stage
          ? {
              stageId: row.currentStageId,
              code: stage.code,
              label: stage.label,
              order: stage.order,
              count: row._count._all,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a!.order - b!.order);

    const total = stageBreakdown.reduce((acc, s) => acc + s!.count, 0);

    res.json({
      success: true,
      data: {
        total,
        rejected,
        withdrawn,
        onHold,
        byStage: stageBreakdown,
      },
    });
  } catch (err) {
    console.error("getPipelineStats:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline stats" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /pipeline/:pipelineId
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineById = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;

    const pipeline = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: pipelineId },
      select: PIPELINE_SELECT,
    });

    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    res.json({ success: true, data: pipeline });
  } catch (err) {
    console.error("getPipelineById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/candidates
// Called by Candidate Service after ingest.
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
// PATCH /:pipelineId/stage  (also works as /requirements/:id/candidates/:pipelineId/stage)
// ─────────────────────────────────────────────────────────────────────────────

// export const updatePipelineStage = async (req: Request, res: Response) => {
//   try {
//     const pipelineId = req.params.pipelineId ?? req.params.pipelineId;
//     const requirementId = req.params.id ?? undefined;
//     const { stageId, skipReason, note } = req.body;
//     const actorId = req.user!.id;

//     const pipeline = await findPipeline(pipelineId, requirementId);
//     if (!pipeline) {
//       res
//         .status(404)
//         .json({ success: false, message: "Pipeline entry not found" });
//       return;
//     }

//     if (pipeline.isRejected || pipeline.isWithdrawn) {
//       res.status(400).json({
//         success: false,
//         message: "Cannot move stage on a rejected or withdrawn candidate",
//       });
//       return;
//     }

//     if (pipeline.currentStage.isTerminal) {
//       res.status(400).json({
//         success: false,
//         message: "Candidate has already reached a terminal stage",
//       });
//       return;
//     }

//     const targetStage = await prisma.pipelineStage.findUnique({
//       where: { id: stageId },
//       select: {
//         id: true,
//         code: true,
//         order: true,
//         isMandatory: true,
//         isTerminal: true,
//         label: true,
//       },
//     });

//     if (!targetStage) {
//       res
//         .status(404)
//         .json({ success: false, message: "Target stage not found" });
//       return;
//     }

//     if (targetStage.order <= pipeline.currentStage.order) {
//       res
//         .status(400)
//         .json({
//           success: false,
//           message: "Stage must move forward in sequence",
//         });
//       return;
//     }

//     const stages = await getStageSequence(pipeline.requirementId);
//     const currentIdx = stages.findIndex(
//       (s) => s.id === pipeline.currentStageId
//     );
//     const targetIdx = stages.findIndex((s) => s.id === stageId);

//     if (targetIdx === -1) {
//       res.status(400).json({
//         success: false,
//         message:
//           "Target stage is not valid for this requirement's service line",
//       });
//       return;
//     }

//     const skippedMandatory = stages
//       .slice(currentIdx + 1, targetIdx)
//       .filter((s) => s.isMandatory);

//     if (skippedMandatory.length > 0 && !skipReason) {
//       res.status(400).json({
//         success: false,
//         message: `Skipping mandatory stage(s): ${skippedMandatory
//           .map((s) => s.label)
//           .join(", ")}. Provide skipReason.`,
//         skippedStages: skippedMandatory.map((s) => ({
//           code: s.code,
//           label: s.label,
//         })),
//       });
//       return;
//     }

//     const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

//     await prisma.$transaction(async (tx) => {
//       await tx.requirementCandidatePipeline.update({
//         where: { id: pipelineId },
//         data: {
//           currentStageId: stageId,
//           stageUpdatedAt: new Date(),
//           stageUpdatedById: actorId,
//           isOnHold: false,
//           onHoldAt: null,
//           onHoldReason: null,
//         },
//       });

//       await tx.candidatePipelineStageLog.create({
//         data: {
//           pipelineId,
//           fromStageId: pipeline.currentStageId,
//           toStageId: stageId,
//           changedById: actorId,
//           wasSkipped: skippedMandatory.length > 0,
//           skipReason: skipReason ?? null,
//           timeInPrevStageMins,
//           note: note ?? null,
//         },
//       });

//       const interviewCodes = ["05", "06", "07A", "07B", "08"];
//       if (interviewCodes.includes(targetStage.code)) {
//         await tx.requirement.update({
//           where: { id: pipeline.requirementId },
//           data: { interviewsScheduled: { increment: 1 } },
//         });
//         await tx.requirementAssignment.updateMany({
//           where: {
//             requirementId: pipeline.requirementId,
//             assignedToId: pipeline.recruiterId,
//             status: "ACTIVE",
//           },
//           data: { interviewsCount: { increment: 1 } },
//         });
//       }

//       if (targetStage.isTerminal) {
//         await tx.requirement.update({
//           where: { id: pipeline.requirementId },
//           data: {
//             filledOpenings: { increment: 1 },
//             activeApplications: { decrement: 1 },
//           },
//         });
//       }
//     });

//     res.json({
//       success: true,
//       message: `Stage moved to ${targetStage.label}`,
//       data: {
//         pipelineId,
//         stageCode: targetStage.code,
//         stageLabel: targetStage.label,
//       },
//     });
//   } catch (err) {
//     console.error("updatePipelineStage:", err);
//     res.status(500).json({ success: false, message: "Failed to update stage" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:pipelineId/submit
// ─────────────────────────────────────────────────────────────────────────────

export const submitCandidate = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;
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
      res.status(400).json({
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

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

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

      await tx.requirementAssignment.updateMany({
        where: {
          requirementId: pipeline.requirementId,
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
// PATCH /:pipelineId/offer
// ─────────────────────────────────────────────────────────────────────────────

export const rollOffer = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;
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
      res.status(400).json({
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
        where: { id: pipeline.requirementId },
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
// PATCH /:pipelineId/offer/status
// ─────────────────────────────────────────────────────────────────────────────

export const updateOfferStatus = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;
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
      res
        .status(400)
        .json({ success: false, message: "Offer is not in PENDING state" });
      return;
    }

    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

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

        await tx.requirement.update({
          where: { id: pipeline.requirementId },
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
// PATCH /:pipelineId/reject
// ─────────────────────────────────────────────────────────────────────────────

export const rejectCandidate = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;
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
          toStageId: pipeline.currentStageId,
          changedById: actorId,
          timeInPrevStageMins,
          note: `Rejected: ${rejectionReason}`,
        },
      });

      await tx.requirement.update({
        where: { id: pipeline.requirementId },
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
// PATCH /:pipelineId/withdraw
// ─────────────────────────────────────────────────────────────────────────────

export const withdrawCandidate = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;
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
        where: { id: pipeline.requirementId },
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
// PATCH /:pipelineId/hold
// ─────────────────────────────────────────────────────────────────────────────

export const holdCandidate = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;
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
      res.status(400).json({
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
      data: { isOnHold: true, onHoldAt: new Date(), onHoldReason },
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
// GET /:pipelineId/timeline
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineTimeline = async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.pipelineId;
    const requirementId = req.params.id ?? undefined;

    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: {
        id: pipelineId,
        ...(requirementId ? { requirementId } : {}),
      },
      select: {
        id: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        rejectionReason: true,
        withdrawnReason: true,
        onHoldReason: true,
        submittedAt: true,
        submissionNote: true,
        offeredCtc: true,
        salaryCurrency: true,
        offerStatus: true,
        expectedJoiningDate: true,
        actualJoiningDate: true,
        createdAt: true,
        currentStage: { select: { code: true, label: true, order: true } },
        recruiter: { select: { id: true, firstName: true, lastName: true } },
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            client: { select: { id: true, name: true } },
          },
        },
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

// // controller/pipelineStage.controller.ts
// import { Request, Response } from "express";
// import prisma from "@/utils/prisma/client";

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

    // block delete if this is a seeded core stage (codes 01–10, 07A, 07B)
    const SEEDED_CODES = [
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07A",
      "07B",
      "08",
      "09",
      "10",
    ];
    if (SEEDED_CODES.includes(existing.code)) {
      res.status(403).json({
        success: false,
        message: `Stage "${existing.code}" is a core seeded stage and cannot be deleted. Use isActive = false to deactivate it instead.`,
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
