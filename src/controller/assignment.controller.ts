// File: assignment.controller.ts
// Path: src/controller/assignment.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { assignmentScopeWhere } from "@/middleware/scopeFilter.middleware";
import type {
  CreateAssignmentInput,
  SubAssignInput,
  UpdateAssignmentInput,
} from "@/validators/assignment.validator";
import { Prisma } from "@prisma/client";
import { sendMail } from "@/utils/mailer";

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SELECT FOR STATS
// currentCanonicalStage removed from schema — read via currentStage.canonicalStage
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_SELECT_FOR_STATS = {
  id: true,
  disposition: true,
  // currentCanonicalStage REMOVED — use currentStage.canonicalStage instead
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offeredAt: true,
  offerStatus: true,
  actualJoiningDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  noticePeriod: true,
  monthOfJoining: true,
  expectedCtc: true,
  lastWorkingDate: true,
  offeredCtc: true,
  salaryType: true,
  salaryCurrency: true,
  isTransferred: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      canonicalStage: true,
    },
  },
} satisfies Prisma.RequirementCandidatePipelineSelect;

// ─────────────────────────────────────────────────────────────────────────────
// FULL PIPELINE ROW SELECT — used in getAssignmentPipeline
// ─────────────────────────────────────────────────────────────────────────────

const FULL_PIPELINE_SELECT = {
  id: true,
  disposition: true,
  // currentCanonicalStage REMOVED from schema
  dropReason: true,
  dropNote: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  submittedAt: true,
  offeredAt: true,
  offerStatus: true,
  offeredCtc: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  noticePeriod: true,

  // ── CTC ladder — ADD THESE
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  ctcNotes: true,

  // ── Offer — ADD THESE
  salaryCurrency: true,
  salaryType: true,

  // ── Submission — ADD THESE (if missing)

  submissionNote: true,

  // ── Joining — ADD THESE
  lastWorkingDate: true,

  monthOfJoining: true,
  remainingDaysToJoin: true,

  // ── Status flags — ADD THESE (if missing)

  isTransferred: true,
  transferredAt: true,
  rejectionReason: true,
  withdrawnReason: true,
  onHoldReason: true,

  currentStage: {
    select: {
      id: true,
      label: true,
      code: true,
      order: true,
      canonicalStage: true, // ← canonical lives here now, always
    },
  },
  recruiter: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: { select: { name: true } },
    },
  },
  snapshot: {
    select: {
      id: true,
      fullName: true,
      candidateServiceId: true, // ← THIS is the redirect ID
      email: true,
      phone: true,
      currentTitle: true,
      currentCompany: true,
      totalExpYears: true,
      topSkills: true,
      resumeUrl: true,
    },
  },
  stageHistory: {
    select: {
      id: true,
      fromCanonicalStage: true,
      toCanonicalStage: true,
      timeInPrevStageMins: true,
      createdAt: true,
      changedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: "desc" as const },
    take: 10,
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
          employeeId: true,
        },
      },
    },
  },
} satisfies Prisma.RequirementCandidatePipelineSelect;

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENT SELECT
// ─────────────────────────────────────────────────────────────────────────────

