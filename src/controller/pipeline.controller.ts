// File: pipeline.controller.ts
// Path: src/controller/pipeline.controller.ts

import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { getRequirementScopeWhere } from "@/services/requirementService";
import {
  UpdateDispositionInput,
  UpdatePipelineDetailsInput,
} from "@/validators/requirement.validators";
import {
  NotificationReferenceType,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { getReportingLineIds } from "@/services/orgService";

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
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
      assignmentId: true,
      isRejected: true,
      isWithdrawn: true,
      isOnHold: true,
      stageUpdatedAt: true,
      currentStageId: true,
      currentStage: {
        select: {
          id: true,
          code: true,
          order: true,
          isTerminal: true,
          canonicalStage: true,
        },
      },
      offerStatus: true,
      // ── CTC ladder — needed by updatePipelineDetails
      currentCtc: true,
      expectedCtc: true,
      negotiatedCtc: true,
      ctcNotes: true,
      // ── Joining — needed by updatePipelineDetails
      expectedJoiningDate: true,
      lastWorkingDate: true,
      actualJoiningDate: true,
      monthOfJoining: true,
      remainingDaysToJoin: true,
    },
  });
}

function computeTimeInStage(stageUpdatedAt: Date): number {
  return Math.floor((Date.now() - stageUpdatedAt.getTime()) / 60_000);
}
async function syncDispositionAndClosure(
  tx: Prisma.TransactionClient,
  pipelineId: string,
) {
  const p = await tx.requirementCandidatePipeline.findUniqueOrThrow({
    where: { id: pipelineId },
    select: {
      id: true,
      requirementId: true,
      assignmentId: true,
      isRejected: true,
      isWithdrawn: true,
      isOnHold: true,
      disposition: true,
      currentStage: { select: { isTerminal: true } },
    },
  });

  // ── 1. Derive the correct disposition from ground-truth flags ──
  // Priority: dropped-out signals win over everything, terminal stage means
  // placed, hold is next, otherwise active. This mirrors the logic that
  // candidate.controller.ts already applies inline on each write — here it's
  // recomputed centrally so it can never drift regardless of which field
  // changed.
  let nextDisposition: "ACTIVE" | "PLACED" | "DROPPED" | "ON_HOLD";
  if (p.isRejected || p.isWithdrawn) nextDisposition = "DROPPED";
  else if (p.currentStage.isTerminal) nextDisposition = "PLACED";
  else if (p.isOnHold) nextDisposition = "ON_HOLD";
  else nextDisposition = "ACTIVE";

  if (nextDisposition !== p.disposition) {
    await tx.requirementCandidatePipeline.update({
      where: { id: pipelineId },
      data: { disposition: nextDisposition, dispositionAt: new Date() },
    });
  }

  // ── 2. Recompute filled count for the assignment (if any) — live count,
  //     not an incremented counter, so it self-corrects no matter which
  //     endpoint touched the row ──
  if (p.assignmentId) {
    const filled = await tx.requirementCandidatePipeline.count({
      where: { assignmentId: p.assignmentId, disposition: "PLACED" },
    });
    await tx.requirementAssignment.update({
      where: { id: p.assignmentId },
      data: { filledOpenings: filled },
    });
  }

  // ── 3. Recompute total filled for the requirement, open/close it ──
  const requirement = await tx.requirement.findUniqueOrThrow({
    where: { id: p.requirementId },
    select: { totalOpenings: true, status: true, closureReason: true },
  });

  // Never override a manual, non-FILLED closure (CANCELLED, CLIENT_WITHDREW,
  // BUDGET_HOLD, DUPLICATE) — those are human decisions, not derived state.
  const isAutoManaged =
    requirement.status !== "CLOSED" || requirement.closureReason === "FILLED";
  if (!isAutoManaged) return;

  const totalPlaced = await tx.requirementCandidatePipeline.count({
    where: { requirementId: p.requirementId, disposition: "PLACED" },
  });
  const shouldClose = totalPlaced >= requirement.totalOpenings;

  if (shouldClose && requirement.status !== "CLOSED") {
    await tx.requirement.update({
      where: { id: p.requirementId },
      data: {
        status: "CLOSED",
        closureReason: "FILLED",
        closedAt: new Date(),
      },
    });
  } else if (!shouldClose && requirement.status === "CLOSED") {
    await tx.requirement.update({
      where: { id: p.requirementId },
      data: { status: "ACTIVE", closureReason: null, closedAt: null },
    });
  }
}

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
  noticePeriod: true,
  // ── CTC ladder — surfaced in the assignment pipeline table
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  ctcNotes: true,
  // ── Joining — surfaced in the assignment pipeline table
  lastWorkingDate: true,
  monthOfJoining: true,
  remainingDaysToJoin: true,
  stageUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      canonicalStage: true,
    },
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
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const where: any = { requirement: { ...scopeWhere, deletedAt: null } };
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
      data: { total, rejected, withdrawn, onHold, byStage: stageBreakdown },
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
// GET /pipeline/:pipelineId/timeline
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineTimeline = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;

    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: { id: pipelineId },
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
      0,
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/candidates
// Ingest — called after resume parsed by Candidate Service
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

      // await tx.requirement.update({
      //   where: { id: requirementId },
      //   data: { activeApplications: { increment: 1 } },
      // });

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
// PATCH /pipeline/:pipelineId/stage
// Move candidate to a different stage — forward only, mandatory skip needs reason
// ─────────────────────────────────────────────────────────────────────────────

