// File: requirement.controller.ADDITIONS.ts
// Path: src/controller/requirement.controller.ts  ← ADD these to the existing file

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 1. PATCH getRequirements — add pipelineStageCounts to list response
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * In the existing getRequirements controller, after the [total, requirements]
 * Promise.all call, BEFORE the res.json, add this block:
 */

// ── ADD after `const [total, requirements] = await Promise.all([...])` ────────

/*
// Fetch per-stage counts for all returned requirements in one query
const reqIds = requirements.map((r) => r.id);

const [stageCounts, allStages] = await Promise.all([
  prisma.requirementCandidatePipeline.groupBy({
    by: ["requirementId", "currentStageId"],
    where: { requirementId: { in: reqIds } },
    _count: { id: true },
  }),
  prisma.pipelineStage.findMany({
    where: { isActive: true },
    select: { id: true, code: true, label: true, order: true },
    orderBy: { order: "asc" },
  }),
]);

const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

// Group counts by requirementId
const countsByReq: Record<
  string,
  { stageId: string; code: string; label: string; order: number; count: number }[]
> = {};

for (const sc of stageCounts) {
  const stage = stageById[sc.currentStageId];
  if (!stage) continue;
  if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = [];
  countsByReq[sc.requirementId].push({
    stageId: sc.currentStageId,
    code: stage.code,
    label: stage.label,
    order: stage.order,
    count: sc._count.id,
  });
}

// Sort each list by stage order
for (const key of Object.keys(countsByReq)) {
  countsByReq[key].sort((a, b) => a.order - b.order);
}

// Attach to each requirement
const enrichedRequirements = requirements.map((r) => ({
  ...r,
  pipelineStageCounts: countsByReq[r.id] ?? [],
}));
*/

// ── THEN change `data: requirements` to `data: enrichedRequirements` in res.json ──

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 2. NEW ENDPOINT — PATCH /requirements/:id/candidates/:pipelineId/snapshot
 *    Updates display fields on CandidateSnapshot
 *    Does NOT touch rawSnapshot or candidateServiceId
 * ══════════════════════════════════════════════════════════════════════════════
 */

import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

export const updateCandidateSnapshot = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const actorId = req.user!.id;
    const {
      fullName,
      email,
      phone,
      currentTitle,
      currentCompany,
      totalExpYears,
      topSkills,
      resumeUrl,
    } = req.body;

    // Verify the pipeline belongs to this requirement
    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: { id: pipelineId, requirementId },
      select: { id: true, snapshotId: true },
    });

    if (!pipeline) {
      return res.status(404).json({
        success: false,
        message: "Candidate pipeline not found in this requirement",
      });
    }

    // Build update data — only allow display fields, never rawSnapshot
    const updateData: Record<string, any> = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (currentTitle !== undefined) updateData.currentTitle = currentTitle;
    if (currentCompany !== undefined)
      updateData.currentCompany = currentCompany;
    if (totalExpYears !== undefined)
      updateData.totalExpYears = parseFloat(totalExpYears);
    if (topSkills !== undefined) updateData.topSkills = topSkills;
    if (resumeUrl !== undefined) updateData.resumeUrl = resumeUrl;

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    const updated = await prisma.candidateSnapshot.update({
      where: { id: pipeline.snapshotId },
      data: updateData,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        currentTitle: true,
        currentCompany: true,
        totalExpYears: true,
        topSkills: true,
        resumeUrl: true,
        snapshotAt: true,
      },
    });

    // Log activity
    await prisma.requirementActivity.create({
      data: {
        requirementId,
        actorId,
        type: "STATUS_CHANGED", // reuse — or add CANDIDATE_PROFILE_UPDATED to ActivityType enum
        summary: `Candidate profile manually updated for ${updated.fullName}`,
        meta: { pipelineId, updatedFields: Object.keys(updateData) },
      },
    });

    return res.json({
      success: true,
      message: "Candidate profile updated",
      data: updated,
    });
  } catch (err) {
    console.error("updateCandidateSnapshot:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update candidate profile",
    });
  }
};

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 3. ROUTE — add to requirement.routes.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

