// File: applicant.controller.ts
// Path: src/controllers/applicant.controller.ts

import { Request, Response } from "express";
import { Prisma, CandidateSnapshotType } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  getApplicantScope,
  resolveRequirementFilter,
} from "@/services/applicant-scope.service";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

// Move to shared config if createAssignment uses the same list
const ASSIGNABLE_REQUIREMENT_STATUSES = ["ACTIVE", "PENDING_APPROVAL"];

// Tabs / buckets — keys are sent to the frontend as-is
const ASSIGNMENT_FILTERS = {
  UNASSIGNED: { pipeline: { is: null } },
  ASSIGNED: { pipeline: { isNot: null } },
} as const satisfies Record<string, Prisma.CandidateSnapshotWhereInput>;

type AssignmentFilterKey = keyof typeof ASSIGNMENT_FILTERS;

const NO_ACCESS_MESSAGE = "You don't have access to applicants";

// Overview charts
const TREND_DAYS = 30;
const TOP_REQUIREMENTS_LIMIT = 5;

const USER_LITE = {
  select: { id: true, firstName: true, lastName: true },
} as const;
// requirement's active assignments — who it's assigned to, and by whom
const ACTIVE_ASSIGNMENTS = {
  where: { status: "ACTIVE" },
  orderBy: { depth: "asc" },
  select: {
    id: true,
    depth: true,
    assignedAt: true,
    assignedTo: USER_LITE,
    assignedBy: USER_LITE,
  },
} as const;
// ─────────────────────────────────────────────────────────────────────────────
// GET /applicants?requirementId=&status=&search=&from=&to=&page=&limit=
// One row per application — same requirement applied by 20 people = 20 rows.
//   data                    → applicant + the requirement they applied to
//   meta.counts             → per-tab counts for the current filters
//   meta.requirementOptions → requirement filter dropdown
//   meta.summary            → scope-wide stats + charts (ignores filters)
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

    const scopeAccess = resolveRequirementFilter(scope);
    const scopeWhere: Prisma.RequirementWhereInput = {
      deletedAt: null,
      ...(scopeAccess.allowed && scopeAccess.filter
        ? { id: scopeAccess.filter }
        : {}),
    };

    // every applicant this user may see
    const applicantScope: Prisma.CandidateSnapshotWhereInput = {
      type: CandidateSnapshotType.APPLICANT,
      requirement: scopeWhere,
    };

    // + dashboard filters (everything except the tab)
    const filteredWhere: Prisma.CandidateSnapshotWhereInput = {
      ...applicantScope,
      ...(requirementId ? { requirementId } : {}),
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
              { currentCompany: { contains: search, mode: "insensitive" } },
              { topSkills: { has: search } },
              {
                requirement: {
                  reqCode: { contains: search, mode: "insensitive" },
                },
              },
              {
                requirement: {
                  title: { contains: search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };

    const statusKeys = Object.keys(ASSIGNMENT_FILTERS) as AssignmentFilterKey[];
    const bucket =
      status && status in ASSIGNMENT_FILTERS
        ? (status as AssignmentFilterKey)
        : null;

    const where: Prisma.CandidateSnapshotWhereInput = {
      ...filteredWhere,
      ...(bucket ? ASSIGNMENT_FILTERS[bucket] : {}),
    };

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (TREND_DAYS - 1));

    const [
      rows,
      total,
      tabCounts,
      summaryCounts,
      perRequirementBuckets,
      totalRequirements,
      recentApplications,
    ] = await Promise.all([
      // table rows — one per application
      prisma.candidateSnapshot.findMany({
        where,
        orderBy: { snapshotAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          candidateCode: true,
          candidateServiceId: true,
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
              client: { select: { name: true } },
              createdBy: USER_LITE,
              assignments: ACTIVE_ASSIGNMENTS,
            },
          },
          pipeline: {
            select: {
              id: true,
              createdAt: true,
              recruiter: USER_LITE,
              currentStage: {
                select: { id: true, label: true, canonicalStage: true },
              },
            },
          },
        },
      }),
      prisma.candidateSnapshot.count({ where }),
      // tab counts — current filters
      Promise.all(
        statusKeys.map((k) =>
          prisma.candidateSnapshot.count({
            where: { ...filteredWhere, ...ASSIGNMENT_FILTERS[k] },
          }),
        ),
      ),
      // stats — scope-wide
      Promise.all(
        statusKeys.map((k) =>
          prisma.candidateSnapshot.count({
            where: { ...applicantScope, ...ASSIGNMENT_FILTERS[k] },
          }),
        ),
      ),
      // applicants per requirement per bucket — requirements tab, dropdown, top chart
      Promise.all(
        statusKeys.map((k) =>
          prisma.candidateSnapshot.groupBy({
            by: ["requirementId"],
            where: { ...applicantScope, ...ASSIGNMENT_FILTERS[k] },
            _count: { _all: true },
          }),
        ),
      ),
      prisma.requirement.count({ where: scopeWhere }),
      // trend
      prisma.candidateSnapshot.findMany({
        where: { ...applicantScope, snapshotAt: { gte: since } },
        select: { snapshotAt: true },
      }),
    ]);

    const toCountMap = (values: number[]) =>
      Object.fromEntries(statusKeys.map((k, i) => [k, values[i]])) as Record<
        AssignmentFilterKey,
        number
      >;

    // requirement options — every in-scope requirement
    //   ALL   → all requirements
    //   DL/DM → created by them OR actively assigned to them
    // with per-bucket applicant counts (0 when none); most applicants first, then newest
    const bucketMaps = perRequirementBuckets.map(
      (rows) => new Map(rows.map((g) => [g.requirementId, g._count._all])),
    );
    const scopedRequirements = await prisma.requirement.findMany({
      where: scopeWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        createdAt: true,
        client: { select: { name: true } },
        createdBy: USER_LITE,
        assignments: ACTIVE_ASSIGNMENTS,
      },
    });
    const requirementOptions = scopedRequirements
      .map((r) => {
        const counts = toCountMap(bucketMaps.map((m) => m.get(r.id) ?? 0));
        return {
          ...r,
          counts,
          count: Object.values(counts).reduce((s, n) => s + n, 0),
        };
      })
      .sort((a, b) => b.count - a.count); // stable sort keeps newest-first within equal counts

    // daily trend (UTC), zero-filled
    const trendMap = new Map<string, number>();
    for (let i = 0; i < TREND_DAYS; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      trendMap.set(d.toISOString().slice(0, 10), 0);
    }
    recentApplications.forEach(({ snapshotAt }) => {
      const key = snapshotAt.toISOString().slice(0, 10);
      if (trendMap.has(key)) trendMap.set(key, trendMap.get(key)! + 1);
    });
    const trend = [...trendMap].map(([date, count]) => ({ date, count }));

    return res.json({
      success: true,
      data: rows,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        assignmentStatuses: statusKeys,
        counts: toCountMap(tabCounts),
        requirementOptions,
        summary: {
          totalApplicants: summaryCounts.reduce((s, n) => s + n, 0),
          counts: toCountMap(summaryCounts),
          totalRequirements,
          requirementsWithApplicants: requirementOptions.filter(
            (o) => o.count > 0,
          ).length,
          trend,
          topRequirements: requirementOptions
            .filter((o) => o.count > 0)
            .slice(0, TOP_REQUIREMENTS_LIMIT),
        },
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
// Creates the pipeline row at the Sourced stage under the chosen recruiter.
// Recruiter list comes from /users/my-subordinates on the frontend.
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

          // ── 5b. Pipeline at initial stage ────────────────────────────────────
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
      const reason = (skipped[0] as { reason: string }).reason;
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