// Canonical stages that force an interview-scheduling step. Single source of truth.
const INTERVIEW_SCHEDULING_STAGES = [
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_RESCHEDULED",
] as const;
const requiresInterviewSchedule = (c: string | null | undefined) =>
  !!c && (INTERVIEW_SCHEDULING_STAGES as readonly string[]).includes(c);

export const moveCandidateStage = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { stageId, note, interview } = req.body; // ← interview destructured
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    // if (pipeline.isRejected || pipeline.isWithdrawn) {
    //   res.status(400).json({
    //     success: false,
    //     message: "Cannot move stage on a rejected or withdrawn candidate",
    //   });
    //   return;
    // }

    if (pipeline.currentStageId === stageId) {
      res.status(400).json({
        success: false,
        message: "Candidate is already at this stage",
      });
      return;
    }

    const targetStage = await prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        isTerminal: true,
        canonicalStage: true,
      },
    });

    if (!targetStage) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    // ── Interview scheduling gate ──
    const needsInterview = requiresInterviewSchedule(
      targetStage.canonicalStage,
    );
    const isReschedule = targetStage.canonicalStage === "INTERVIEW_RESCHEDULED";
    if (needsInterview) {
      if (!interview?.scheduledAt) {
        res.status(422).json({
          success: false,
          code: "INTERVIEW_REQUIRED",
          message: "Interview date & time are required to move to this stage",
        });
        return;
      }
      if (Number.isNaN(new Date(interview.scheduledAt).getTime())) {
        res
          .status(422)
          .json({ success: false, message: "Invalid interview date/time" });
        return;
      }
      if (!interview.mode) {
        res
          .status(422)
          .json({ success: false, message: "Interview mode is required" });
        return;
      }
    }

    const isMovingForward = targetStage.order > pipeline.currentStage.order;
    const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

    await prisma.$transaction(async (tx) => {
      // 1. Move the stage
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          currentStageId: stageId,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
          isOnHold: false,
          onHoldAt: null,
          onHoldReason: null,
        },
      });

      // 2. Write stage history log — always, forward or backward
      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: stageId,
          changedById: actorId,
          timeInPrevStageMins,
          note: note ?? null,
          fromCanonicalStage: pipeline.currentStage.canonicalStage ?? null,
          toCanonicalStage: targetStage.canonicalStage ?? null,
        },
      });

      // 3. Interview counter — moving forward into INTERVIEW canonical stage
      if (isMovingForward && targetStage.canonicalStage === "INTERVIEW") {
        await tx.requirementAssignment.updateMany({
          where: {
            requirementId: pipeline.requirementId,
            assignedToId: pipeline.recruiterId,
            status: "ACTIVE",
          },
          data: { interviewsCount: { increment: 1 } },
        });
      }

      // 4. Terminal boundary sync
      const crossesTerminalBoundary =
        targetStage.isTerminal || pipeline.currentStage.isTerminal;
      if (crossesTerminalBoundary) {
        await syncDispositionAndClosure(tx, pipelineId);
      }

      // 5. ── Interview schedule row + notify recruiter & lead ──
      if (needsInterview) {
        // roundNumber = next round for this pipeline
        const priorCount = await tx.candidateInterviewSchedule.count({
          where: { pipelineId },
        });

        await tx.candidateInterviewSchedule.create({
          data: {
            pipelineId,
            stageId,
            roundNumber: interview.roundNumber ?? priorCount + 1,
            scheduledAt: new Date(interview.scheduledAt),
            durationMins: interview.durationMins ?? null,
            mode: interview.mode, // required
            createdById: actorId,
          },
        });

        // recruiter + their team lead (falls back to just recruiter if no lead)
        const recruiter = await tx.user.findUnique({
          where: { id: pipeline.recruiterId },
          select: { teamLeadId: true, reportingToId: true },
        });
        const recipients = [
          ...new Set(
            [
              pipeline.recruiterId,
              recruiter?.teamLeadId,
              recruiter?.reportingToId,
            ].filter((v): v is string => !!v),
          ),
        ];

        // candidate name for the copy
        const snap = await tx.candidateSnapshot.findFirst({
          where: { pipeline: { id: pipelineId } },
          select: { fullName: true },
        });
        const name = snap?.fullName ?? "Candidate";

        const when = new Date(interview.scheduledAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        const verb = isReschedule ? "rescheduled" : "scheduled";

        await tx.notification.createMany({
          data: recipients.map((uid) => ({
            userId: uid,
            type: isReschedule
              ? NotificationType.INTERVIEW_RESCHEDULED
              : NotificationType.INTERVIEW_SCHEDULED,
            title: `Interview ${verb} — ${name}`,
            body: `${targetStage.label} on ${when} (${interview.mode})`,
            referenceId: pipelineId,
            referenceType: NotificationReferenceType.PIPELINE,
            isRead: false,
          })),
        });
      }
    }); // ← transaction closes HERE, after the interview block

    if (needsInterview) {
      const verb = isReschedule ? "rescheduled" : "scheduled";
      for (const uid of recipients) {
        io.to(`user:${uid}`).emit("notification:new", {
          type: isReschedule ? "INTERVIEW_RESCHEDULED" : "INTERVIEW_SCHEDULED",
          title: `Interview ${verb} — ${name}`,
          body: `${targetStage.label} on ${when} (${interview.mode})`,
          referenceId: pipelineId,
          referenceType: "PIPELINE",
          createdAt: new Date().toISOString(),
        });
      }
    }
    res.json({
      success: true,
      message: `Stage ${isMovingForward ? "moved to" : "rolled back to"} ${targetStage.label}`,
      data: {
        pipelineId,
        stageCode: targetStage.code,
        stageLabel: targetStage.label,
        direction: isMovingForward ? "forward" : "backward",
      },
    });
  } catch (err) {
    console.error("moveCandidateStage:", err);
    res.status(500).json({ success: false, message: "Failed to update stage" });
  }
};