/*
// In requirement.routes.ts, add after the existing /:id/candidates/:pipelineId routes:

import { updateCandidateSnapshot } from "@/controller/requirement.controller";

// ── manual snapshot update (when resume wasn't captured correctly)
router.patch(
  "/:id/candidates/:pipelineId/snapshot",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  updateCandidateSnapshot
);
*/

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 4. SLUG — getRequirementById and getRequirementDetail: support id OR slug
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * In BOTH getRequirementById and getRequirementDetail, replace:
 *   where: { id, ...scopeWhere, deletedAt: null }
 *
 * With:
 *   where: {
 *     AND: [
 *       { OR: [{ id }, { slug: id }] },   // `id` param holds either UUID or slug
 *       scopeWhere,
 *       { deletedAt: null },
 *     ],
 *   }
 *
 * Do the same for all sub-routes that receive /:id — they will still get the
 * UUID (from req.params.id after the detail fetch), so no changes needed there.
 */

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 5. VALIDATOR — add to requirement.validators.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

/*
import { z } from "zod";

export const updateSnapshotSchema = z.object({
  fullName:       z.string().min(1).max(200).optional(),
  email:          z.string().email().optional(),
  phone:          z.string().max(20).optional().nullable(),
  currentTitle:   z.string().max(200).optional().nullable(),
  currentCompany: z.string().max(200).optional().nullable(),
  totalExpYears:  z.number().min(0).max(60).optional().nullable(),
  topSkills:      z.array(z.string().max(100)).max(20).optional(),
  resumeUrl:      z.string().url().optional().nullable(),
}).refine(data => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});
*/

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 6. ACTIVITY TYPE — add to schema.prisma enum if you want a proper type
 * ══════════════════════════════════════════════════════════════════════════════
 */

/*
enum ActivityType {
  // ... existing values ...
  CANDIDATE_PROFILE_UPDATED  // ← add this
}
*/

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 7. ANALYTICS ENDPOINT (stub — implement based on your reporting needs)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * GET /requirements/analytics?buId=&clientId=&spocId=&from=&to=
 *
 * Response shape:
 * {
 *   byClient: [{ clientId, clientName, total, byStage: { code, count }[] }],
 *   byBU:     [{ buId, buName, total, byStage: { code, count }[] }],
 *   bySpoc:   [{ spocId, spocName, total, filled, byStage: { code, count }[] }],
 *   overall:  { total, active, rejected, withdrawn, onHold, filled }
 * }
 */

