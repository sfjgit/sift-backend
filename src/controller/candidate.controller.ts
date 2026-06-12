// File: candidate.controller.ts
// Path: src/controller/candidate.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import type {
  AddCandidateInput,
  MoveStageInput,
  SubmitCandidateInput,
  RecordOfferInput,
  UpdateOfferStatusInput,
  RejectCandidateInput,
  WithdrawCandidateInput,
  HoldCandidateInput,
  SetDispositionInput,
} from "@/validators/candidate.validator";

// File: candidate.controller.ts (addition)
// Path: src/controller/candidate.controller.ts

// ─────────────────────────────────────────────────────────────────────────────
// GET /candidates/meta
// Returns dynamic metadata for the candidates module:
//   - canonicalStages: distinct canonical stage keys that have at least one
//     active PipelineStage mapped to them, with aggregated display info
//   - pipelineStages: all active PipelineStage rows (flat list, ordered)
// Frontend must NEVER hardcode canonical stage keys — always pull from here.
// ─────────────────────────────────────────────────────────────────────────────

// File: candidate.controller.ts
// Path: src/controller/candidate.controller.ts

// File: candidate.controller.ts (addition)
// Path: src/controller/candidate.controller.ts

import { CanonicalStage } from "@prisma/client";

// GET /candidates/canonical-stages
// Reads directly from Prisma's generated enum — zero DB query.
export const getCanonicalStages = async (_req: Request, res: Response) => {
  try {
    const values = Object.values(CanonicalStage);
    res.json({ success: true, data: values });
  } catch (err) {
    console.error("getCanonicalStages:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch canonical stages" });
  }
};

export const getCandidateMeta = async (req: Request, res: Response) => {
  try {
    const pipelineStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        canonicalStage: true,
        isMandatory: true,
        isTerminal: true,
        serviceLineId: true,
      },
      orderBy: { order: "asc" },
    });

    // Group pipeline stage IDs by their canonicalStage key
    type CanonicalEntry = { key: string; pipelineStageIds: string[] };
    const canonicalMap = new Map<string, CanonicalEntry>();

    for (const stage of pipelineStages) {
      if (!stage.canonicalStage) continue;
      if (!canonicalMap.has(stage.canonicalStage)) {
        canonicalMap.set(stage.canonicalStage, {
          key: stage.canonicalStage,
          pipelineStageIds: [],
        });
      }
      canonicalMap.get(stage.canonicalStage)!.pipelineStageIds.push(stage.id);
    }

    const { requirementId } = req.query as { requirementId?: string };

    const canonicalStages = await Promise.all(
      Array.from(canonicalMap.values()).map(async (entry) => {
        if (!requirementId) return entry;

        const count = await prisma.requirementCandidatePipeline.count({
          where: {
            requirementId,
            currentStageId: { in: entry.pipelineStageIds },
          },
        });

        return { ...entry, count };
      })
    );

    res.json({
      success: true,
      data: { canonicalStages, pipelineStages },
    });
  } catch (err) {
    console.error("getCandidateMeta:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate meta" });
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// SELECTS
// ─────────────────────────────────────────────────────────────────────────────

// Used for list — lean, no stageHistory, no rawSnapshot
const CANDIDATE_LIST_SELECT = {
  id: true,
  disposition: true,
  dropReason: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offeredAt: true,
  offerStatus: true,
  offeredCtc: true,
  salaryCurrency: true,
  actualJoiningDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      canonicalStage: true,
    },
  },
  recruiter: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: { select: { id: true, name: true } },
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
  assignment: {
    select: {
      id: true,
      depth: true,
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: { select: { id: true, name: true } },
        },
      },
    },
  },
  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      status: true,
    },
  },
} as const;