// export const moveCandidateStage = async (req: Request, res: Response) => {
//   try {
//     const { pipelineId } = req.params;
//     const { stageId, note } = req.body;
//     const actorId = req.user!.id;

//     const pipeline = await findPipeline(pipelineId);
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

//     if (pipeline.currentStageId === stageId) {
//       res.status(400).json({
//         success: false,
//         message: "Candidate is already at this stage",
//       });
//       return;
//     }

//     const targetStage = await prisma.pipelineStage.findUnique({
//       where: { id: stageId },
//       select: {
//         id: true,
//         code: true,
//         label: true,
//         order: true,
//         isTerminal: true,
//         canonicalStage: true,
//       },
//     });

//     if (!targetStage) {
//       res.status(404).json({ success: false, message: "Stage not found" });
//       return;
//     }

//     const isMovingForward = targetStage.order > pipeline.currentStage.order;
//     const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

//     await prisma.$transaction(async (tx) => {
//       // 1. Move the stage
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

//       // 2. Write stage history log — always, forward or backward
//       await tx.candidatePipelineStageLog.create({
//         data: {
//           pipelineId,
//           fromStageId: pipeline.currentStageId,
//           toStageId: stageId,
//           changedById: actorId,
//           timeInPrevStageMins: timeInPrevStageMins,
//           note: note ?? null,
//           // canonicalStage fields from schema
//           fromCanonicalStage: pipeline.currentStage.canonicalStage ?? null,
//           toCanonicalStage: targetStage.canonicalStage ?? null,
//         },
//       });

//       // 3. If moving forward to INTERVIEW canonical stage
//       //    → increment interviewsCount on the recruiter's assignment
//       //    (interviewsCount lives on RequirementAssignment, not Requirement)
//       if (isMovingForward && targetStage.canonicalStage === "INTERVIEW") {
//         await tx.requirementAssignment.updateMany({
//           where: {
//             requirementId: pipeline.requirementId,
//             assignedToId: pipeline.recruiterId,
//             status: "ACTIVE",
//           },
//           data: { interviewsCount: { increment: 1 } },
//         });
//       }

//       // 4. If moving forward to terminal stage
//       //    → increment filledOpenings on the assignment only
//       // if (isMovingForward && targetStage.isTerminal && pipeline.assignmentId) {
//       //   await tx.requirementAssignment.update({
//       //     where: { id: pipeline.assignmentId },
//       //     data: { filledOpenings: { increment: 1 } },
//       //   });
//       // }

//       // 5. If moving BACKWARD from terminal stage
//       //    → undo filledOpenings on the assignment
//       //   if (
//       //     !isMovingForward &&
//       //     pipeline.currentStage.isTerminal &&
//       //     pipeline.assignmentId
//       //   ) {
//       //     await tx.requirementAssignment.update({
//       //       where: { id: pipeline.assignmentId },
//       //       data: { filledOpenings: { decrement: 1 } },
//       //     });
//       //   }
//       // });