const ASSIGNMENT_SELECT = {
  id: true,
  depth: true,
  status: true,
  allocatedOpenings: true,
  deadline: true,
  deadlineMet: true,
  breachedAt: true,
  assignedAt: true,
  removedAt: true,
  removedReason: true,

  assignedBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      role: { select: { id: true, name: true } },
    },
  },

  assignedTo: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      role: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },

  assigneeDepartment: { select: { id: true, name: true } },
  assigneeBU: { select: { id: true, name: true } },

  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      status: true,
      priority: true,
      jobType: true,
      description: true,
      education: true,
      functionalArea: true,
      targetCompanies: true,
      remoteType: true,
      totalOpenings: true,
      respondBy: true,
      targetDate: true,
      primarySkills: true,
      keySkills: true,
      experienceMin: true,
      experienceMax: true,
      salaryMin: true,
      salaryMax: true,
      shift: true,
      closedAt: true,
      closureReason: true,
      isRespondByBreached: true,
      isTurnaroundBreached: true,
      jdFileKey: true,
      jdFileName: true,
      jdFileType: true,
      jdUploadedAt: true,
      jdParsedAt: true,
      jdParseStatus: true,
      jdParsedFields: true,
      parsedJDId: true,
      createdAt: true,
      updatedAt: true,
      approvedAt: true,
      client: { select: { id: true, name: true, industry: true } },
      serviceLine: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true } },
      clientSpoc: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          isPrimary: true,
          handler: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  },

  parentAssignment: {
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

  childAssignments: {
    select: {
      id: true,
      depth: true,
      status: true,
      allocatedOpenings: true,
      deadline: true,
      breachedAt: true,
      assignedAt: true,
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeId: true,
          role: { select: { id: true, name: true } },
        },
      },
      assignedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
      pipelines: { select: PIPELINE_SELECT_FOR_STATS },
      childAssignments: {
        select: {
          id: true,
          depth: true,
          status: true,
          allocatedOpenings: true,
          deadline: true,
          breachedAt: true,
          assignedAt: true,
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
              role: { select: { id: true, name: true } },
            },
          },
          assignedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          pipelines: { select: PIPELINE_SELECT_FOR_STATS },
        },
        where: { status: "ACTIVE" },
        orderBy: { assignedAt: "asc" as const },
      },
    },
    where: { status: "ACTIVE" },
    orderBy: { assignedAt: "asc" as const },
  },

  pipelines: { select: PIPELINE_SELECT_FOR_STATS },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE PIPELINE STATS
// All canonical stage reads go through currentStage.canonicalStage
// — no stored string field on the pipeline row anymore
// ─────────────────────────────────────────────────────────────────────────────

