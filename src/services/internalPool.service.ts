// File: internalPool.service.ts
// Path: src/services/internalPool.service.ts

import prisma from "@/utils/prisma/client";

// import { prisma } from '@/config/prisma';

// =============================================================================
// SAVED SEARCHES
// =============================================================================

export async function listSavedSearches(
  recruiterId: string,
  requirementId?: string
) {
  return prisma.savedSearch.findMany({
    where: {
      recruiterId,
      ...(requirementId ? { requirementId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createSavedSearch(data: {
  recruiterId: string;
  requirementId?: string;
  assignmentId?: string;
  name: string;
  filters: Record<string, any>;
}) {
  return prisma.savedSearch.create({ data });
}

export async function updateSavedSearch(
  id: string,
  recruiterId: string,
  data: { name?: string; filters?: Record<string, any> }
) {
  // Scope update to owner — recruiters cannot touch each other's saved searches
  const existing = await prisma.savedSearch.findFirst({
    where: { id, recruiterId },
  });
  if (!existing) return null;

  return prisma.savedSearch.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.filters !== undefined ? { filters: data.filters } : {}),
    },
  });
}

export async function deleteSavedSearch(id: string, recruiterId: string) {
  const existing = await prisma.savedSearch.findFirst({
    where: { id, recruiterId },
  });
  if (!existing) return null;

  return prisma.savedSearch.delete({ where: { id } });
}

// Called every time a saved search is run — bumps runCount + lastRunAt
export async function touchSavedSearch(id: string, recruiterId: string) {
  const existing = await prisma.savedSearch.findFirst({
    where: { id, recruiterId },
  });
  if (!existing) return null;

  return prisma.savedSearch.update({
    where: { id },
    data: {
      lastRunAt: new Date(),
      runCount: { increment: 1 },
    },
  });
}

// =============================================================================
// SEARCH ACTIVITY LOG
// Fire and forget — called from controller, never awaited in the hot path.
// =============================================================================

export async function logSearchActivity(data: {
  recruiterId: string;
  requirementId?: string;
  assignmentId?: string;
  filters: Record<string, any>;
  resultCount?: number;
}) {
  return prisma.searchActivityLog.create({ data });
}

// =============================================================================
// SOURCING ACTIVITY LOG
// Fired when recruiter clicks "Add to Requirement" from InternalPool.
// =============================================================================

export async function logSourcingActivity(data: {
  recruiterId: string;
  requirementId: string;
  assignmentId?: string;
  candidateServiceId: string;
  candidateEmail?: string;
  candidateName?: string;
}) {
  return prisma.sourcingActivityLog.create({ data });
}

// =============================================================================
// SNAPSHOT + PIPELINE — source a candidate into a requirement
// Wraps the existing CandidateSnapshot + RequirementCandidatePipeline creation
// in a single transaction. Idempotent — returns existing if already sourced.
// =============================================================================

export async function sourceCandidateToRequirement(data: {
  candidateServiceId: string;
  requirementId: string;
  recruiterId: string;
  assignmentId?: string | null;
  fullName: string;
  email: string;
  phone?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  totalExpYears?: number | null;
  topSkills?: string[];
  resumeUrl?: string | null;
  rawSnapshot: Record<string, any>;
}) {
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
  } = data;

  // ── Idempotency check — already sourced? ──────────────────────────────────
  const existingSnapshot = await prisma.candidateSnapshot.findUnique({
    where: {
      candidateServiceId_requirementId: { candidateServiceId, requirementId },
    },
    include: { pipeline: true },
  });

  if (existingSnapshot) {
    return {
      alreadyExists: true,
      snapshot: existingSnapshot,
      pipeline: existingSnapshot.pipeline,
    };
  }

  // ── Get first sourced pipeline stage ─────────────────────────────────────
  const sourcedStage = await prisma.pipelineStage.findFirst({
    where: {
      isSourced: true,
      isActive: true,
    },
    orderBy: { order: "asc" },
  });

  if (!sourcedStage) {
    throw new Error(
      "No sourced pipeline stage found — check PipelineStage seed data"
    );
  }

  // ── Transaction: snapshot + pipeline row ─────────────────────────────────
  const [snapshot, pipeline] = await prisma.$transaction(async (tx) => {
    const snap = await tx.candidateSnapshot.create({
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
        rawSnapshot,
        sourced: "INTERNAL_POOL",
        type: "CANDIDATE",
        createdById: recruiterId,
      },
    });

    const pipe = await tx.requirementCandidatePipeline.create({
      data: {
        snapshotId: snap.id,
        requirementId,
        recruiterId,
        assignmentId: assignmentId ?? null,
        currentStageId: sourcedStage.id,
        stageUpdatedAt: new Date(),
        stageUpdatedById: recruiterId,
        disposition: "ACTIVE",
      },
    });

    // Write initial stage log
    await tx.candidatePipelineStageLog.create({
      data: {
        pipelineId: pipe.id,
        fromStageId: null,
        toStageId: sourcedStage.id,
        toCanonicalStage: sourcedStage.canonicalStage ?? null,
        changedById: recruiterId,
        timeInPrevStageMins: null,
      },
    });

    return [snap, pipe];
  });

  return { alreadyExists: false, snapshot, pipeline };
}

// =============================================================================
// MONITORING — internal sourcing activity summary
// Used by managers to see if recruiters are using InternalPool vs Naukri.
// =============================================================================

export async function getInternalPoolActivitySummary(filters: {
  recruiterId?: string;
  requirementId?: string;
  from?: string; // ISO date string
  to?: string; // ISO date string
}) {
  const { recruiterId, requirementId, from, to } = filters;

  const dateFilter: any = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const whereBase: any = {
    ...(recruiterId ? { recruiterId } : {}),
    ...(requirementId ? { requirementId } : {}),
    ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
  };

  const [totalSearches, totalSourced, byRecruiter] = await Promise.all([
    prisma.searchActivityLog.count({ where: whereBase }),

    prisma.sourcingActivityLog.count({ where: whereBase }),

    // Per recruiter breakdown
    prisma.sourcingActivityLog.groupBy({
      by: ["recruiterId"],
      where: whereBase,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
  ]);

  return {
    totalSearches,
    totalSourced,
    byRecruiter: byRecruiter.map((r) => ({
      recruiterId: r.recruiterId,
      sourcedCount: r._count.id,
    })),
  };
}