//       const crossesTerminalBoundary =
//         targetStage.isTerminal || pipeline.currentStage.isTerminal;

//       if (crossesTerminalBoundary) {
//         await syncDispositionAndClosure(tx, pipelineId);
//       }
//     });

//     res.json({
//       success: true,
//       message: `Stage ${isMovingForward ? "moved to" : "rolled back to"} ${
//         targetStage.label
//       }`,
//       data: {
//         pipelineId,
//         stageCode: targetStage.code,
//         stageLabel: targetStage.label,
//         direction: isMovingForward ? "forward" : "backward",
//       },
//     });
//   } catch (err) {
//     console.error("moveCandidateStage:", err);
//     res.status(500).json({ success: false, message: "Failed to update stage" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline/:pipelineId/submit
// ─────────────────────────────────────────────────────────────────────────────

export const submitCandidate = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { submissionNote } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
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

// ── who can this user assign work to? null = no restriction (super admin) ────
async function getAssignableRecruiterIds(
  userId: string,
  isSuperAdmin: boolean,
): Promise<Set<string> | null> {
  if (isSuperAdmin) return null;

  const [lineIds, extra] = await Promise.all([
    getReportingLineIds(userId), // full subtree under me
    prisma.userAssignableTo.findMany({
      where: { userId },
      select: { targetId: true },
    }),
  ]);

  return new Set<string>([userId, ...lineIds, ...extra.map((e) => e.targetId)]);
}