// Used for single detail — full history + raw snapshot
const CANDIDATE_DETAIL_SELECT = {
  id: true,
  disposition: true,
  dropReason: true,
  dropNote: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  submissionNote: true,
  offeredAt: true,
  offerStatus: true,
  offeredCtc: true,
  salaryCurrency: true,
  salaryType: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  rejectedAt: true,
  rejectionReason: true,
  withdrawnAt: true,
  withdrawnReason: true,
  onHoldAt: true,
  onHoldReason: true,
  dispositionAt: true,
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
  recruiter: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: { select: { id: true, name: true } },
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
      rawSnapshot: true,
      snapshotAt: true,
    },
  },
  assignment: {
    select: {
      id: true,
      depth: true,
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: { select: { id: true, name: true } },
        },
      },
    },
  },
  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      status: true,
      totalOpenings: true,
      serviceLine: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  },
  stageHistory: {
    select: {
      id: true,
      fromStageId: true,
      toStageId: true,
      fromCanonicalStage: true,
      toCanonicalStage: true,
      timeInPrevStageMins: true,
      wasSkipped: true,
      skipReason: true,
      note: true,
      createdAt: true,
      changedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
      fromStage: {
        select: { id: true, label: true, code: true, order: true },
      },
      toStage: {
        select: { id: true, label: true, code: true, order: true },
      },
    },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function computeAging(stageUpdatedAt: Date | string | null) {
  if (!stageUpdatedAt) return { minutes: 0, label: "—" };
  const mins = Math.floor(
    (Date.now() - new Date(stageUpdatedAt).getTime()) / 60000
  );
  if (mins < 60) return { minutes: mins, label: `${mins}m` };
  const h = Math.floor(mins / 60);
  if (h < 24) return { minutes: mins, label: `${h}h` };
  const d = Math.floor(h / 24);
  if (d < 30) return { minutes: mins, label: `${d}d` };
  return { minutes: mins, label: `${Math.floor(d / 30)}mo` };
}

// Shapes any pipeline row — adds convenience fields for the frontend
function shapeCandidate(p: any) {
  return {
    ...p,
    currentCanonicalStage: p.currentStage?.canonicalStage ?? null,
    aging: computeAging(p.stageUpdatedAt),
  };
}

// Resolves stage IDs for a canonicalStage filter
async function resolveCanonicalStageIds(
  canonicalStage: string
): Promise<string[]> {
  const stages = await prisma.pipelineStage.findMany({
    where: { canonicalStage: canonicalStage as any, isActive: true },
    select: { id: true },
  });
  return stages.map((s) => s.id);
}

// Computes timeInPrevStageMins from stageUpdatedAt — call before overwriting it
function calcTimeInStage(stageUpdatedAt: Date | string | null): number | null {
  if (!stageUpdatedAt) return null;
  return Math.floor((Date.now() - new Date(stageUpdatedAt).getTime()) / 60000);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /candidates
// List pipeline rows — filterable by requirementId, assignmentId, stageId,
// canonicalStage, disposition, recruiterId, search
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidates = async (req: Request, res: Response) => {
  try {
    const {
      requirementId,
      assignmentId,
      stageId,
      canonicalStage,
      disposition,
      recruiterId,
      search,
      page = "1",
      limit = "25",
      sortBy = "stageUpdatedAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const where: any = {};

    if (requirementId) where.requirementId = requirementId;
    if (assignmentId) where.assignmentId = assignmentId;
    if (disposition) where.disposition = disposition;
    if (recruiterId) where.recruiterId = recruiterId;

    // stageId direct filter
    if (stageId) {
      where.currentStageId = stageId;
    }

    // canonicalStage → resolve to matching pipeline stage IDs
    if (canonicalStage && !stageId) {
      const ids = await resolveCanonicalStageIds(canonicalStage);
      if (ids.length === 0) {
        // No stages mapped to this canonical — return empty immediately
        res.json({
          success: true,
          data: [],
          meta: { total: 0, page: parseInt(page), limit: take, pages: 0 },
        });
        return;
      }
      where.currentStageId = { in: ids };
    }

    // Search across snapshot fields
    if (search?.trim()) {
      where.snapshot = {
        OR: [
          { fullName: { contains: search.trim(), mode: "insensitive" } },
          { email: { contains: search.trim(), mode: "insensitive" } },
          { phone: { contains: search.trim(), mode: "insensitive" } },
          { currentTitle: { contains: search.trim(), mode: "insensitive" } },
          { currentCompany: { contains: search.trim(), mode: "insensitive" } },
        ],
      };
    }

    const SORTABLE = [
      "stageUpdatedAt",
      "createdAt",
      "submittedAt",
      "offeredAt",
    ];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { stageUpdatedAt: "desc" as const };

    const [total, rows] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: CANDIDATE_LIST_SELECT,
        orderBy,
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: rows.map(shapeCandidate),
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getCandidates:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /candidates
// Atomically:
//   1. Validate requirement is workable
//   2. Upsert CandidateSnapshot (idempotent — safe to retry)
//   3. Create RequirementCandidatePipeline row
//   4. Write initial CandidatePipelineStageLog entry
// ─────────────────────────────────────────────────────────────────────────────

export const addCandidate = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const body = req.body as AddCandidateInput;

    // ── Validate requirement ────────────────────────────────────────────────
    const requirement = await prisma.requirement.findFirst({
      where: { id: body.requirementId, deletedAt: null },
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
        message: `Cannot add candidates to a requirement with status: ${requirement.status}`,
      });
      return;
    }

    // ── Duplicate check — same candidate already in this requirement ────────
    const existing = await prisma.candidateSnapshot.findUnique({
      where: {
        candidateServiceId_requirementId: {
          candidateServiceId: body.candidateServiceId,
          requirementId: body.requirementId,
        },
      },
      select: { id: true, pipeline: { select: { id: true } } },
    });
    if (existing?.pipeline) {
      res.status(409).json({
        success: false,
        message:
          "This candidate is already in the pipeline for this requirement",
        data: { candidateId: existing.pipeline.id },
      });
      return;
    }

    // ── Validate assignment if provided ────────────────────────────────────
    if (body.assignmentId) {
      const assignment = await prisma.requirementAssignment.findFirst({
        where: {
          id: body.assignmentId,
          requirementId: body.requirementId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!assignment) {
        res.status(400).json({
          success: false,
          message: "Assignment not found or not active for this requirement",
        });
        return;
      }
    }

    // ── Resolve initial stage ───────────────────────────────────────────────
    let initialStageId = body.initialStageId ?? null;
    if (!initialStageId) {
      const firstStage = await prisma.pipelineStage.findFirst({
        where: {
          isActive: true,
          OR: [
            { serviceLineId: null },
            ...(requirement.serviceLineId
              ? [{ serviceLineId: requirement.serviceLineId }]
              : []),
          ],
        },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      if (!firstStage) {
        res.status(500).json({
          success: false,
          message: "No active pipeline stages configured — contact admin",
        });
        return;
      }
      initialStageId = firstStage.id;
    }

    const initialStage = await prisma.pipelineStage.findUnique({
      where: { id: initialStageId },
      select: { id: true, canonicalStage: true, isActive: true },
    });
    if (!initialStage?.isActive) {
      res
        .status(400)
        .json({ success: false, message: "Invalid or inactive initial stage" });
      return;
    }

    // ── Atomic: snapshot upsert + pipeline row + stage log ─────────────────
    const created = await prisma.$transaction(async (tx) => {
      // Snapshot is immutable — upsert so retries don't fail
      const snapshot = await tx.candidateSnapshot.upsert({
        where: {
          candidateServiceId_requirementId: {
            candidateServiceId: body.candidateServiceId,
            requirementId: body.requirementId,
          },
        },
        create: {
          candidateServiceId: body.candidateServiceId,
          requirementId: body.requirementId,
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
        update: {}, // snapshot never mutated after creation
        select: { id: true },
      });

      const row = await tx.requirementCandidatePipeline.create({
        data: {
          snapshotId: snapshot.id,
          requirementId: body.requirementId,
          assignmentId: body.assignmentId ?? null,
          recruiterId: actorId,
          currentStageId: initialStageId!,
          stageUpdatedAt: new Date(),
          stageUpdatedById: actorId,
          disposition: "ACTIVE",
        },
        select: CANDIDATE_DETAIL_SELECT,
      });

      // Initial stage log — no fromStage, this is the entry event
      await tx.candidatePipelineStageLog.create({
        data: {
          candidateId: row.id,
          fromStageId: null,
          toStageId: initialStageId!,
          fromCanonicalStage: null,
          toCanonicalStage: initialStage.canonicalStage ?? null,
          changedById: actorId,
          wasSkipped: false,
          timeInPrevStageMins: null,
          note: "Added to pipeline",
        },
      });

      return row;
    });

    res.status(201).json({
      success: true,
      message: "Candidate added to pipeline",
      data: shapeCandidate(created),
    });
  } catch (err) {
    console.error("addCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to add candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /candidates/:candidateId
// Full detail — includes complete stage history, raw snapshot blob
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidateById = async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;

    const row = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: CANDIDATE_DETAIL_SELECT,
    });
    if (!row) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }

    res.json({
      success: true,
      data: shapeCandidate(row),
      permissions: {
        canEdit: req.modulePermission?.canEdit,
        canDelete: req.modulePermission?.canDelete,
      },
    });
  } catch (err) {
    console.error("getCandidateById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/stage
// Move to a different PipelineStage.
// Computes timeInPrevStageMins from current stageUpdatedAt before overwriting.
// Writes CandidatePipelineStageLog. Auto-sets PLACED if moved to JOINED stage.
// ─────────────────────────────────────────────────────────────────────────────

export const moveToStage = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { candidateId } = req.params;
    const body = req.body as MoveStageInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        currentStageId: true,
        currentStage: { select: { canonicalStage: true } },
        stageUpdatedAt: true,
        disposition: true,
      },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }
    if (
      current.disposition === "PLACED" ||
      current.disposition === "DUPLICATE"
    ) {
      res.status(400).json({
        success: false,
        message: `Cannot move stage — candidate disposition is ${current.disposition}`,
      });
      return;
    }
    if (body.stageId === current.currentStageId) {
      res.status(400).json({
        success: false,
        message: "Candidate is already in this stage",
      });
      return;
    }

    const newStage = await prisma.pipelineStage.findUnique({
      where: { id: body.stageId },
      select: { id: true, canonicalStage: true, isActive: true },
    });
    if (!newStage?.isActive) {
      res
        .status(400)
        .json({ success: false, message: "Invalid or inactive stage" });
      return;
    }

    const timeInPrevStageMins = calcTimeInStage(current.stageUpdatedAt);
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.candidatePipelineStageLog.create({
        data: {
          candidateId,
          fromStageId: current.currentStageId,
          toStageId: body.stageId,
          fromCanonicalStage: current.currentStage?.canonicalStage ?? null,
          toCanonicalStage: newStage.canonicalStage ?? null,
          changedById: actorId,
          wasSkipped: body.wasSkipped ?? false,
          skipReason: body.skipReason ?? null,
          timeInPrevStageMins,
          note: body.note ?? null,
        },
      });

      return tx.requirementCandidatePipeline.update({
        where: { id: candidateId },
        data: {
          currentStageId: body.stageId,
          stageUpdatedAt: now,
          stageUpdatedById: actorId,
          // Auto-place when candidate reaches the JOINED canonical stage
          ...(newStage.canonicalStage === "JOINED"
            ? { disposition: "PLACED", dispositionAt: now }
            : {}),
        },
        select: CANDIDATE_DETAIL_SELECT,
      });
    });

    res.json({
      success: true,
      message: "Stage updated",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("moveToStage:", err);
    res.status(500).json({ success: false, message: "Failed to update stage" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/submit
// ─────────────────────────────────────────────────────────────────────────────

export const submitCandidate = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { candidateId } = req.params;
    const body = req.body as SubmitCandidateInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        submittedAt: true,
        currentStageId: true,
        currentStage: { select: { canonicalStage: true } },
        stageUpdatedAt: true,
      },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }
    if (current.submittedAt) {
      res
        .status(400)
        .json({ success: false, message: "Candidate already submitted" });
      return;
    }

    const now = new Date();
    const updateData: any = {
      submittedAt: now,
      submittedById: actorId,
      submissionNote: body.submissionNote ?? null,
    };

    const updated = await prisma.$transaction(async (tx) => {
      // Optionally move to a stage at the same time
      if (body.stageId && body.stageId !== current.currentStageId) {
        const newStage = await tx.pipelineStage.findUnique({
          where: { id: body.stageId },
          select: { id: true, canonicalStage: true, isActive: true },
        });
        if (newStage?.isActive) {
          await tx.candidatePipelineStageLog.create({
            data: {
              candidateId,
              fromStageId: current.currentStageId,
              toStageId: body.stageId,
              fromCanonicalStage: current.currentStage?.canonicalStage ?? null,
              toCanonicalStage: newStage.canonicalStage ?? null,
              changedById: actorId,
              timeInPrevStageMins: calcTimeInStage(current.stageUpdatedAt),
              note: "Submitted to client",
            },
          });
          updateData.currentStageId = body.stageId;
          updateData.stageUpdatedAt = now;
          updateData.stageUpdatedById = actorId;
        }
      }

      return tx.requirementCandidatePipeline.update({
        where: { id: candidateId },
        data: updateData,
        select: CANDIDATE_DETAIL_SELECT,
      });
    });

    res.json({
      success: true,
      message: "Candidate submitted",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("submitCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to submit candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/offer
// ─────────────────────────────────────────────────────────────────────────────

export const recordOffer = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { candidateId } = req.params;
    const body = req.body as RecordOfferInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        currentStageId: true,
        currentStage: { select: { canonicalStage: true } },
        stageUpdatedAt: true,
        disposition: true,
      },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }

    const now = new Date();
    const updateData: any = {
      offeredCtc: body.offeredCtc,
      salaryCurrency: body.salaryCurrency ?? "INR",
      salaryType: body.salaryType ?? null,
      offeredAt: now,
      offeredById: actorId,
      offerStatus: body.offerStatus ?? "PENDING",
      expectedJoiningDate: body.expectedJoiningDate
        ? new Date(body.expectedJoiningDate)
        : null,
    };

    const updated = await prisma.$transaction(async (tx) => {
      if (body.stageId && body.stageId !== current.currentStageId) {
        const newStage = await tx.pipelineStage.findUnique({
          where: { id: body.stageId },
          select: { id: true, canonicalStage: true, isActive: true },
        });
        if (newStage?.isActive) {
          await tx.candidatePipelineStageLog.create({
            data: {
              candidateId,
              fromStageId: current.currentStageId,
              toStageId: body.stageId,
              fromCanonicalStage: current.currentStage?.canonicalStage ?? null,
              toCanonicalStage: newStage.canonicalStage ?? null,
              changedById: actorId,
              timeInPrevStageMins: calcTimeInStage(current.stageUpdatedAt),
              note: "Offer recorded",
            },
          });
          updateData.currentStageId = body.stageId;
          updateData.stageUpdatedAt = now;
          updateData.stageUpdatedById = actorId;
        }
      }

      return tx.requirementCandidatePipeline.update({
        where: { id: candidateId },
        data: updateData,
        select: CANDIDATE_DETAIL_SELECT,
      });
    });

    res.json({
      success: true,
      message: "Offer recorded",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("recordOffer:", err);
    res.status(500).json({ success: false, message: "Failed to record offer" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/offer-status
// ACCEPTED → auto disposition = PLACED
// ─────────────────────────────────────────────────────────────────────────────

export const updateOfferStatus = async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const body = req.body as UpdateOfferStatusInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: { id: true, offeredAt: true },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }
    if (!current.offeredAt) {
      res.status(400).json({
        success: false,
        message: "No offer on record — use /offer first",
      });
      return;
    }

    const now = new Date();
    const updateData: any = { offerStatus: body.offerStatus };

    if (body.offerStatus === "ACCEPTED") {
      updateData.disposition = "PLACED";
      updateData.dispositionAt = now;
      if (body.actualJoiningDate) {
        updateData.actualJoiningDate = new Date(body.actualJoiningDate);
      }
    }

    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: candidateId },
      data: updateData,
      select: CANDIDATE_DETAIL_SELECT,
    });

    res.json({
      success: true,
      message: "Offer status updated",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("updateOfferStatus:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update offer status" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/reject
// ─────────────────────────────────────────────────────────────────────────────

export const rejectCandidate = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { candidateId } = req.params;
    const body = req.body as RejectCandidateInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: { id: true, isRejected: true },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }
    if (current.isRejected) {
      res
        .status(400)
        .json({ success: false, message: "Candidate already rejected" });
      return;
    }

    const now = new Date();
    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: candidateId },
      data: {
        isRejected: true,
        rejectedAt: now,
        rejectedById: actorId,
        rejectionReason: body.rejectionReason ?? null,
        ...(body.dropDisposition
          ? {
              disposition: "DROPPED",
              dispositionAt: now,
              dropReason: body.dropReason ?? null,
              dropNote: body.dropNote ?? null,
            }
          : {}),
      },
      select: CANDIDATE_DETAIL_SELECT,
    });

    res.json({
      success: true,
      message: "Candidate rejected",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("rejectCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to reject candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/withdraw
// Candidate withdrew — auto-DROPPED
// ─────────────────────────────────────────────────────────────────────────────

export const withdrawCandidate = async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const body = req.body as WithdrawCandidateInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: { id: true, isWithdrawn: true },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }
    if (current.isWithdrawn) {
      res
        .status(400)
        .json({ success: false, message: "Candidate already withdrawn" });
      return;
    }

    const now = new Date();
    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: candidateId },
      data: {
        isWithdrawn: true,
        withdrawnAt: now,
        withdrawnReason: body.withdrawnReason ?? null,
        disposition: "DROPPED",
        dispositionAt: now,
      },
      select: CANDIDATE_DETAIL_SELECT,
    });

    res.json({
      success: true,
      message: "Candidate marked as withdrawn",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("withdrawCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to withdraw candidate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/hold
// Toggle hold on/off
// ─────────────────────────────────────────────────────────────────────────────

export const holdCandidate = async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const body = req.body as HoldCandidateInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: { id: true, isOnHold: true },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }

    const now = new Date();
    const putting = !current.isOnHold;

    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: candidateId },
      data: {
        isOnHold: putting,
        onHoldAt: putting ? now : null,
        onHoldReason: putting ? body.onHoldReason ?? null : null,
        disposition: putting ? "ON_HOLD" : "ACTIVE",
        dispositionAt: now,
      },
      select: CANDIDATE_DETAIL_SELECT,
    });

    res.json({
      success: true,
      message: putting ? "Candidate placed on hold" : "Candidate reactivated",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("holdCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update hold status" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /candidates/:candidateId/disposition
// Generic disposition setter — for cases not covered by specific endpoints
// ─────────────────────────────────────────────────────────────────────────────

export const setDisposition = async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const body = req.body as SetDispositionInput;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }

    const now = new Date();
    const updateData: any = {
      disposition: body.disposition,
      dispositionAt: now,
    };

    if (body.disposition === "DROPPED") {
      updateData.dropReason = body.dropReason ?? null;
      updateData.dropNote = body.dropNote ?? null;
    }
    if (body.disposition === "PLACED" && body.actualJoiningDate) {
      updateData.actualJoiningDate = new Date(body.actualJoiningDate);
    }
    if (body.disposition === "ON_HOLD") {
      updateData.isOnHold = true;
      updateData.onHoldAt = now;
    }
    if (body.disposition === "ACTIVE") {
      updateData.isOnHold = false;
      updateData.onHoldAt = null;
      updateData.onHoldReason = null;
    }

    const updated = await prisma.requirementCandidatePipeline.update({
      where: { id: candidateId },
      data: updateData,
      select: CANDIDATE_DETAIL_SELECT,
    });

    res.json({
      success: true,
      message: "Disposition updated",
      data: shapeCandidate(updated),
    });
  } catch (err) {
    console.error("setDisposition:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to set disposition" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /candidates/:candidateId
// Hard delete pipeline row + orphaned snapshot cleanup.
// Blocked if candidate is PLACED.
// ─────────────────────────────────────────────────────────────────────────────

export const removeCandidate = async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;

    const current = await prisma.requirementCandidatePipeline.findUnique({
      where: { id: candidateId },
      select: { id: true, snapshotId: true, disposition: true },
    });
    if (!current) {
      res
        .status(404)
        .json({ success: false, message: "Candidate not found in pipeline" });
      return;
    }
    if (current.disposition === "PLACED") {
      res.status(400).json({
        success: false,
        message: "Cannot remove a placed candidate from the pipeline",
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Stage log rows cascade via onDelete: Cascade on candidateId FK
      await tx.requirementCandidatePipeline.delete({
        where: { id: candidateId },
      });

      // Remove orphaned snapshot — only if no other pipeline rows use it
      const others = await tx.requirementCandidatePipeline.count({
        where: { snapshotId: current.snapshotId },
      });
      if (others === 0) {
        await tx.candidateSnapshot.delete({
          where: { id: current.snapshotId },
        });
      }
    });

    res.json({ success: true, message: "Candidate removed from pipeline" });
  } catch (err) {
    console.error("removeCandidate:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove candidate" });
  }
};
