// File: applicant.controller.ts
// Path: src/controllers/applicant.controller.ts

import { Request, Response } from "express";
import { Prisma, CandidateSnapshotType } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  getApplicantScope,
  resolveRequirementFilter,
} from "@/services/applicant-scope.service";

// Move to shared config if createAssignment uses the same list
const ASSIGNABLE_REQUIREMENT_STATUSES = ["ACTIVE", "PENDING_APPROVAL"];

const ASSIGNMENT_FILTERS = {
  UNASSIGNED: { pipeline: { is: null } },
  ASSIGNED: { pipeline: { isNot: null } },
} as const satisfies Record<string, Prisma.CandidateSnapshotWhereInput>;

type AssignmentFilterKey = keyof typeof ASSIGNMENT_FILTERS;

const NO_ACCESS_MESSAGE = "You don't have access to applicants";

// ─────────────────────────────────────────────────────────────────────────────
// GET /applicants
// ?requirementId=&status=UNASSIGNED|ASSIGNED&search=&from=&to=&page=&limit=
// ─────────────────────────────────────────────────────────────────────────────

export const listApplicants = async (req: Request, res: Response) => {
  try {
    const {
      requirementId,
      status,
      search,
      from,
      to,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string | undefined>;

    const take = Math.min(Math.max(parseInt(limit!, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page!, 10) || 1, 1) - 1) * take;

    // ── Scope ────────────────────────────────────────────────────────────────
    const scope = await getApplicantScope(req.user!);
    const access = resolveRequirementFilter(scope, requirementId);
    if (!access.allowed)
      return res.status(403).json({
        success: false,
        message:
          scope.type === "NONE"
            ? NO_ACCESS_MESSAGE
            : "Requirement not in your scope",
      });

    const baseWhere: Prisma.CandidateSnapshotWhereInput = {
      type: CandidateSnapshotType.APPLICANT,
      ...(access.filter ? { requirementId: access.filter } : {}),
      ...(from || to
        ? {
            snapshotAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { candidateCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const statusFilter =
      status && status in ASSIGNMENT_FILTERS
        ? ASSIGNMENT_FILTERS[status as AssignmentFilterKey]
        : {};

    const where = { ...baseWhere, ...statusFilter };

    const [rows, total, unassignedCount, assignedCount] =
      await prisma.$transaction([
        prisma.candidateSnapshot.findMany({
          where,
          orderBy: { snapshotAt: "desc" },
          skip,
          take,
          select: {
            id: true,
            candidateCode: true,
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            currentCompany: true,
            totalExpYears: true,
            topSkills: true,
            resumeUrl: true,
            sourced: true,
            snapshotAt: true,
            requirement: {
              select: {
                id: true,
                reqCode: true,
                title: true,
                status: true,
                client: { select: { id: true, name: true } },
              },
            },
            pipeline: {
              select: {
                id: true,
                createdAt: true,
                recruiter: {
                  select: { id: true, firstName: true, lastName: true },
                },
                currentStage: {
                  select: {
                    id: true,
                    code: true,
                    label: true,
                    canonicalStage: true,
                  },
                },
                stageUpdatedBy: {
                  select: { id: true, firstName: true, lastName: true },
                },
                // first log entry = the assignment (who assigned + when)
                stageHistory: {
                  orderBy: { createdAt: "asc" },
                  take: 1,
                  select: {
                    createdAt: true,
                    changedBy: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.candidateSnapshot.count({ where }),
        prisma.candidateSnapshot.count({
          where: { ...baseWhere, ...ASSIGNMENT_FILTERS.UNASSIGNED },
        }),
        prisma.candidateSnapshot.count({
          where: { ...baseWhere, ...ASSIGNMENT_FILTERS.ASSIGNED },
        }),
      ]);
    const data = rows.map(({ pipeline, ...rest }) => {
      if (!pipeline) return { ...rest, pipeline: null };
      const { stageHistory, ...p } = pipeline;
      return {
        ...rest,
        pipeline: {
          ...p,
          assignedBy: stageHistory[0]?.changedBy ?? null,
          assignedAt: stageHistory[0]?.createdAt ?? p.createdAt,
        },
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        counts: { UNASSIGNED: unassignedCount, ASSIGNED: assignedCount },
      },
    });
  } catch (err) {
    console.error("listApplicants:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch applicants" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /applicants/assign   body: { snapshotIds: string[], recruiterId: string }
// Recruiter list comes from /users/my-subordinates on the frontend
// ─────────────────────────────────────────────────────────────────────────────

export const assignApplicants = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { snapshotIds, snapshotId, recruiterId } = req.body;

    const ids: string[] = snapshotIds?.length
      ? snapshotIds
      : snapshotId
        ? [snapshotId]
        : [];

    if (!ids.length || !recruiterId)
      return res.status(400).json({
        success: false,
        message: "snapshotIds and recruiterId are required",
      });

    // ── 1. Scope ─────────────────────────────────────────────────────────────
    const scope = await getApplicantScope(req.user!);
    if (scope.type === "NONE")
      return res
        .status(403)
        .json({ success: false, message: NO_ACCESS_MESSAGE });

    const scopeSet =
      scope.type === "REQUIREMENTS" ? new Set(scope.requirementIds) : null;

    // ── 2. Recruiter ─────────────────────────────────────────────────────────
    const recruiter = await prisma.user.findFirst({
      where: { id: recruiterId, isActive: true },
      select: {
        id: true,
        departmentId: true,
        firstName: true,
        lastName: true,
        teamLeadId: true,
        reportingToId: true,
      },
    });
    if (!recruiter)
      return res
        .status(404)
        .json({ success: false, message: "Recruiter not found" });

    // ── 3. Initial stage ─────────────────────────────────────────────────────
    const initialStage = await prisma.pipelineStage.findFirst({
      where: { isSourced: true, isActive: true },
      orderBy: { order: "asc" },
      select: { id: true, label: true, canonicalStage: true },
    });
    if (!initialStage)
      return res.status(500).json({
        success: false,
        message: "No initial pipeline stage configured",
      });

    // ── 4. Load snapshots in one query ───────────────────────────────────────
    const snapshots = await prisma.candidateSnapshot.findMany({
      where: { id: { in: ids }, type: CandidateSnapshotType.APPLICANT },
      select: {
        id: true,
        fullName: true,
        requirementId: true,
        pipeline: { select: { id: true } },
        requirement: {
          select: { status: true, clientId: true, deletedAt: true },
        },
      },
    });
    const snapMap = new Map(snapshots.map((s) => [s.id, s]));

    type ItemResult =
      | { snapshotId: string; status: "assigned"; pipelineId: string }
      | { snapshotId: string; status: "skipped"; reason: string };
    const results: ItemResult[] = [];

    // ── 5. Process each applicant ────────────────────────────────────────────
    for (const id of ids) {
      const snap = snapMap.get(id);
      if (!snap) {
        results.push({
          snapshotId: id,
          status: "skipped",
          reason: "Applicant not found",
        });
        continue;
      }
      if (snap.pipeline) {
        results.push({
          snapshotId: id,
          status: "skipped",
          reason: "Already assigned",
        });
        continue;
      }
      if (scopeSet && !scopeSet.has(snap.requirementId)) {
        results.push({
          snapshotId: id,
          status: "skipped",
          reason: "Requirement not in your scope",
        });
        continue;
      }
      if (
        snap.requirement.deletedAt ||
        !ASSIGNABLE_REQUIREMENT_STATUSES.includes(snap.requirement.status)
      ) {
        results.push({
          snapshotId: id,
          status: "skipped",
          reason: "Requirement not active",
        });
        continue;
      }

      try {
        const pipeline = await prisma.$transaction(async (tx) => {
          // ── 5a. Ensure recruiter has an ACTIVE assignment on this requirement
          let assignment = await tx.requirementAssignment.findFirst({
            where: {
              requirementId: snap.requirementId,
              assignedToId: recruiterId,
              status: "ACTIVE",
            },
            select: { id: true },
          });

          if (!assignment) {
            // parent = actor's assignment, else recruiter's TL / manager's
            const parentCandidates = [
              actorId,
              recruiter.teamLeadId,
              recruiter.reportingToId,
            ].filter((x): x is string => !!x);

            const parent = await tx.requirementAssignment.findFirst({
              where: {
                requirementId: snap.requirementId,
                assignedToId: { in: parentCandidates },
                status: "ACTIVE",
              },
              orderBy: { depth: "desc" },
              select: { id: true, depth: true },
            });

            assignment = await tx.requirementAssignment.create({
              data: {
                requirementId: snap.requirementId,
                assignedToId: recruiterId,
                assignedById: actorId,
                assigneeDepartmentId: recruiter.departmentId ?? null,
                clientId: snap.requirement.clientId,
                depth: parent ? parent.depth + 1 : 0,
                parentAssignmentId: parent?.id ?? null,
                status: "ACTIVE",
              },
              select: { id: true },
            });

            await tx.requirementActivity.create({
              data: {
                requirementId: snap.requirementId,
                actorId,
                type: "RECRUITER_ASSIGNED",
                summary: `Assigned to ${recruiter.firstName} ${recruiter.lastName} (applicant routing)`,
              },
            });
          }

          // ── 5b. Create pipeline at initial stage ─────────────────────────────
          const p = await tx.requirementCandidatePipeline.create({
            data: {
              snapshotId: snap.id,
              requirementId: snap.requirementId,
              assignmentId: assignment.id,
              recruiterId,
              currentStageId: initialStage.id,
              stageUpdatedById: actorId,
            },
            select: { id: true },
          });

          // ── 5c. Stage log ────────────────────────────────────────────────────
          await tx.candidatePipelineStageLog.create({
            data: {
              pipelineId: p.id,
              fromStageId: null,
              toStageId: initialStage.id,
              toCanonicalStage: initialStage.canonicalStage,
              changedById: actorId,
              note: "Applicant assigned to recruiter",
            },
          });

          // ── 5d. Requirement activity ─────────────────────────────────────────
          await tx.requirementActivity.create({
            data: {
              requirementId: snap.requirementId,
              actorId,
              type: "APPLICANT_ASSIGNED",
              summary: `Applicant ${snap.fullName} assigned to ${recruiter.firstName} ${recruiter.lastName}`,
              meta: { snapshotId: snap.id, pipelineId: p.id, recruiterId },
            },
          });

          return p;
        });

        results.push({
          snapshotId: id,
          status: "assigned",
          pipelineId: pipeline.id,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          results.push({
            snapshotId: id,
            status: "skipped",
            reason: "Already assigned",
          });
          continue;
        }
        console.error(`assignApplicants — failed for ${id}:`, err);
        results.push({
          snapshotId: id,
          status: "skipped",
          reason: "Internal error",
        });
      }
    }

    const assigned = results.filter((r) => r.status === "assigned");
    const skipped = results.filter((r) => r.status === "skipped");

    if (ids.length === 1 && skipped.length === 1) {
      const reason = (skipped[0] as any).reason as string;
      const code =
        reason === "Already assigned"
          ? 409
          : reason === "Applicant not found"
            ? 404
            : reason === "Requirement not in your scope"
              ? 403
              : 400;
      return res.status(code).json({ success: false, message: reason });
    }

    return res.status(201).json({
      success: true,
      message: `${assigned.length} applicant(s) assigned${
        skipped.length ? `, ${skipped.length} skipped` : ""
      }`,
      data: { assigned, skipped },
    });
  } catch (err) {
    console.error("assignApplicants:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to assign applicants" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /applicants/requirements?search=&status=&page=&limit=
// Every in-scope requirement with applicant counts (0 when none)
//   ALL   → every live requirement
//   DL/DM → requirements they created OR are actively assigned to
// status (UNASSIGNED / ASSIGNED) → only requirements having such applicants
// meta.summary → scope-wide totals for the stats cards
// ─────────────────────────────────────────────────────────────────────────────

export const listApplicantRequirements = async (
  req: Request,
  res: Response,
) => {
  try {
    const {
      search,
      status,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string | undefined>;

    const take = Math.min(Math.max(parseInt(limit!, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page!, 10) || 1, 1) - 1) * take;

    const scope = await getApplicantScope(req.user!);
    const access = resolveRequirementFilter(scope);
    if (!access.allowed)
      return res
        .status(403)
        .json({ success: false, message: NO_ACCESS_MESSAGE });

    const statusKeys = Object.keys(ASSIGNMENT_FILTERS) as AssignmentFilterKey[];
    const bucket =
      status && status in ASSIGNMENT_FILTERS
        ? (status as AssignmentFilterKey)
        : null;

    // scope only — base for the stats cards (ignores search / tab)
    const scopeWhere: Prisma.RequirementWhereInput = {
      deletedAt: null,
      ...(access.filter ? { id: access.filter } : {}),
    };

    // what the table shows
    const listWhere: Prisma.RequirementWhereInput = {
      ...scopeWhere,
      ...(search
        ? {
            OR: [
              { reqCode: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(bucket
        ? {
            candidateSnapshots: {
              some: {
                type: CandidateSnapshotType.APPLICANT,
                ...ASSIGNMENT_FILTERS[bucket],
              },
            },
          }
        : {}),
    };

    const applicantScope: Prisma.CandidateSnapshotWhereInput = {
      type: CandidateSnapshotType.APPLICANT,
      requirement: scopeWhere,
    };

    const USER_LITE = {
      select: { id: true, firstName: true, lastName: true },
    } as const;

    const [requirements, total, totalRequirements, requirementsWithApplicants] =
      await Promise.all([
        prisma.requirement.findMany({
          where: listWhere,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            createdAt: true,
            client: { select: { name: true } },
            createdBy: USER_LITE,
            assignments: {
              where: { status: "ACTIVE" },
              orderBy: { depth: "asc" },
              select: {
                id: true,
                depth: true,
                assignedTo: USER_LITE,
                assignedBy: USER_LITE,
              },
            },
          },
        }),
        prisma.requirement.count({ where: listWhere }),
        prisma.requirement.count({ where: scopeWhere }),
        prisma.requirement.count({
          where: {
            ...scopeWhere,
            candidateSnapshots: {
              some: { type: CandidateSnapshotType.APPLICANT },
            },
          },
        }),
      ]);

    const reqIds = requirements.map((r) => r.id);

    const [bucketTotals, buckets] = await Promise.all([
      // scope-wide applicant totals per bucket (stats cards)
      Promise.all(
        statusKeys.map((key) =>
          prisma.candidateSnapshot.count({
            where: { ...applicantScope, ...ASSIGNMENT_FILTERS[key] },
          }),
        ),
      ),
      // per-requirement counts for this page
      Promise.all(
        statusKeys.map(async (key) => {
          const rows = await prisma.candidateSnapshot.groupBy({
            by: ["requirementId"],
            where: {
              type: CandidateSnapshotType.APPLICANT,
              requirementId: { in: reqIds },
              ...ASSIGNMENT_FILTERS[key],
            },
            _count: { _all: true },
          });
          return [
            key,
            new Map(rows.map((r) => [r.requirementId, r._count._all])),
          ] as const;
        }),
      ),
    ]);

    const data = requirements.map((r) => {
      const counts = Object.fromEntries(
        buckets.map(([key, map]) => [key, map.get(r.id) ?? 0]),
      ) as Record<AssignmentFilterKey, number>;

      return {
        ...r,
        applicantCount: Object.values(counts).reduce((s, n) => s + n, 0),
        counts,
      };
    });

    const summaryCounts = Object.fromEntries(
      statusKeys.map((key, i) => [key, bucketTotals[i]]),
    ) as Record<AssignmentFilterKey, number>;

    return res.json({
      success: true,
      data,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        assignmentStatuses: statusKeys,
        summary: {
          totalApplicants: bucketTotals.reduce((s, n) => s + n, 0),
          counts: summaryCounts,
          totalRequirements,
          requirementsWithApplicants,
        },
      },
    });
  } catch (err) {
    console.error("listApplicantRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirements" });
  }
};