async function resolveTarget(
  requirementId: string,
  recruiterId: string,
  assignerId: string,
  isSuperAdmin: boolean,
) {
  const recruiter = await prisma.user.findFirst({
    where: { id: recruiterId, isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!recruiter) {
    return { error: { code: 404, message: "Recruiter not found or inactive" } };
  }

  const assignable = await getAssignableRecruiterIds(assignerId, isSuperAdmin);
  if (assignable && !assignable.has(recruiterId)) {
    return {
      error: {
        code: 403,
        message: "You can only assign to recruiters under you",
      },
    };
  }

  // Link the recruiter's ACTIVE requirement assignment if they have one.
  const assignment = await prisma.requirementAssignment.findFirst({
    where: { requirementId, assignedToId: recruiterId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { assignedAt: "desc" },
  });

  return { recruiter, assignmentId: assignment?.id ?? null };
}

export const assignApplicantRecruiter = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const { recruiterId } = req.body as { recruiterId?: string };
    const actorId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    if (!recruiterId) {
      return res
        .status(400)
        .json({ success: false, message: "recruiterId is required" });
    }

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, reqCode: true, title: true },
    });
    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: { id: pipelineId, requirementId },
      select: {
        id: true,
        recruiterId: true,
        snapshot: { select: { fullName: true } },
      },
    });
    if (!pipeline) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found on this requirement",
      });
    }

    const resolved = await resolveTarget(
      requirementId,
      recruiterId,
      actorId,
      isSuperAdmin,
    );
    if ("error" in resolved) {
      return res
        .status(resolved.error.code)
        .json({ success: false, message: resolved.error.message });
    }

    const previousRecruiterId = pipeline.recruiterId;

    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: pipelineId },
      data: {
        recruiterId,
        assignmentId: resolved.assignmentId, // null if recruiter has no active assignment
      },
      select: {
        id: true,
        recruiterId: true,
        assignmentId: true,
        recruiter: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // ── best-effort activity + notification ──
    try {
      await prisma.requirementActivity.create({
        data: {
          requirementId,
          actorId,
          type: "RECRUITER_ASSIGNED",
          summary: `Assigned ${pipeline.snapshot?.fullName ?? "applicant"} to ${resolved.recruiter.firstName} ${resolved.recruiter.lastName}`,
          meta: { pipelineId, recruiterId, previousRecruiterId },
        },
      });
      if (previousRecruiterId !== recruiterId) {
        await prisma.notification.create({
          data: {
            userId: recruiterId,
            type: "REQUIREMENT_ASSIGNED",
            title: `New applicant assigned`,
            body: `${pipeline.snapshot?.fullName ?? "An applicant"} on ${requirement.reqCode} was assigned to you.`,
            referenceId: pipelineId,
            referenceType: "PIPELINE",
          },
        });
      }
    } catch (e) {
      console.warn("assign: activity/notification failed (non-fatal)", e);
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("assignApplicantRecruiter:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to assign recruiter" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline/:pipelineId/offer
// ─────────────────────────────────────────────────────────────────────────────

// pipeline.controller.ts — rollOffer replacement
export const rollOffer = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const {
      offeredCtc,
      salaryCurrency,
      salaryType,
      expectedJoiningDate,
      // CTC ladder — added
      currentCtc,
      expectedCtc,
      negotiatedCtc,
      ctcNotes,
    } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
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

    // Build the update payload — CTC ladder fields always, offer fields only if offeredCtc provided
    const data: Record<string, any> = {};

    // ── CTC ladder (no stage move, no side effects)
    if (currentCtc !== undefined) data.currentCtc = currentCtc;
    if (expectedCtc !== undefined) data.expectedCtc = expectedCtc;
    if (negotiatedCtc !== undefined) data.negotiatedCtc = negotiatedCtc;
    if (ctcNotes !== undefined) data.ctcNotes = ctcNotes;

    if (Object.keys(data).length === 0 && !offeredCtc) {
      res.status(400).json({ success: false, message: "No fields provided" });
      return;
    }

    // ── Formal offer — only when offeredCtc is explicitly provided
    if (offeredCtc != null) {
      const offerStage = await prisma.pipelineStage.findFirst({
        where: { code: "09", isActive: true },
        select: { id: true, label: true, canonicalStage: true },
      });
      if (!offerStage) {
        res
          .status(500)
          .json({ success: false, message: "Stage 09 not configured" });
        return;
      }

      const timeInPrevStageMins = computeTimeInStage(pipeline.stageUpdatedAt);

      data.offeredCtc = offeredCtc;
      data.salaryCurrency = salaryCurrency ?? "INR";
      data.salaryType = salaryType;
      data.offeredAt = new Date();
      data.offeredById = actorId;
      data.offerStatus = "PENDING";
      data.currentStageId = offerStage.id;
      data.stageUpdatedAt = new Date();
      data.stageUpdatedById = actorId;
      if (expectedJoiningDate)
        data.expectedJoiningDate = new Date(expectedJoiningDate);

      await prisma.$transaction(async (tx) => {
        await tx.requirementCandidatePipeline.update({
          where: { id: pipelineId },
          data,
        });
        await tx.candidatePipelineStageLog.create({
          data: {
            pipelineId,
            fromStageId: pipeline.currentStageId,
            toStageId: offerStage.id,
            changedById: actorId,
            timeInPrevStageMins,
            fromCanonicalStage: pipeline.currentStage.canonicalStage ?? null,
            toCanonicalStage: offerStage.canonicalStage ?? null,
            note: `Offer rolled: ${offeredCtc} ${salaryCurrency ?? "INR"}`,
          },
        });
      });

      res.json({
        success: true,
        message: "Offer rolled out and CTC details saved",
      });
      return;
    }

    // ── CTC ladder only — no stage move
    await prisma.requirementCandidatePipeline.update({
      where: { id: pipelineId },
      data,
    });
    res.json({ success: true, message: "CTC details updated" });
  } catch (err) {
    console.error("rollOffer:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update offer details" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline/:pipelineId/offer/status
// ─────────────────────────────────────────────────────────────────────────────

export const updateOfferStatus = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { offerStatus, actualJoiningDate, declineReason, revocationReason } =
      req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
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
        // await tx.requirement.update({
        //   where: { id: pipeline.requirementId },
        //   data: {
        //     filledOpenings: { increment: 1 },
        //     activeApplications: { decrement: 1 },
        //   },
        // });
        await syncDispositionAndClosure(tx, pipelineId);
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
// PATCH /pipeline/:pipelineId/reject
// ─────────────────────────────────────────────────────────────────────────────

export const rejectCandidate = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { rejectionReason } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
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
      // await tx.requirement.update({
      //   where: { id: pipeline.requirementId },
      //   data: { activeApplications: { decrement: 1 } },
      // });
      await syncDispositionAndClosure(tx, pipelineId);
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
// PATCH /pipeline/:pipelineId/withdraw
// ─────────────────────────────────────────────────────────────────────────────

export const withdrawCandidate = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { withdrawnReason } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
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
        data: { isWithdrawn: true, withdrawnAt: new Date(), withdrawnReason },
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
      // await tx.requirement.update({
      //   where: { id: pipeline.requirementId },
      //   data: { activeApplications: { decrement: 1 } },
      // });
      await syncDispositionAndClosure(tx, pipelineId);
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
// PATCH /pipeline/:pipelineId/hold
// ─────────────────────────────────────────────────────────────────────────────

export const holdCandidate = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { onHoldReason } = req.body;
    const actorId = req.user!.id;

    const pipeline = await findPipeline(pipelineId);
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
    await prisma.$transaction(async (tx) => {
      // await prisma.requirementCandidatePipeline.update({
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: { isOnHold: true, onHoldAt: new Date(), onHoldReason },
      });
      await syncDispositionAndClosure(tx, pipelineId);
    });

    res.json({ success: true, message: "Candidate placed on hold" });
  } catch (err) {
    console.error("holdCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to hold candidate" });
  }
};