export const getRequirementAnalytics = async (req: Request, res: Response) => {
  try {
    const { buId, clientId, spocId, from, to } = req.query as Record<
      string,
      string
    >;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // Build date range filter
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    // Base pipeline where — scope by user
    // For a recruiter: only their pipelines. For manager+: their tree.
    const pipelineWhere: any = {};
    if (!isSuperAdmin) {
      // Import getSubordinateIds from orgService
      // const subIds = await getSubordinateIds(userId);
      // pipelineWhere.recruiterId = { in: [userId, ...subIds] };
      pipelineWhere.recruiterId = userId; // simplify — expand with org service
    }
    if (clientId) {
      pipelineWhere.requirement = { clientId };
    }
    if (buId) {
      pipelineWhere.requirement = {
        ...(pipelineWhere.requirement ?? {}),
        businessUnit: { ancestorIds: { has: buId } },
      };
    }
    if (Object.keys(dateFilter).length) {
      pipelineWhere.createdAt = dateFilter;
    }

    // ── Stage definitions
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: { id: true, code: true, label: true, order: true },
      orderBy: { order: "asc" },
    });

    // ── Aggregate by client
    const clientAgg = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: pipelineWhere,
      _count: { id: true },
    });

    // Fetch requirement → client mapping for aggregated requirementIds
    const reqIds = [...new Set(clientAgg.map((r) => r.requirementId))];
    const requirements = await prisma.requirement.findMany({
      where: { id: { in: reqIds } },
      select: {
        id: true,
        clientId: true,
        businessUnitId: true,
        clientSpocId: true,
        client: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
        clientSpoc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const reqMap = Object.fromEntries(requirements.map((r) => [r.id, r]));
    const stageMap = Object.fromEntries(allStages.map((s) => [s.id, s]));

    // Build client aggregation
    const byClientMap = new Map<
      string,
      { name: string; stages: Map<string, number> }
    >();
    const byBUMap = new Map<
      string,
      { name: string; stages: Map<string, number> }
    >();
    const bySpocMap = new Map<
      string,
      { name: string; stages: Map<string, number> }
    >();
    let overallTotal = 0;

    for (const row of clientAgg) {
      const req = reqMap[row.requirementId];
      if (!req) continue;
      const stage = stageMap[row.currentStageId];
      if (!stage) continue;
      const cnt = row._count.id;
      overallTotal += cnt;

      // By client
      if (req.client) {
        if (!byClientMap.has(req.clientId)) {
          byClientMap.set(req.clientId, {
            name: req.client.name,
            stages: new Map(),
          });
        }
        const c = byClientMap.get(req.clientId)!;
        c.stages.set(stage.code, (c.stages.get(stage.code) ?? 0) + cnt);
      }

      // By BU
      if (req.businessUnitId && req.businessUnit) {
        if (!byBUMap.has(req.businessUnitId)) {
          byBUMap.set(req.businessUnitId, {
            name: req.businessUnit.name,
            stages: new Map(),
          });
        }
        const b = byBUMap.get(req.businessUnitId)!;
        b.stages.set(stage.code, (b.stages.get(stage.code) ?? 0) + cnt);
      }

      // By SPOC
      if (req.clientSpocId && req.clientSpoc) {
        const spocName = `${req.clientSpoc.firstName} ${req.clientSpoc.lastName}`;
        if (!bySpocMap.has(req.clientSpocId)) {
          bySpocMap.set(req.clientSpocId, {
            name: spocName,
            stages: new Map(),
          });
        }
        const s = bySpocMap.get(req.clientSpocId)!;
        s.stages.set(stage.code, (s.stages.get(stage.code) ?? 0) + cnt);
      }
    }

    const formatAgg = (
      map: Map<string, { name: string; stages: Map<string, number> }>,
      idKey: string
    ) =>
      [...map.entries()].map(([id, val]) => ({
        [idKey]: id,
        name: val.name,
        total: [...val.stages.values()].reduce((s, n) => s + n, 0),
        byStage: allStages.map((st) => ({
          code: st.code,
          label: st.label,
          count: val.stages.get(st.code) ?? 0,
        })),
      }));

    // Overall terminal state counts
    const [rejectedCount, withdrawnCount, onHoldCount] = await Promise.all([
      prisma.requirementCandidatePipeline.count({
        where: { ...pipelineWhere, isRejected: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { ...pipelineWhere, isWithdrawn: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { ...pipelineWhere, isOnHold: true },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        byClient: formatAgg(byClientMap, "clientId"),
        byBU: formatAgg(byBUMap, "buId"),
        bySpoc: formatAgg(bySpocMap, "spocId"),
        overall: {
          total: overallTotal,
          rejected: rejectedCount,
          withdrawn: withdrawnCount,
          onHold: onHoldCount,
        },
        stages: allStages,
      },
    });
  } catch (err) {
    console.error("getRequirementAnalytics:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
    });
  }
};

// ── Add to routes (in requirement.routes.ts, BEFORE /:id routes):
// router.get("/analytics", authenticateUser, scope, getRequirementAnalytics);