function computePipelineStats(pipelines: any[]) {
  const now = Date.now();

  const total = pipelines.length;
  const active = pipelines.filter((p) => p.disposition === "ACTIVE").length;
  const placed = pipelines.filter((p) => p.disposition === "PLACED").length;
  const dropped = pipelines.filter((p) => p.disposition === "DROPPED").length;
  const onHold = pipelines.filter((p) => p.disposition === "ON_HOLD").length;
  const rejected = pipelines.filter((p) => p.isRejected).length;
  const withdrawn = pipelines.filter((p) => p.isWithdrawn).length;
  const submitted = pipelines.filter((p) => p.submittedAt !== null).length;
  const offered = pipelines.filter((p) => p.offeredAt !== null).length;
  const joined = pipelines.filter((p) => p.actualJoiningDate !== null).length;

  const offerAccepted = pipelines.filter(
    (p) => p.offerStatus === "ACCEPTED",
  ).length;
  const offerPending = pipelines.filter(
    (p) => p.offerStatus === "PENDING",
  ).length;
  const offerDeclined = pipelines.filter(
    (p) => p.offerStatus === "DECLINED" || p.offerStatus === "REVOKED",
  ).length;

  // ── byCanonicalStage — read from currentStage.canonicalStage (single source of truth)
  const byCanonicalStage: Record<string, number> = {};
  for (const p of pipelines) {
    const stage = p.currentStage?.canonicalStage ?? "UNKNOWN";
    byCanonicalStage[stage] = (byCanonicalStage[stage] ?? 0) + 1;
  }

  // ── activeByCanonicalStage — active candidates only
  const activeRows = pipelines.filter((p) => p.disposition === "ACTIVE");
  const activeByCanonicalStage: Record<string, number> = {};
  for (const p of activeRows) {
    const stage = p.currentStage?.canonicalStage ?? "UNKNOWN";
    activeByCanonicalStage[stage] = (activeByCanonicalStage[stage] ?? 0) + 1;
  }

  // ── byPipelineStage — actual stage breakdown with counts
  const stageMap: Record<
    string,
    {
      id: string;
      code: string;
      label: string;
      order: number;
      canonicalStage: string | null;
      count: number;
    }
  > = {};
  for (const p of pipelines) {
    if (!p.currentStage) continue;
    const { id, code, label, order, canonicalStage } = p.currentStage;
    if (!stageMap[id])
      stageMap[id] = {
        id,
        code,
        label,
        order,
        canonicalStage: canonicalStage ?? null,
        count: 0,
      };
    stageMap[id].count++;
  }
  const byPipelineStage = Object.values(stageMap).sort(
    (a, b) => a.order - b.order,
  );

  // ── activeByPipelineStage — same but active only
  const activeStageMap: Record<
    string,
    {
      id: string;
      code: string;
      label: string;
      order: number;
      canonicalStage: string | null;
      count: number;
    }
  > = {};
  for (const p of activeRows) {
    if (!p.currentStage) continue;
    const { id, code, label, order, canonicalStage } = p.currentStage;
    if (!activeStageMap[id])
      activeStageMap[id] = {
        id,
        code,
        label,
        order,
        canonicalStage: canonicalStage ?? null,
        count: 0,
      };
    activeStageMap[id].count++;
  }
  const activeByPipelineStage = Object.values(activeStageMap).sort(
    (a, b) => a.order - b.order,
  );

  // ── Aging buckets for active candidates
  const agingBuckets = { fresh: 0, normal: 0, stale: 0, critical: 0 };
  for (const p of activeRows) {
    if (!p.stageUpdatedAt) continue;
    const ageDays = (now - new Date(p.stageUpdatedAt).getTime()) / 86_400_000;
    if (ageDays < 3) agingBuckets.fresh++;
    else if (ageDays < 7) agingBuckets.normal++;
    else if (ageDays < 14) agingBuckets.stale++;
    else agingBuckets.critical++;
  }

  return {
    total,
    active,
    placed,
    dropped,
    onHold,
    rejected,
    withdrawn,
    submitted,
    offered,
    offerAccepted,
    offerPending,
    offerDeclined,
    joined,
    byCanonicalStage,
    activeByCanonicalStage,
    byPipelineStage,
    activeByPipelineStage,
    agingBuckets,
    rates: {
      submission: total > 0 ? Math.round((submitted / total) * 100) : 0,
      offer: submitted > 0 ? Math.round((offered / submitted) * 100) : 0,
      joining: offered > 0 ? Math.round((joined / offered) * 100) : 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

function shapeAssignment(a: any) {
  const candidateStats = computePipelineStats(a.pipelines ?? []);

  const shapedGrandchild = (g: any) => ({
    ...g,
    candidateStats: computePipelineStats(g.pipelines ?? []),
    pipelines: undefined,
  });

  const shapedChildren = (a.childAssignments ?? []).map((c: any) => ({
    ...c,
    candidateStats: computePipelineStats(c.pipelines ?? []),
    pipelines: undefined,
    childAssignments: (c.childAssignments ?? []).map(shapedGrandchild),
  }));

  return {
    ...a,
    candidateStats,
    pipelines: undefined,
    childAssignments: shapedChildren,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE AGING
// ─────────────────────────────────────────────────────────────────────────────

function computeAging(stageUpdatedAt: string | null) {
  if (!stageUpdatedAt) return { minutes: 0, label: "—" };
  const mins = Math.floor(
    (Date.now() - new Date(stageUpdatedAt).getTime()) / 60000,
  );
  if (mins < 60) return { minutes: mins, label: `${mins}m` };
  const h = Math.floor(mins / 60);
  if (h < 24) return { minutes: mins, label: `${h}h` };
  const d = Math.floor(h / 24);
  if (d < 30) return { minutes: mins, label: `${d}d` };
  return { minutes: mins, label: `${Math.floor(d / 30)}mo` };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE PIPELINE ROW
// canonical stage comes from currentStage.canonicalStage — not a stored field
// ─────────────────────────────────────────────────────────────────────────────

function shapePipelineRow(p: any) {
  return {
    ...p,
    // expose canonicalStage at top level for frontend convenience
    // but it's sourced from currentStage.canonicalStage — single source of truth
    currentCanonicalStage: p.currentStage?.canonicalStage ?? null,
    aging: computeAging(p.stageUpdatedAt),
    // ← use the real DB field, not a derived comparison
    isTransferred: p.isTransferred === true,
    // ← expose last transfer info from stage history for tracking
    lastTransfer: (() => {
      const log = (p.stageHistory ?? []).find((h: any) =>
        h.note?.startsWith("Transferred from"),
      );
      if (!log) return null;
      const match = log.note?.match(
        /^Transferred from (.+?) to (.+?)(?:\. .+)?$/,
      );

      return {
        note: log.note,
        at: log.createdAt,
        by: log.changedBy
          ? {
              id: log.changedBy.id,
              name: `${log.changedBy.firstName} ${log.changedBy.lastName}`.trim(),
            }
          : null,
        // parsed from the note — avoids needing extra DB fields
        fromRecruiter: match?.[1]?.trim() ?? null,
        toRecruiter: match?.[2]?.trim() ?? null,
      };
    })(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignments = async (req: Request, res: Response) => {
  try {
    const {
      requirementId,
      assignedToId,
      status,
      depth,
      buId,
      page = "1",
      limit = "50",
      sortBy = "assignedAt",
      sortDir = "desc",
      search,
      isTransferred = "false",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const scopeWhere = assignmentScopeWhere(req.scopeFilter!);
    const filterWhere: any = { ...scopeWhere };
    if (search?.trim()) {
      const q = search.trim();
      filterWhere.OR = [
        {
          requirement: {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { reqCode: { contains: q, mode: "insensitive" } },
              { client: { name: { contains: q, mode: "insensitive" } } },
            ],
          },
        },
        {
          assignedTo: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { employeeId: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    if (requirementId) filterWhere.requirementId = requirementId;
    if (assignedToId) filterWhere.assignedToId = assignedToId;
    if (status) filterWhere.status = status;
    if (depth !== undefined) filterWhere.depth = parseInt(depth);

    const SORTABLE = ["assignedAt", "deadline"];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { assignedAt: "desc" as const };

    const [total, assignments] = await Promise.all([
      prisma.requirementAssignment.count({ where: filterWhere }),
      prisma.requirementAssignment.findMany({
        where: filterWhere,
        select: ASSIGNMENT_SELECT,
        orderBy,
        skip,
        take,
      }),
    ]);
    // ── Fetch latest transfer activity for each requirement in this page ──
    // RequirementActivity.type = "RECRUITER_ASSIGNED" is logged on every transfer
    // with full meta: fromRecruiterId, fromRecruiterName, toRecruiterId,
    // toRecruiterName, transferredBy (actor)
    const requirementIds = [
      ...new Set(assignments.map((a: any) => a.requirementId).filter(Boolean)),
    ];
    console.log("[getAssignments] requirementIds:", requirementIds);

    const transferActivities = requirementIds.length
      ? await prisma.requirementActivity.findMany({
          where: {
            requirementId: { in: requirementIds },
            type: "RECRUITER_ASSIGNED",
          },
          select: {
            id: true,
            requirementId: true,
            createdAt: true,
            meta: true,
            actor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];
    console.log(
      "[getAssignments] transferActivities:",
      JSON.stringify(transferActivities, null, 2),
    );
    // Build map: requirementId → latest transfer activity
    const latestTransferMap = new Map<string, any>();
    for (const activity of transferActivities) {
      if (!latestTransferMap.has(activity.requirementId)) {
        latestTransferMap.set(activity.requirementId, activity);
      }
    }

    // ── Shape each assignment with transfer info attached ─────────────────
    const shaped = assignments.map((a: any) => {
      const shaped = shapeAssignment(a);
      const latestActivity = latestTransferMap.get(a.requirement?.id);

      if (!latestActivity) {
        return { ...shaped, lastTransfer: null };
      }

      const meta = latestActivity.meta as any;
      return {
        ...shaped,
        lastTransfer: {
          at: latestActivity.createdAt,
          // DL/TL who performed the transfer
          by: {
            id: latestActivity.actor.id,
            name: `${latestActivity.actor.firstName} ${latestActivity.actor.lastName}`.trim(),
            role: latestActivity.actor.role?.name ?? null,
          },
          from: {
            id: meta?.fromRecruiterId ?? null,
            name: meta?.fromRecruiterName ?? null,
            assignmentId: meta?.fromAssignmentId ?? null,
          },
          to: {
            id: meta?.toRecruiterId ?? null,
            name: meta?.toRecruiterName ?? null,
            assignmentId: meta?.toAssignmentId ?? null,
          },
          candidateName: meta?.candidateName ?? null,
        },
      };
    });

    res.json({
      success: true,
      data: assignments.map(shapeAssignment),
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      permissions: {
        canAdd: req.modulePermission?.canAdd,
        canEdit: req.modulePermission?.canEdit,
        canDelete: req.modulePermission?.canDelete,
      },
    });
  } catch (err) {
    console.error("getAssignments:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignments" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments/:id
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const assignment = await prisma.requirementAssignment.findUnique({
      where: { id },
      select: ASSIGNMENT_SELECT,
    });
    if (!assignment) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }
    res.json({
      success: true,
      data: shapeAssignment(assignment),
      permissions: {
        canEdit: req.modulePermission?.canEdit,
        canDelete: req.modulePermission?.canDelete,
      },
    });
  } catch (err) {
    console.error("getAssignmentById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments/requirement/:requirementId
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignmentsByRequirement = async (
  req: Request,
  res: Response,
) => {
  try {
    const { requirementId } = req.params;

    const assignments = await prisma.requirementAssignment.findMany({
      where: {
        requirementId,
        depth: 0,
        ...assignmentScopeWhere(req.scopeFilter!),
      },
      select: ASSIGNMENT_SELECT,
      orderBy: { assignedAt: "asc" },
    });

    const requirement = await prisma.requirement.findUnique({
      where: { id: requirementId },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        totalOpenings: true,
        respondBy: true,
        client: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
      },
    });

    if (!requirement) {
      res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
      return;
    }

    const shaped = assignments.map(shapeAssignment);

    const allPipelines = assignments.flatMap((a) => [
      ...(a.pipelines ?? []),
      ...(a.childAssignments ?? []).flatMap((c: any) => [
        ...(c.pipelines ?? []),
        ...(c.childAssignments ?? []).flatMap((g: any) => g.pipelines ?? []),
      ]),
    ]);
    const totalCandidateStats = computePipelineStats(allPipelines);

    res.json({
      success: true,
      data: { requirement, totalCandidateStats, assignments: shaped },
    });
  } catch (err) {
    console.error("getAssignmentsByRequirement:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignments" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments/my
// ─────────────────────────────────────────────────────────────────────────────

export const getMyAssignments = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      status,
      search,
      page = "1",
      limit = "25",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const where: any = { assignedToId: userId };
    if (status) where.status = status;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        {
          requirement: {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { reqCode: { contains: q, mode: "insensitive" } },
              { client: { name: { contains: q, mode: "insensitive" } } },
            ],
          },
        },
      ];
    }
    const [total, assignments] = await Promise.all([
      prisma.requirementAssignment.count({ where }),
      prisma.requirementAssignment.findMany({
        where,
        select: ASSIGNMENT_SELECT,
        orderBy: { assignedAt: sortDir as "asc" | "desc" },
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: assignments.map(shapeAssignment),
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getMyAssignments:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch my assignments" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments/assignable-targets
// ─────────────────────────────────────────────────────────────────────────────

// File: assignment.controller.ts
// Path: src/controller/assignment.controller.ts

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments/assignable-targets
// Returns reportees + tagged extra users (UserAssignableTo)
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignableTargets = async (req: Request, res: Response) => {
  try {
    const { requirementId, parentAssignmentId } = req.query as Record<
      string,
      string
    >;

    if (!requirementId) {
      res
        .status(400)
        .json({ success: false, message: "requirementId is required" });
      return;
    }

    // who's already assigned — exclude them
    const existing = await prisma.requirementAssignment.findMany({
      where: { requirementId, status: "ACTIVE" },
      select: { assignedToId: true },
    });
    const alreadyAssignedIds = existing.map((a) => a.assignedToId);
    const excludeIds = [req.user!.id, ...alreadyAssignedIds];

    let reporteeWhere: any = null;
    let pivotUserId: string = req.user!.id; // whose chain + extras we resolve from

    if (parentAssignmentId) {
      const parent = await prisma.requirementAssignment.findUnique({
        where: { id: parentAssignmentId },
        select: { assignedToId: true, depth: true },
      });
      if (!parent) {
        res
          .status(404)
          .json({ success: false, message: "Parent assignment not found" });
        return;
      }
      if (parent.depth >= 2) {
        res.json({ success: true, data: [] });
        return;
      }
      pivotUserId = parent.assignedToId;
      reporteeWhere = {
        isActive: true,
        id: { notIn: excludeIds },
        OR: [{ reportingToId: pivotUserId }, { teamLeadId: pivotUserId }],
      };
    } else {
      // depth 0 — assigning from self
      reporteeWhere = {
        isActive: true,
        id: { notIn: excludeIds },
        OR: [{ reportingToId: pivotUserId }, { teamLeadId: pivotUserId }],
      };
    }

    const USER_SELECT = {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      role: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    } as const;

    // fetch reportees + tagged extras in parallel
    const [reportees, extras] = await Promise.all([
      prisma.user.findMany({
        where: reporteeWhere,
        select: USER_SELECT,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: 100,
      }),
      prisma.userAssignableTo.findMany({
        where: {
          userId: pivotUserId,
          target: {
            isActive: true,
            id: { notIn: excludeIds },
          },
        },
        select: {
          target: { select: USER_SELECT },
        },
      }),
    ]);

    // merge — dedupe by id in case someone is both a reportee and tagged
    const seen = new Set<string>();
    const merged: typeof reportees = [];

    for (const u of reportees) {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        merged.push({ ...u, _source: "chain" } as any);
      }
    }
    for (const e of extras) {
      if (!seen.has(e.target.id)) {
        seen.add(e.target.id);
        merged.push({ ...e.target, _source: "extra" } as any);
      }
    }

    merged.sort((a, b) =>
      (a as any).firstName.localeCompare((b as any).firstName),
    );

    res.json({ success: true, data: merged });
  } catch (err) {
    console.error("getAssignableTargets:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignable targets" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /assignments
// ─────────────────────────────────────────────────────────────────────────────

export const createAssignment = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const body = req.body as CreateAssignmentInput;

    const requirement = await prisma.requirement.findFirst({
      where: { id: body.requirementId, deletedAt: null },
      select: {
        id: true,
        status: true,
        clientId: true,
        businessUnitId: true,
        serviceLineId: true,
        reqCode: true, // ← add
        title: true, // ← add
        description: true, // ← add
        totalOpenings: true, // ← add
        priority: true, // ← add
        targetDate: true, // ← add
        respondBy: true, // ← add
        experienceMin: true, // ← add
        experienceMax: true, // ← add
        primarySkills: true, // ← add
        client: { select: { name: true } }, // ← add
        serviceLine: { select: { name: true } }, // ← add
        createdBy: { select: { firstName: true, lastName: true } }, // ← add
      },
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
        message: `Cannot assign a requirement in ${requirement.status} status`,
      });
      return;
    }

    const existing = await prisma.requirementAssignment.findFirst({
      where: {
        requirementId: body.requirementId,
        assignedToId: body.assignedToId,
        depth: 0,
        status: "ACTIVE",
      },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        message:
          "This user already has an active assignment for this requirement",
      });
      return;
    }

    const assignee = await prisma.user.findUnique({
      where: { id: body.assignedToId },
      select: {
        id: true,
        departmentId: true,
        email: true, // ← add
        firstName: true, // ← add
        lastName: true, // ← add
      },
    });
    if (!assignee) {
      res
        .status(404)
        .json({ success: false, message: "Assignee user not found" });
      return;
    }

    const assignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: body.requirementId,
        assignedToId: body.assignedToId,
        assignedById: actorId,
        depth: 0,
        status: "ACTIVE",
        allocatedOpenings: body.allocatedOpenings ?? null,
        deadline: body.deadline ? new Date(body.deadline) : null,
        clientId: requirement.clientId,
        assigneeBUId: requirement.businessUnitId ?? null,
        assigneeDepartmentId: assignee.departmentId ?? null,
      },
      select: ASSIGNMENT_SELECT,
    });

    // ── respond immediately, email fires after ────────────────────────────────
    res.status(201).json({
      success: true,
      message: "Assignment created",
      data: shapeAssignment(assignment),
    });

    // ── send assignment email (non-blocking, won't affect response) ───────────
    try {
      const reqUrl = `${process.env.FRONTEND_URL}/assignments`;
      const deadline = body.deadline
        ? new Date(body.deadline).toDateString()
        : "Not set";
      const expRange =
        requirement.experienceMin != null || requirement.experienceMax != null
          ? `${requirement.experienceMin ?? 0} – ${requirement.experienceMax ?? "?"} yrs`
          : "Not specified";

      await sendMail({
        to: assignee.email,
        subject: `New Requirement Assigned: ${requirement.reqCode} – ${requirement.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1E3A5F;">You have a new requirement assigned</h2>

            <p>Hi ${assignee.firstName},</p>

            <p>
              <strong>${req.user!.firstName} ${req.user!.lastName}</strong>
              has assigned the following requirement to you.
            </p>

            <table style="width:100%; border-collapse:collapse; margin: 20px 0;">
              <tr style="background:#f0f4f8;">
                <td style="padding:10px; font-weight:bold; width:40%;">Req Code</td>
                <td style="padding:10px;">${requirement.reqCode}</td>
              </tr>
              <tr>
                <td style="padding:10px; font-weight:bold;">Title</td>
                <td style="padding:10px;">${requirement.title}</td>
              </tr>
              <tr style="background:#f0f4f8;">
                <td style="padding:10px; font-weight:bold;">Client</td>
                <td style="padding:10px;">${requirement.client?.name ?? "—"}</td>
              </tr>
              <tr>
                <td style="padding:10px; font-weight:bold;">Service Line</td>
                <td style="padding:10px;">${requirement.serviceLine?.name ?? "—"}</td>
              </tr>
              <tr style="background:#f0f4f8;">
                <td style="padding:10px; font-weight:bold;">Priority</td>
                <td style="padding:10px;">${requirement.priority}</td>
              </tr>
              <tr>
                <td style="padding:10px; font-weight:bold;">Total Openings</td>
                <td style="padding:10px;">${requirement.totalOpenings}</td>
              </tr>
              <tr style="background:#f0f4f8;">
                <td style="padding:10px; font-weight:bold;">Experience</td>
                <td style="padding:10px;">${expRange}</td>
              </tr>
              <tr>
                <td style="padding:10px; font-weight:bold;">Primary Skills</td>
                <td style="padding:10px;">${(requirement.primarySkills ?? []).join(", ") || "—"}</td>
              </tr>
              <tr style="background:#f0f4f8;">
                <td style="padding:10px; font-weight:bold;">Your Deadline</td>
                <td style="padding:10px;">${deadline}</td>
              </tr>
              <tr>
                <td style="padding:10px; font-weight:bold;">Respond By</td>
                <td style="padding:10px;">${requirement.respondBy ? new Date(requirement.respondBy).toDateString() : "Not set"}</td>
              </tr>
              ${
                requirement.description
                  ? `<tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold;">Description</td>
                      <td style="padding:10px;">${requirement.description}</td>
                    </tr>`
                  : ""
              }
            </table>

            <a href="${reqUrl}" style="
              display: inline-block;
              padding: 12px 24px;
              background: #1E3A5F;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
            ">
              View Assignment
            </a>

            <p style="color: #6B7280; font-size: 13px; margin-top: 24px;">
              This is an automated notification from your ATS.
            </p>
          </div>
        `,
      });
    } catch (mailErr) {
      console.error("createAssignment: email failed:", mailErr);
    }
  } catch (err) {
    console.error("createAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /assignments/:id/sub-assign
// ─────────────────────────────────────────────────────────────────────────────

export const subAssign = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { id: parentId } = req.params;
    const body = req.body as SubAssignInput;

    const parent = await prisma.requirementAssignment.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        depth: true,
        status: true,
        requirementId: true,
        clientId: true,
        assigneeBUId: true,
        assignedToId: true,
      },
    });
    if (!parent) {
      res
        .status(404)
        .json({ success: false, message: "Parent assignment not found" });
      return;
    }
    if (parent.status !== "ACTIVE") {
      res
        .status(400)
        .json({ success: false, message: "Parent assignment is not active" });
      return;
    }
    if (parent.depth >= 2) {
      res
        .status(400)
        .json({ success: false, message: "Cannot sub-assign beyond depth 2" });
      return;
    }
    if (parent.assignedToId !== actorId && !req.user!.isSuperAdmin) {
      res.status(403).json({
        success: false,
        message: "Only the assignee of the parent assignment can sub-assign",
      });
      return;
    }

    const existing = await prisma.requirementAssignment.findFirst({
      where: {
        requirementId: parent.requirementId,
        assignedToId: body.assignedToId,
        parentAssignmentId: parentId,
        status: "ACTIVE",
      },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        message:
          "This user already has an active sub-assignment under this assignment",
      });
      return;
    }

    const assignee = await prisma.user.findUnique({
      where: { id: body.assignedToId },
      select: { id: true, departmentId: true },
    });
    if (!assignee) {
      res.status(404).json({ success: false, message: "Assignee not found" });
      return;
    }

    const child = await prisma.requirementAssignment.create({
      data: {
        requirementId: parent.requirementId,
        assignedToId: body.assignedToId,
        assignedById: actorId,
        parentAssignmentId: parentId,
        depth: parent.depth + 1,
        status: "ACTIVE",
        allocatedOpenings: body.allocatedOpenings ?? null,
        deadline: body.deadline ? new Date(body.deadline) : null,
        clientId: parent.clientId,
        assigneeBUId: parent.assigneeBUId ?? null,
        assigneeDepartmentId: assignee.departmentId ?? null,
      },
      select: ASSIGNMENT_SELECT,
    });

    res.status(201).json({
      success: true,
      message: "Sub-assignment created",
      data: shapeAssignment(child),
    });
  } catch (err) {
    console.error("subAssign:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create sub-assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /assignments/:id
// ─────────────────────────────────────────────────────────────────────────────

export const updateAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateAssignmentInput;

    const existing = await prisma.requirementAssignment.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }

    const data: any = {};
    if (body.allocatedOpenings !== undefined)
      data.allocatedOpenings = body.allocatedOpenings;
    if (body.deadline !== undefined)
      data.deadline = body.deadline ? new Date(body.deadline) : null;
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === "REMOVED") {
        data.removedAt = new Date();
        data.removedReason = body.removedReason ?? null;
      }
    }

    const updated = await prisma.requirementAssignment.update({
      where: { id },
      data,
      select: ASSIGNMENT_SELECT,
    });

    res.json({
      success: true,
      message: "Assignment updated",
      data: shapeAssignment(updated),
    });
  } catch (err) {
    console.error("updateAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /assignments/:id — soft remove, cascade active children
// ─────────────────────────────────────────────────────────────────────────────

export const removeAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const existing = await prisma.requirementAssignment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        childAssignments: { select: { id: true, status: true } },
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }
    if (existing.status === "REMOVED") {
      res
        .status(400)
        .json({ success: false, message: "Assignment already removed" });
      return;
    }

    const activeChildIds = existing.childAssignments
      .filter((c) => c.status === "ACTIVE")
      .map((c) => c.id);

    await prisma.$transaction([
      ...(activeChildIds.length > 0
        ? [
            prisma.requirementAssignment.updateMany({
              where: { id: { in: activeChildIds } },
              data: {
                status: "REMOVED",
                removedAt: new Date(),
                removedReason: "Parent removed",
              },
            }),
          ]
        : []),
      prisma.requirementAssignment.update({
        where: { id },
        data: {
          status: "REMOVED",
          removedAt: new Date(),
          removedReason: reason ?? null,
        },
      }),
    ]);

    res.json({ success: true, message: "Assignment removed" });
  } catch (err) {
    console.error("removeAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /assignments/:id/pipeline
// ─────────────────────────────────────────────────────────────────────────────

export const getAssignmentPipeline = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      disposition,
      stageId,
      activeOnly,
      search,
      page = "1",
      limit = "25",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const assignment = await prisma.requirementAssignment.findUnique({
      where: { id },
      select: {
        id: true,
        requirementId: true,
        requirement: {
          select: {
            id: true,
            reqCode: true,
            title: true,
            serviceLine: { select: { id: true, name: true } },
          },
        },
        pipelines: { select: PIPELINE_SELECT_FOR_STATS },
      },
    });

    if (!assignment) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }

    const where: any = { assignmentId: id };
    // if (disposition) where.disposition = disposition;
    if (stageId) where.currentStageId = stageId;
    // if (activeOnly === "true") where.disposition = "ACTIVE";

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

    const [total, pipelines] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: FULL_PIPELINE_SELECT,
        orderBy: { stageUpdatedAt: "desc" },
        skip,
        take,
      }),
    ]);

    const serviceLineId = assignment.requirement.serviceLine?.id;

    const stageWhere: Prisma.PipelineStageWhereInput = {
      isActive: true,
      ...(serviceLineId
        ? { OR: [{ serviceLineId }, { serviceLineId: null }] }
        : { serviceLineId: null }),
    };

    const pipelineStages = await prisma.pipelineStage.findMany({
      where: stageWhere,
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        isMandatory: true,
        isTerminal: true,
        canonicalStage: true,
      },
      orderBy: { order: "asc" },
    });

    const candidateStats = computePipelineStats(assignment.pipelines ?? []);

    res.json({
      success: true,
      data: pipelines.map(shapePipelineRow),
      candidateStats,
      pipelineStages,
      requirement: assignment.requirement,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      permissions: {
        canEdit: req.modulePermission?.canEdit,
        canDelete: req.modulePermission?.canDelete,
      },
    });
  } catch (err) {
    console.error("getAssignmentPipeline:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline" });
  }
};