// File: transferPipelineCandidate.ts
// Path: src/controllers/pipeline/transferPipelineCandidate.ts

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline/:pipelineId/transfer
//
// Transfers ownership of a pipeline row to a different recruiter.
// Target recruiter MUST have an active assignment for the SAME requirement.
//
// Body:
//   targetUserId  string   — who to hand the candidate to
//   note?         string   — optional handover context
//
// What changes:
//   recruiterId       → targetUserId
//   assignmentId      → target recruiter's active assignment for this requirement
//   stageUpdatedById  → caller (last-touched audit)
//
// What does NOT change:
//   currentStageId    — stage preserved as-is
//   snapshot          — frozen, never mutated
//
// Side effects (all inside $transaction):
//   CandidatePipelineStageLog  — transfer note (fromStage = toStage, no TAT)
//   RequirementActivity        — RECRUITER_ASSIGNED event on the requirement
// ─────────────────────────────────────────────────────────────────────────────

export const transferPipelineCandidate = async (
  req: Request,
  res: Response,
) => {
  try {
    const { pipelineId } = req.params;
    const caller = req.user!;
    const { targetUserId, note } = req.body as {
      targetUserId: string;
      note?: string;
    };

    if (!targetUserId?.trim()) {
      res
        .status(400)
        .json({ success: false, message: "targetUserId is required" });
      return;
    }

    // ── Load pipeline row ──────────────────────────────────────────────────
    const pipeline = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: pipelineId },
      select: {
        id: true,
        recruiterId: true,
        requirementId: true,
        currentStageId: true,
        snapshotId: true,
        assignmentId: true,
      },
    });

    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    if (pipeline.recruiterId === targetUserId) {
      res.status(400).json({
        success: false,
        message: "Candidate is already assigned to this recruiter",
      });
      return;
    }

    // ── Load snapshot ──────────────────────────────────────────────────────
    const snapshot = await prisma.candidateSnapshot.findUnique({
      where: { id: pipeline.snapshotId },
      select: { fullName: true, email: true },
    });

    const candidateName = snapshot?.fullName ?? "Candidate";
    const candidateEmail = snapshot?.email ?? "";

    // ── Validate target user ───────────────────────────────────────────────
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        role: { select: { id: true, name: true, canonical: true } },
      },
    });

    if (!targetUser) {
      res.status(404).json({
        success: false,
        message: "Target recruiter not found or inactive",
      });
      return;
    }

    // ── Resolve names early — needed for both the error and the log ────────
    const fromUser = await prisma.user.findUnique({
      where: { id: pipeline.recruiterId },
      select: { firstName: true, lastName: true },
    });

    const fromName = fromUser
      ? `${fromUser.firstName.trim()} ${fromUser.lastName.trim()}`
      : "previous recruiter";
    const toName = `${targetUser.firstName.trim()} ${targetUser.lastName.trim()}`;

    // ── Find target recruiter's active assignment for THIS requirement ──────
    // orderBy: assignedAt desc — always picks the most recent if somehow
    // multiple active assignments exist for same req + user
    const targetAssignment = await prisma.requirementAssignment.findFirst({
      where: {
        requirementId: pipeline.requirementId, // ← SAME requirement only
        assignedToId: targetUserId,
        status: "ACTIVE",
      },
      orderBy: { assignedAt: "desc" }, // ← deterministic pick
      select: { id: true },
    });

    if (!targetAssignment) {
      res.status(400).json({
        success: false,
        message: `${toName} does not have an active assignment for this requirement. Assign them first, then transfer.`,
      });
      return;
    }

    const newAssignmentId = targetAssignment.id;

    // ── Build log note ─────────────────────────────────────────────────────
    const logNote = note?.trim()
      ? `Transferred from ${fromName} to ${toName}. ${note.trim()}`
      : `Transferred from ${fromName} to ${toName}`;

    // ── Transaction ────────────────────────────────────────────────────────
    await prisma.$transaction(async (tx) => {
      // 1. Move the pipeline row into the target's assignment bucket
      await tx.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          recruiterId: targetUserId,
          assignmentId: newAssignmentId,
          isTransferred: true,
          stageUpdatedById: caller.id,
          updatedAt: new Date(),
        },
      });

      // 2. Stage log — fromStage = toStage (ownership change, not a stage move)
      await tx.candidatePipelineStageLog.create({
        data: {
          pipelineId,
          fromStageId: pipeline.currentStageId,
          toStageId: pipeline.currentStageId,
          changedById: caller.id,
          wasSkipped: false,
          note: logNote,
          timeInPrevStageMins: null,
        },
      });

      // 3. Requirement activity feed
      await tx.requirementActivity.create({
        data: {
          requirementId: pipeline.requirementId,
          actorId: caller.id,
          type: "RECRUITER_ASSIGNED",
          summary: `${candidateName} transferred from ${fromName} to ${toName}`,
          meta: {
            pipelineId,
            fromRecruiterId: pipeline.recruiterId,
            fromRecruiterName: fromName,
            fromAssignmentId: pipeline.assignmentId,
            toRecruiterId: targetUserId,
            toRecruiterName: toName,
            toAssignmentId: newAssignmentId,
            candidateName,
            candidateEmail,
          },
        },
      });
    });

    res.json({
      success: true,
      message: `${candidateName} transferred to ${toName}`,
      data: {
        pipelineId,
        transferredTo: {
          id: targetUser.id,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          employeeId: targetUser.employeeId,
          role: targetUser.role,
          assignmentId: newAssignmentId,
        },
      },
    });
  } catch (err) {
    console.error("transferPipelineCandidate:", err);
    res.status(500).json({ success: false, message: "Transfer failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /pipeline/:pipelineId/details
// CTC ladder + joining fields that have no dedicated action endpoint.
// Backs the "Update Candidate Details" dialog on the assignment pipeline UI.
// Does NOT touch disposition, stage, or assignment counters — those stay on
// /disposition, /stage, /offer, etc.
// ─────────────────────────────────────────────────────────────────────────────

export const updatePipelineDetails = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const {
      currentCtc,
      expectedCtc,
      negotiatedCtc,
      ctcNotes,
      lastWorkingDate,
      actualJoiningDate,
      noticePeriod,
    } = req.body as UpdatePipelineDetailsInput;

    const pipeline = await findPipeline(pipelineId);
    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    const data: Record<string, any> = {};

    if (currentCtc !== undefined) data.currentCtc = currentCtc;
    if (expectedCtc !== undefined) data.expectedCtc = expectedCtc;
    if (negotiatedCtc !== undefined) data.negotiatedCtc = negotiatedCtc;
    if (ctcNotes !== undefined) data.ctcNotes = ctcNotes;
    if (lastWorkingDate !== undefined) {
      data.lastWorkingDate = lastWorkingDate ? new Date(lastWorkingDate) : null;
    }

    if (noticePeriod !== undefined) {
      data.noticePeriod = noticePeriod;
    }

    // actualJoiningDate drives the two derived fields. Recomputed here since
    // the schema comment says "computed on write" — no cron involved.
    // Disposition / assignment fill counts are intentionally left untouched —
    // use PATCH /:pipelineId/disposition with PLACED for that.
    if (actualJoiningDate !== undefined) {
      if (actualJoiningDate) {
        const joined = new Date(actualJoiningDate);
        data.actualJoiningDate = joined;
        data.monthOfJoining = joined.toLocaleString("en-IN", {
          month: "long",
          year: "numeric",
        });
        data.remainingDaysToJoin = 0;
      } else {
        // clearing the actual join date — fall back to recomputing the
        // countdown against expectedJoiningDate if one exists
        data.actualJoiningDate = null;
        data.monthOfJoining = null;
        data.remainingDaysToJoin = pipeline.expectedJoiningDate
          ? Math.floor(
              (pipeline.expectedJoiningDate.getTime() - Date.now()) /
                86_400_000,
            )
          : null;
      }
    }

    if (Object.keys(data).length === 0) {
      res
        .status(400)
        .json({ success: false, message: "No fields provided to update" });
      return;
    }

    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: pipelineId },
      data,
      select: {
        id: true,
        currentCtc: true,
        expectedCtc: true,
        negotiatedCtc: true,
        ctcNotes: true,
        lastWorkingDate: true,
        actualJoiningDate: true,
        monthOfJoining: true,
        remainingDaysToJoin: true,

        noticePeriod: true,
      },
    });

    res.json({
      success: true,
      message: "Candidate details updated",
      data: updated,
    });
  } catch (err) {
    console.error("updatePipelineDetails:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update candidate details" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE STAGE ADMIN CRUD
// Separate concern — managing stage definitions, not candidate transitions
// ─────────────────────────────────────────────────────────────────────────────

// GET /pipeline-stages
export const getPipelineStages = async (req: Request, res: Response) => {
  try {
    const { serviceLineId, includeInactive } = req.query as Record<
      string,
      string
    >;
    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (serviceLineId) where.OR = [{ serviceLineId: null }, { serviceLineId }];

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

// POST /pipeline-stages
export const createPipelineStage = async (req: Request, res: Response) => {
  try {
    const { code, label, order, serviceLineId, isMandatory, isTerminal } =
      req.body;

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

    res
      .status(201)
      .json({ success: true, message: "Pipeline stage created", data: stage });
  } catch (err) {
    console.error("createPipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create pipeline stage" });
  }
};

// PATCH /pipeline-stages/:stageId
export const updatePipelineStage = async (req: Request, res: Response) => {
  try {
    const { stageId } = req.params; // ← uses stageId not id — no collision with pipelineId
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
      where: { id: stageId },
      select: { id: true, code: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    if (code && code.trim().toUpperCase() !== existing.code) {
      const codeTaken = await prisma.pipelineStage.findFirst({
        where: { code: code.trim().toUpperCase(), id: { not: stageId } },
        select: { id: true },
      });
      if (codeTaken) {
        res.status(409).json({
          success: false,
          message: `Stage code "${code.toUpperCase()}" is already used`,
        });
        return;
      }
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

    const activePipelineCount = await prisma.requirementCandidatePipeline.count(
      { where: { currentStageId: stageId } },
    );

    const updated = await prisma.pipelineStage.update({
      where: { id: stageId },
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

// DELETE /pipeline-stages/:stageId
export const deletePipelineStage = async (req: Request, res: Response) => {
  try {
    const { stageId } = req.params;

    const existing = await prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: { id: true, code: true, label: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }

    const activePipelineCount = await prisma.requirementCandidatePipeline.count(
      { where: { currentStageId: stageId } },
    );
    if (activePipelineCount > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete stage "${existing.label}" — ${activePipelineCount} active pipeline(s) are at this stage`,
      });
      return;
    }

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
        message: `Stage "${existing.code}" is a core seeded stage and cannot be deleted. Use isActive = false instead.`,
      });
      return;
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } });
    res.json({ success: true, message: `Stage "${existing.label}" deleted` });
  } catch (err) {
    console.error("deletePipelineStage:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete pipeline stage" });
  }
};

export const updateDisposition = async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.params as { pipelineId: string };
    const { disposition, dropReason, dropNote, holdNote, actualJoiningDate } =
      req.body as UpdateDispositionInput;
    const actorId = req.user!.id;

    const pipeline = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: pipelineId },
      select: {
        id: true,
        requirementId: true,
        assignmentId: true,
        disposition: true,
      },
    });

    if (!pipeline) {
      res
        .status(404)
        .json({ success: false, message: "Pipeline entry not found" });
      return;
    }

    // already terminal — can't move out of PLACED or DROPPED
    if (pipeline.disposition === "PLACED") {
      res
        .status(400)
        .json({ success: false, message: "Candidate is already placed" });
      return;
    }
    if (pipeline.disposition === "DROPPED") {
      res
        .status(400)
        .json({ success: false, message: "Candidate is already dropped" });
      return;
    }

    // ── PLACED
    if (disposition === "PLACED") {
      await prisma.$transaction(async (tx) => {
        // 1. mark placed
        await tx.requirementCandidatePipeline.update({
          where: { id: pipelineId },
          data: {
            disposition: "PLACED",
            dispositionAt: new Date(),
            actualJoiningDate: actualJoiningDate
              ? new Date(actualJoiningDate)
              : null,
          },
        });

        // 2. bump assignment filledOpenings
        if (pipeline.assignmentId) {
          await tx.requirementAssignment.update({
            where: { id: pipeline.assignmentId },
            data: { filledOpenings: { increment: 1 } },
          });
        }

        // 3. count total PLACED for requirement
        const placedCount = await tx.requirementCandidatePipeline.count({
          where: {
            requirementId: pipeline.requirementId,
            disposition: "PLACED",
          },
        });

        const requirement = await tx.requirement.findUnique({
          where: { id: pipeline.requirementId },
          select: { totalOpenings: true, status: true },
        });

        // 4. auto-close if fully filled
        if (
          requirement &&
          requirement.status !== "CLOSED" &&
          placedCount >= requirement.totalOpenings
        ) {
          await tx.requirement.update({
            where: { id: pipeline.requirementId },
            data: {
              status: "CLOSED",
              closureReason: "FILLED",
              closedAt: new Date(),
              closedById: actorId,
            },
          });

          await tx.requirementAssignment.updateMany({
            where: {
              requirementId: pipeline.requirementId,
              status: "ACTIVE",
            },
            data: { status: "FILLED" },
          });
        }
      });

      res.json({ success: true, message: "Candidate placed" });
      return;
    }

    // ── DROPPED
    if (disposition === "DROPPED") {
      await prisma.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          disposition: "DROPPED",
          dispositionAt: new Date(),
          dropReason,
          dropNote: dropNote ?? null,
        },
      });

      res.json({ success: true, message: "Candidate dropped" });
      return;
    }

    // ── ON_HOLD
    if (disposition === "ON_HOLD") {
      await prisma.requirementCandidatePipeline.update({
        where: { id: pipelineId },
        data: {
          disposition: "ON_HOLD",
          dispositionAt: new Date(),
          dropNote: holdNote ?? null,
        },
      });

      res.json({ success: true, message: "Candidate on hold" });
      return;
    }
  } catch (err) {
    console.error("updateDisposition:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update disposition" });
  }
};
