// File: requirementsController.ts
// Path: src/controllers/requirementsController.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import {
  generateReqCode,
  getRequirementScopeWhere,
} from "@/services/requirementService";
import { PermissionScope } from "@prisma/client";
import {
  BulkUploadResult,
  RowValidationError,
  ValidatedRequirementRow,
} from "@/types/bulkRequirement.type";

import ExcelJS from "exceljs";
import { parseUploadedFile } from "@/utils/bulkRequirementParser";
import { validateRequirementRow } from "@/utils/bulkRequirements";
// ───────────────────────────────────────────────────────────────────
// File: requirementsController.ts
// Path: src/controllers/requirementsController.ts

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE COMPUTATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE COMPUTATION HELPER
//
// Priority chain (strict — each step only fires if its own data is present):
//
//  1. SALE_VALUE  — requirement.saleValue > 0
//                   → saleValue × openings
//
//  2. BAND        — band.value > 0
//                   → band.value × openings
//                   (no salary, no percentage needed)
//
//  3. FIXED_PCT   — client.percentageValue > 0  AND  salaryMin > 0
//                   → salaryMin × (percentageValue / 100) × openings
//                   NOTE: agreementType = FIXED alone is NOT enough.
//                   percentageValue must explicitly exist and be > 0.
//                   If percentage is missing → NOT_FOUND, not SALARY_MIN.
//
//  4. NOT_FOUND   — none of the above have enough data
//                   computedSaleValue = null, saleValueBasis = "NOT_FOUND"
//
// SALARY_MIN alone (without a percentage) is intentionally NOT a valid basis.
// A raw salary number without context (% or band) is not a sale value.
// ─────────────────────────────────────────────────────────────────────────────

export type SaleValueBasis = "SALE_VALUE" | "BAND" | "FIXED_PCT" | "NOT_FOUND";

export function computeSaleValue(input: {
  saleValue?: number | null;
  totalOpenings: number;
  salaryMin?: number | null;
  band?: { value?: number | null } | null;
  client?: { percentageValue?: number | null } | null;
}): {
  computedSaleValue: number | null;
  saleValueBasis: SaleValueBasis;
} {
  const openings = input.totalOpenings ?? 1;

  // 1. Direct sale value
  if (input.saleValue != null && input.saleValue > 0)
    return {
      computedSaleValue: input.saleValue * openings,
      saleValueBasis: "SALE_VALUE",
    };

  // 2. Band value (fixed rupee per opening)
  const bandValue = input.band?.value != null ? Number(input.band.value) : null;
  if (bandValue != null && bandValue > 0)
    return { computedSaleValue: bandValue * openings, saleValueBasis: "BAND" };

  // 3. Fixed percentage — REQUIRES both percentageValue AND salaryMin
  // percentageValue alone = NOT_FOUND. salaryMin alone = NOT_FOUND.
  const pct =
    input.client?.percentageValue != null
      ? Number(input.client.percentageValue)
      : null;
  const salMin = input.salaryMin != null ? Number(input.salaryMin) : null;
  if (pct != null && pct > 0 && salMin != null && salMin > 0)
    return {
      computedSaleValue: salMin * (pct / 100) * openings,
      saleValueBasis: "FIXED_PCT",
    };

  // 4. Not enough data — explicit NOT_FOUND
  return { computedSaleValue: null, saleValueBasis: "NOT_FOUND" };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildRequirementsWhere
// ─────────────────────────────────────────────────────────────────────────────

export async function buildRequirementsWhere(
  filters: {
    search?: string;
    status?: string;
    buId?: string;
    serviceLineId?: string;
    clientId?: string;
    clientSpocId?: string;
    priority?: string;
    createdById?: string;
    dateFrom?: string;
    dateTo?: string;
    noData?: boolean; // filter to requirements with no computable sale value
  },
  userId: string,
  isSuperAdmin: boolean
): Promise<any> {
  const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
  const where: any = { ...scopeWhere, deletedAt: null };
  if (filters.createdById) where.createdById = filters.createdById;
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.clientSpocId) where.clientSpocId = filters.clientSpocId;
  if (filters.serviceLineId) where.serviceLineId = filters.serviceLineId;
  if (filters.buId) where.businessUnit = { ancestorIds: { has: filters.buId } };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo
        ? { lte: new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }
  if (filters.search) {
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" } },
          { reqCode: { contains: filters.search, mode: "insensitive" } },
          { primarySkills: { has: filters.search } },
          { keySkills: { has: filters.search } },
        ],
      },
    ];
  }
  // noData: requirements with no computable sale value
  // = no saleValue AND no band AND no (salaryMin + client.percentageValue)
  if (filters.noData) {
    where.AND = [
      ...(where.AND ?? []),
      {
        saleValue: null,
        band: null,
        OR: [
          { salaryMin: null },
          { client: { percentageValue: null } },
          { client: null },
        ],
      },
    ];
  }
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveManagerSets — walk reportingTo chain upward per creator (batched)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveManagerSets(
  creatorIds: string[]
): Promise<Record<string, Set<string>>> {
  const result: Record<string, Set<string>> = {};
  for (const creatorId of creatorIds) {
    const managers = new Set<string>();
    let currentId: string | null = creatorId;
    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const u = await prisma.user.findUnique({
        where: { id: currentId },
        select: { reportingToId: true },
      });
      if (!u?.reportingToId) break;
      managers.add(u.reportingToId);
      currentId = u.reportingToId;
    }
    result[creatorId] = managers;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// getRequirements
// GET /requirements
//
// Pipeline counting:
//   totalFunnelCount = _count.pipelines (all candidates ever linked, simple)
//   terminalStageCounts = per-terminal-stage candidate counts (isTerminal=true stages only)
//   terminalCount = sum of terminalStageCounts values
//   achievedValue = (terminalCount / totalOpenings) × computedSaleValue
//
// The response also includes:
//   meta.terminalStageDefs — all terminal stage definitions visible to this
//     serviceLineId filter (for frontend to build dynamic columns)
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirements = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      clientSpocId,
      priority,
      createdById,
      dateFrom,
      dateTo,
      noData,
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const where = await buildRequirementsWhere(
      {
        search,
        status,
        buId,
        serviceLineId,
        clientId,
        clientSpocId,
        priority,
        createdById,
        dateFrom,
        dateTo,
        noData: noData === "true",
      },
      userId,
      isSuperAdmin
    );

    const SORTABLE = [
      "createdAt",
      "updatedAt",
      "respondBy",
      "priority",
      "status",
    ];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { createdAt: "desc" as const };

    const [total, requirements] = await Promise.all([
      prisma.requirement.count({ where }),
      prisma.requirement.findMany({
        where,
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          priority: true,
          jobType: true,
          remoteType: true,
          totalOpenings: true,
          city: true,
          state: true,
          country: true,
          primarySkills: true,
          keySkills: true,
          jobOpenFor: true,
          targetDate: true,
          closedAt: true,
          closedById: true,
          closureReason: true,
          jdParseStatus: true,
          respondBy: true,
          isRespondByBreached: true,
          isTurnaroundBreached: true,
          createdAt: true,
          serviceLineId: true,

          saleValue: true,
          salaryMin: true,
          salaryMax: true,
          salaryType: true,
          salaryCurrency: true,

          bandId: true,
          band: {
            select: {
              id: true,
              code: true,
              name: true,
              rangeFrom: true,
              rangeTo: true,
              value: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              agreementType: true,
              percentageValue: true,
            },
          },
          clientSpoc: { select: { id: true, firstName: true, lastName: true } },
          businessUnit: { select: { id: true, name: true } },
          serviceLine: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },

          assignments: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              depth: true,
              allocatedOpenings: true,
              deadline: true,
              assignedTo: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
            orderBy: { depth: "asc" },
          },

          // _count.pipelines = total funnel (all candidates linked to this req)
          _count: { select: { pipelines: true } },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    if (!requirements.length) {
      return res.json({
        success: true,
        data: [],
        meta: {
          total,
          page: parseInt(page),
          limit: take,
          pages: Math.ceil(total / take),
          terminalStageDefs: [],
        },
        permissions: {
          canAdd: req.modulePermission.canAdd,
          canEdit: req.modulePermission.canEdit,
          canDelete: req.modulePermission.canDelete,
        },
      });
    }

    // ── Fetch terminal stage definitions from DB ───────────────────────────────
    // These are the "achieved" stages. Service-line aware:
    //   serviceLineId = null  → applies to ALL requirements
    //   serviceLineId = X     → only for requirements in service line X
    const terminalStageDefs = await prisma.pipelineStage.findMany({
      where: {
        isActive: true,
        isTerminal: true,
        // If a serviceLineId filter is active, only fetch stages relevant to it
        ...(serviceLineId
          ? { OR: [{ serviceLineId: null }, { serviceLineId }] }
          : {}),
      },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        serviceLineId: true,
      },
      orderBy: { order: "asc" },
    });
    const terminalStageIds = terminalStageDefs.map((s) => s.id);

    // ── Count candidates currently in terminal stages per requirement ──────────
    // Simple groupBy: requirementId × currentStageId, filtered to terminal stages only.
    // No scope complexity here — terminal counts are universal (everyone sees achieved).
    const reqIds = requirements.map((r) => r.id);

    const terminalCounts =
      terminalStageIds.length > 0
        ? await prisma.requirementCandidatePipeline.groupBy({
            by: ["requirementId", "currentStageId"],
            where: {
              requirementId: { in: reqIds },
              currentStageId: { in: terminalStageIds },
            },
            _count: { id: true },
          })
        : [];

    // Build map: requirementId → { stageId → count }
    const terminalByReq: Record<string, Record<string, number>> = {};
    for (const tc of terminalCounts) {
      if (!terminalByReq[tc.requirementId])
        terminalByReq[tc.requirementId] = {};
      terminalByReq[tc.requirementId][(tc as any).currentStageId] = (
        tc as any
      )._count.id;
    }

    // ── RBAC: sale value gating ───────────────────────────────────────────────
    const uniqueCreatorIds = [
      ...new Set(requirements.map((r) => r.createdBy.id)),
    ];
    const managerSetByCreator = await resolveManagerSets(uniqueCreatorIds);

    // ── Enrich ────────────────────────────────────────────────────────────────
    const enrichedRequirements = requirements.map((r) => {
      const creatorId = r.createdBy.id;
      const canSeeSale =
        isSuperAdmin ||
        userId === creatorId ||
        (managerSetByCreator[creatorId]?.has(userId) ?? false);

      const { computedSaleValue, saleValueBasis } = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
        band: r.band
          ? { value: r.band.value != null ? Number(r.band.value) : null }
          : null,
        client: r.client
          ? {
              percentageValue:
                r.client.percentageValue != null
                  ? Number(r.client.percentageValue)
                  : null,
            }
          : null,
      });

      // totalFunnelCount — straight from _count.pipelines, no groupBy needed
      const totalFunnelCount = r._count.pipelines;

      // Terminal counts per stage — { stageId: count }
      // Only includes terminal stages relevant to this req's service line
      const reqTerminalCounts = terminalByReq[r.id] ?? {};
      const terminalStageCounts: Record<string, number> = {};
      let terminalCount = 0;
      for (const tsDef of terminalStageDefs) {
        // Stage applies if: no service line restriction, or matches this req's service line
        if (tsDef.serviceLineId && tsDef.serviceLineId !== r.serviceLineId)
          continue;
        const cnt = reqTerminalCounts[tsDef.id] ?? 0;
        terminalStageCounts[tsDef.id] = cnt;
        terminalCount += cnt;
      }

      // achievedValue = (terminalCount / totalOpenings) × computedSaleValue
      // Universal — everyone can see it (it's derived from computedSaleValue which is universal)
      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (terminalCount / r.totalOpenings) * computedSaleValue
          : null;

      const achievedPct =
        r.totalOpenings > 0
          ? Math.min(
              100,
              Math.round((terminalCount / r.totalOpenings) * 1000) / 10
            )
          : 0;

      // Sale value fields — RBAC gated
      const saleFields = canSeeSale
        ? {
            saleValue: r.saleValue,
            salaryMin: r.salaryMin,
            salaryMax: r.salaryMax,
            salaryType: r.salaryType,
            salaryCurrency: r.salaryCurrency,
            band: r.band
              ? {
                  ...r.band,
                  rangeFrom:
                    r.band.rangeFrom != null ? Number(r.band.rangeFrom) : null,
                  rangeTo:
                    r.band.rangeTo != null ? Number(r.band.rangeTo) : null,
                  value: r.band.value != null ? Number(r.band.value) : null,
                }
              : null,
            client: r.client
              ? {
                  ...r.client,
                  percentageValue:
                    r.client.percentageValue != null
                      ? Number(r.client.percentageValue)
                      : null,
                }
              : null,
            computedSaleValue,
            saleValueBasis,
          }
        : {
            saleValue: null,
            salaryMin: null,
            salaryMax: null,
            salaryType: null,
            salaryCurrency: null,
            band: null,
            client: r.client
              ? {
                  id: r.client.id,
                  name: r.client.name,
                  agreementType: null,
                  percentageValue: null,
                }
              : null,
            computedSaleValue, // universal
            saleValueBasis: null,
          };

      return {
        ...r,
        ...saleFields,
        totalFunnelCount, // universal: total candidates in pipeline
        terminalCount, // universal: candidates in terminal stages
        terminalStageCounts, // universal: { stageId → count } for each terminal stage
        achievedValue, // universal: derived from computedSaleValue
        achievedPct, // universal: terminalCount / openings %
      };
    });

    return res.json({
      success: true,
      data: enrichedRequirements,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
        // Terminal stage definitions for this page's filter context
        // Frontend uses these to render one column per terminal stage
        terminalStageDefs: terminalStageDefs.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
          order: s.order,
          serviceLineId: s.serviceLineId,
        })),
      },
      scope: { isSuperAdmin },
      permissions: {
        canAdd: req.modulePermission.canAdd,
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirements" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getSaleValueStats
// GET /requirements/sale-value-stats
// Full dataset (NO page/limit). Aggregates computedSaleValue + achievedValue.
// ─────────────────────────────────────────────────────────────────────────────

export const getSaleValueStats = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      clientSpocId,
      priority,
      createdById,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const where = await buildRequirementsWhere(
      {
        search,
        status,
        buId,
        serviceLineId,
        clientId,
        clientSpocId,
        priority,
        createdById,
        dateFrom,
        dateTo,
      },
      userId,
      isSuperAdmin
    );

    // Minimal select — no page/limit
    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        totalOpenings: true,
        saleValue: true,
        salaryMin: true,
        serviceLineId: true,
        band: { select: { value: true } },
        client: { select: { percentageValue: true } },
      },
    });

    if (!requirements.length) {
      return res.json({
        success: true,
        data: {
          totalRequirements: 0,
          includedCount: 0,
          omittedCount: 0,
          totalSaleValue: 0,
          totalAchievedValue: 0,
          byBasis: {},
        },
      });
    }

    // ── Terminal stage counts — same logic as getRequirements ────────────────
    const reqIds = requirements.map((r) => r.id);
    const terminalStageDefs = await prisma.pipelineStage.findMany({
      where: {
        isActive: true,
        isTerminal: true,
        ...(serviceLineId
          ? { OR: [{ serviceLineId: null }, { serviceLineId }] }
          : {}),
      },
      select: { id: true, serviceLineId: true },
    });
    const terminalStageIds = terminalStageDefs.map((s) => s.id);

    const terminalCounts =
      terminalStageIds.length > 0
        ? await prisma.requirementCandidatePipeline.groupBy({
            by: ["requirementId", "currentStageId"],
            where: {
              requirementId: { in: reqIds },
              currentStageId: { in: terminalStageIds },
            },
            _count: { id: true },
          })
        : [];

    // { reqId → { stageId → count } }
    const terminalByReq: Record<string, Record<string, number>> = {};
    for (const tc of terminalCounts) {
      if (!terminalByReq[tc.requirementId])
        terminalByReq[tc.requirementId] = {};
      terminalByReq[tc.requirementId][(tc as any).currentStageId] = (
        tc as any
      )._count.id;
    }

    let totalSaleValue = 0;
    let totalAchievedValue = 0;
    let omittedCount = 0;
    const byBasis: Record<string, { count: number; total: number }> = {
      SALE_VALUE: { count: 0, total: 0 },
      BAND: { count: 0, total: 0 },
      FIXED_PCT: { count: 0, total: 0 },
      NOT_FOUND: { count: 0, total: 0 },
    };

    for (const r of requirements) {
      const { computedSaleValue, saleValueBasis } = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
        band: r.band
          ? { value: r.band.value != null ? Number(r.band.value) : null }
          : null,
        client: r.client
          ? {
              percentageValue:
                r.client.percentageValue != null
                  ? Number(r.client.percentageValue)
                  : null,
            }
          : null,
      });

      if (saleValueBasis === "NOT_FOUND" || computedSaleValue == null) {
        omittedCount++;
        byBasis["NOT_FOUND"].count++;
      } else {
        totalSaleValue += computedSaleValue;
        byBasis[saleValueBasis].count++;
        byBasis[saleValueBasis].total += computedSaleValue;
        // Terminal achieved value
        const reqTerminal = terminalByReq[r.id] ?? {};
        let termCount = 0;
        for (const tsDef of terminalStageDefs) {
          if (tsDef.serviceLineId && tsDef.serviceLineId !== r.serviceLineId)
            continue;
          termCount += reqTerminal[tsDef.id] ?? 0;
        }
        if (r.totalOpenings > 0) {
          totalAchievedValue +=
            (termCount / r.totalOpenings) * computedSaleValue;
        }
      }
    }

    return res.json({
      success: true,
      data: {
        totalRequirements: requirements.length,
        includedCount: requirements.length - omittedCount,
        omittedCount,
        totalSaleValue,
        totalAchievedValue, // NEW — sum of achievedValue across all matching reqs
        byBasis,
      },
    });
  } catch (err) {
    console.error("getSaleValueStats:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to compute sale value stats" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementsFilters
// GET /requirements/filters
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementsFilters = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
    const baseWhere = { ...scopeWhere, deletedAt: null };

    const [
      businessUnits,
      serviceLines,
      clients,
      clientSpocs,
      createdByUsers,
      statusCounts,
    ] = await Promise.all([
      prisma.businessUnit.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.serviceLine.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.client.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.clientSpoc.findMany({
        where: { isActive: true, requirements: { some: baseWhere } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          client: { select: { id: true, name: true } },
        },
        orderBy: { firstName: "asc" },
      }),
      prisma.requirement.findMany({
        where: baseWhere,
        select: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
        distinct: ["createdById"],
        orderBy: { createdBy: { firstName: "asc" } },
      }),
      prisma.requirement.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { id: true },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        businessUnits,
        serviceLines,
        clients,
        clientSpocs: clientSpocs.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          clientId: s.client.id,
          clientName: s.client.name,
        })),
        createdBy: createdByUsers.map((r) => ({
          id: r.createdBy.id,
          name: `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim(),
        })),
        statusCounts: Object.fromEntries(
          statusCounts.map((s) => [s.status, s._count.id])
        ),
        priorities: ["HIGH", "MEDIUM", "LOW"],
      },
    });
  } catch (err) {
    console.error("getRequirementsFilters:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch filter options" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getRequirementsPipelineSummary
// GET /requirements/pipeline-summary
//
// Returns per-requirement pipeline breakdown using ONLY terminal stages
// (isTerminal = true in PipelineStage).
//
// "Achieved" = candidates currently sitting in any terminal stage.
// No canonical stages. No complex stage mapping. Just terminal.
//
// Service-line aware:
//   stage.serviceLineId = null  → applies to ALL requirements
//   stage.serviceLineId = X     → only for requirements whose serviceLineId = X
//
// Accepts same filters as getRequirements. NO page / NO limit — full dataset.
//
// Response:
// {
//   data: [{
//     requirementId,
//     totalOpenings,
//     totalFunnelCount,          — _count.pipelines (all candidates)
//     terminalCount,             — candidates in ANY terminal stage
//     terminalStageCounts,       — { stageId: count } per terminal stage
//     achievedPct,               — terminalCount / totalOpenings × 100
//     computedSaleValue,         — universal
//     achievedValue,             — (terminalCount / totalOpenings) × computedSaleValue
//   }],
//   meta: {
//     terminalStageDefs: [{ id, code, label, order, serviceLineId }]
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementsPipelineSummary = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      clientSpocId,
      priority,
      createdById,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope = (req.modulePermission?.canViewScope ??
      PermissionScope.OWN) as PermissionScope;

    const where = await buildRequirementsWhere(
      {
        search,
        status,
        buId,
        serviceLineId,
        clientId,
        clientSpocId,
        priority,
        createdById,
        dateFrom,
        dateTo,
      },
      userId,
      isSuperAdmin
    );

    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        totalOpenings: true,
        serviceLineId: true,
        saleValue: true,
        salaryMin: true,
        band: { select: { value: true } },
        client: { select: { percentageValue: true } },
        _count: { select: { pipelines: true } },
      },
    });

    if (!requirements.length) {
      return res.json({
        success: true,
        data: [],
        meta: { pipelineStageDefs: [], terminalStageDefs: [] },
      });
    }

    const reqIds = requirements.map((r) => r.id);
    const slFilter = serviceLineId
      ? { OR: [{ serviceLineId: null }, { serviceLineId }] }
      : {};

    // ── Fetch BOTH stage types from DB ─────────────────────────────────────────
    // pipeline = true  → active pipeline flow stages  (labelled "Pipeline")
    // isTerminal = true → achieved/placed stages       (labelled "Funnel")
    const [pipelineStageDefs, terminalStageDefs] = await Promise.all([
      prisma.pipelineStage.findMany({
        where: {
          isActive: true,
          pipeline: true,
          isTerminal: false,
          ...slFilter,
        },
        select: {
          id: true,
          code: true,
          label: true,
          order: true,
          serviceLineId: true,
        },
        orderBy: { order: "asc" },
      }),
      prisma.pipelineStage.findMany({
        where: { isActive: true, isTerminal: true, ...slFilter },
        select: {
          id: true,
          code: true,
          label: true,
          order: true,
          serviceLineId: true,
        },
        orderBy: { order: "asc" },
      }),
    ]);

    const allTrackedIds = [
      ...pipelineStageDefs.map((s) => s.id),
      ...terminalStageDefs.map((s) => s.id),
    ];

    // ── Single groupBy for all tracked stages ─────────────────────────────────
    const stageCounts =
      allTrackedIds.length > 0
        ? await prisma.requirementCandidatePipeline.groupBy({
            by: ["requirementId", "currentStageId"],
            where: {
              requirementId: { in: reqIds },
              currentStageId: { in: allTrackedIds },
            },
            _count: { id: true },
          })
        : [];

    // Build: { reqId → { stageId → count } }
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts as any[]) {
      if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = {};
      countsByReq[sc.requirementId][sc.currentStageId] = sc._count.id;
    }

    // ── Build per-requirement summary ─────────────────────────────────────────
    const data = requirements.map((r) => {
      const { computedSaleValue } = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
        band: r.band
          ? { value: r.band.value != null ? Number(r.band.value) : null }
          : null,
        client: r.client
          ? {
              percentageValue:
                r.client.percentageValue != null
                  ? Number(r.client.percentageValue)
                  : null,
            }
          : null,
      });

      const reqCounts = countsByReq[r.id] ?? {};

      // Pipeline stage counts (pipeline=true, isTerminal=false)
      const pipelineStageCounts: Record<string, number> = {};
      let totalPipelineCount = 0;
      for (const def of pipelineStageDefs) {
        if (def.serviceLineId && def.serviceLineId !== r.serviceLineId)
          continue;
        const cnt = reqCounts[def.id] ?? 0;
        pipelineStageCounts[def.id] = cnt;
        totalPipelineCount += cnt;
      }

      // Terminal/funnel stage counts (isTerminal=true)
      const terminalStageCounts: Record<string, number> = {};
      let totalFunnelCount = 0;
      for (const def of terminalStageDefs) {
        if (def.serviceLineId && def.serviceLineId !== r.serviceLineId)
          continue;
        const cnt = reqCounts[def.id] ?? 0;
        terminalStageCounts[def.id] = cnt;
        totalFunnelCount += cnt;
      }

      const achievedPct =
        r.totalOpenings > 0
          ? Math.min(
              100,
              Math.round((totalFunnelCount / r.totalOpenings) * 1000) / 10
            )
          : 0;

      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (totalFunnelCount / r.totalOpenings) * computedSaleValue
          : null;

      return {
        requirementId: r.id,
        totalOpenings: r.totalOpenings,
        computedSaleValue,
        // Pipeline (pipeline=true stages)
        pipelineStageCounts, // { stageId → count }
        totalPipelineCount, // sum across pipeline stages
        // Funnel/Terminal (isTerminal=true stages)
        terminalStageCounts, // { stageId → count }
        totalFunnelCount, // sum across terminal stages — THIS is the funnel
        achievedPct,
        achievedValue,
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        // Frontend uses these for column headers
        pipelineStageDefs: pipelineStageDefs.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
          order: s.order,
          serviceLineId: s.serviceLineId,
        })),
        terminalStageDefs: terminalStageDefs.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
          order: s.order,
          serviceLineId: s.serviceLineId,
        })),
      },
    });
  } catch (err) {
    console.error("getRequirementsPipelineSummary:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline summary" });
  }
};

export const exportRequirements = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      clientSpocId,
      priority,
      createdById,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // ── Build where using shared helper (same as getRequirements) ─────────────
    const where = await buildRequirementsWhere(
      {
        search,
        status,
        buId,
        serviceLineId,
        clientId,
        clientSpocId,
        priority,
        createdById,
        dateFrom,
        dateTo,
      },
      userId,
      isSuperAdmin
    );

    // ── Fetch requirements (cap 1000) ─────────────────────────────────────────
    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        priority: true,
        jobType: true,
        remoteType: true,
        totalOpenings: true,
        city: true,
        state: true,
        country: true,
        respondBy: true,
        isRespondByBreached: true,
        isTurnaroundBreached: true,
        createdAt: true,
        serviceLineId: true,

        // Sale value fields (RBAC-gated per row below)
        saleValue: true,
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        salaryCurrency: true,

        band: {
          select: {
            id: true,
            code: true,
            name: true,
            rangeFrom: true,
            rangeTo: true,
            value: true,
          },
        },
        client: {
          select: { name: true, agreementType: true, percentageValue: true },
        },

        // SPOC — always shown (not sensitive)
        clientSpoc: { select: { id: true, firstName: true, lastName: true } },

        businessUnit: { select: { name: true } },
        serviceLine: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    if (!requirements.length) {
      return res
        .status(404)
        .json({ success: false, message: "No requirements found to export" });
    }

    const reqIds = requirements.map((r) => r.id);

    // ── RBAC: resolve manager sets for all unique creators ────────────────────
    const uniqueCreatorIds = [
      ...new Set(requirements.map((r) => r.createdBy.id)),
    ];
    const managerSetByCreator = await resolveManagerSets(uniqueCreatorIds);

    // ── Terminal stages from DB (for "Achieved" columns) ─────────────────────
    // isTerminal = true → candidate has been placed / achieved
    // Scoped by serviceLineId filter if provided (same logic as pipeline summary)
    const terminalStages = await prisma.pipelineStage.findMany({
      where: {
        isActive: true,
        isTerminal: true,
        ...(serviceLineId
          ? { OR: [{ serviceLineId: null }, { serviceLineId }] }
          : {}),
      },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        serviceLineId: true,
      },
      orderBy: { order: "asc" },
    });

    // ── All active stages (for pipeline counts) ───────────────────────────────
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        serviceLineId: true,
        isTerminal: true,
      },
      orderBy: { order: "asc" },
    });
    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    // ── Pipeline counts per requirement ───────────────────────────────────────
    const pipelineCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    // Build per-req stage count map
    const countsByReq: Record<string, Record<string, number>> = {};
    for (const pc of pipelineCounts) {
      if (!countsByReq[pc.requirementId]) countsByReq[pc.requirementId] = {};
      countsByReq[pc.requirementId][(pc as any).currentStageId] =
        (pc as any)._count?.id ?? 0;
    }

    // ── Pipeline rows for Sheet 2 ─────────────────────────────────────────────
    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where: { requirementId: { in: reqIds } },
      select: {
        id: true,
        requirementId: true,
        stageUpdatedAt: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        submittedAt: true,
        offerStatus: true,
        actualJoiningDate: true,
        createdAt: true,
        currentStage: { select: { code: true, label: true, isTerminal: true } },
        recruiter: { select: { firstName: true, lastName: true } },
        snapshot: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            currentCompany: true,
            totalExpYears: true,
            topSkills: true,
          },
        },
        stageHistory: { select: { timeInPrevStageMins: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));

    // ─────────────────────────────────────────────────────────────────────────
    // Build workbook
    // ─────────────────────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // ── Style helpers ─────────────────────────────────────────────────────────
    const mkFill = (argb: string): ExcelJS.Fill => ({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb },
    });
    const WHITE_FONT: Partial<ExcelJS.Font> = {
      color: { argb: "FFFFFFFF" },
      bold: true,
      size: 11,
    };
    const FILLS = {
      darkBlue: mkFill("FF1E3A5F"),
      midBlue: mkFill("FF2D5986"),
      darkGreen: mkFill("FF1A5C2A"),
      midGreen: mkFill("FF2E7D32"),
      purple: mkFill("FF4A148C"),
      lightGreen: mkFill("FFE2EFDA"),
      lightRed: mkFill("FFFCE4D6"),
      lightPurple: mkFill("FFEDE7F6"),
    };
    const STATUS_COLORS: Record<string, string> = {
      ACTIVE: "FF00875A",
      CLOSED: "FFDE350B",
      ON_HOLD: "FFFF991F",
      PENDING_APPROVAL: "FF0052CC",
      DRAFT: "FF6B778C",
      CANCELLED: "FF5E6C84",
    };

    const applyHeader = (row: ExcelJS.Row, fill = FILLS.darkBlue) => {
      row.eachCell((cell) => {
        cell.fill = fill;
        cell.font = WHITE_FONT;
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FF4A90D9" } },
        };
      });
      row.height = 28;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SHEET 1 — Requirements
    // ─────────────────────────────────────────────────────────────────────────
    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    // Fixed info columns — always shown to everyone
    const fixedCols = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Title", key: "title", width: 38 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Client", key: "client", width: 24 },
      { header: "Client SPOC", key: "spoc", width: 22 }, // NEW
      { header: "Agreement", key: "agreementType", width: 14 },
      { header: "Business Unit", key: "bu", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "City", key: "city", width: 16 },
      { header: "Country", key: "country", width: 14 },
      { header: "Job Type", key: "jobType", width: 16 },
      { header: "Remote", key: "remote", width: 12 },
      { header: "Total Openings", key: "openings", width: 14 },
      { header: "Created By", key: "createdBy", width: 22 },
      {
        header: "Created Date",
        key: "createdAt",
        width: 18,
        numFmt: "dd-mmm-yyyy",
      },
      { header: "Days Open", key: "daysOpen", width: 12 },
      {
        header: "Respond By",
        key: "respondBy",
        width: 18,
        numFmt: "dd-mmm-yyyy",
      },
      { header: "SLA Breached?", key: "breached", width: 14 },
      { header: "Total Funnel", key: "totalFunnel", width: 14 }, // everyone sees this
    ];

    // Sale value columns — RBAC-gated (creator + managers see real values; others see — or computed only)
    const saleValueCols = [
      { header: "Band Code", key: "bandCode", width: 12 },
      { header: "Band Name", key: "bandName", width: 18 },
      { header: "Band Range", key: "bandRange", width: 20 },
      { header: "Band Value", key: "bandValue", width: 14 },
      { header: "Client %", key: "clientPct", width: 12 },
      { header: "Salary Min", key: "salaryMin", width: 14 },
      { header: "Salary Max", key: "salaryMax", width: 14 }, // NEW
      { header: "Req. Sale Value", key: "reqSaleValue", width: 16 },
      { header: "Computed Sale Value", key: "computedSaleValue", width: 20 },
      { header: "Sale Basis", key: "saleValueBasis", width: 18 },
    ];

    // Achieved columns — one per terminal stage (dynamic from DB) + totals
    // achievedValue is universal (derived from computedSaleValue which is universal)
    const achievedCols = [
      ...terminalStages.map((s) => ({
        header: `Achieved: ${s.label}`,
        key: `term_${s.id}`,
        width: 18,
      })),
      { header: "Achieved (Total Headcount)", key: "terminalCount", width: 22 },
      { header: "Achieved %", key: "achievedPct", width: 14 },
      { header: "Achieved Value", key: "achievedValue", width: 20 },
    ];

    sheet1.columns = [...fixedCols, ...saleValueCols, ...achievedCols];

    // Group header row (row 1)
    const nFixed = fixedCols.length;
    const nSale = saleValueCols.length;
    const nAchieved = achievedCols.length;

    const groupRow = sheet1.getRow(1);
    groupRow.getCell(1).value = "Requirement Details";
    groupRow.getCell(nFixed + 1).value = "Sale Value (Creator / Manager Only)";
    groupRow.getCell(nFixed + nSale + 1).value = "Achieved (Terminal Stages)";

    sheet1.mergeCells(1, 1, 1, nFixed);
    sheet1.mergeCells(1, nFixed + 1, 1, nFixed + nSale);
    if (nAchieved > 0)
      sheet1.mergeCells(1, nFixed + nSale + 1, 1, nFixed + nSale + nAchieved);

    applyHeader(groupRow);
    groupRow.getCell(nFixed + 1).fill = FILLS.darkGreen;
    groupRow.getCell(nFixed + nSale + 1).fill = FILLS.purple;

    // Column header row (row 2)
    const colHeaderRow = sheet1.getRow(2);
    [...fixedCols, ...saleValueCols, ...achievedCols].forEach((col, i) => {
      colHeaderRow.getCell(i + 1).value = col.header;
    });
    applyHeader(colHeaderRow, FILLS.midBlue);

    // ── Data rows ─────────────────────────────────────────────────────────────
    const now = Date.now();
    let exportTotalSaleValue = 0;
    let exportTotalAchieved = 0;
    let exportOmittedCount = 0;

    for (const r of requirements) {
      const daysOpen = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86400000
      );

      // RBAC check for this row
      const canSeeSale =
        isSuperAdmin ||
        userId === r.createdBy.id ||
        (managerSetByCreator[r.createdBy.id]?.has(userId) ?? false);

      // Compute sale value always
      const band = r.band
        ? {
            value: r.band.value != null ? Number(r.band.value) : null,
            rangeFrom:
              r.band.rangeFrom != null ? Number(r.band.rangeFrom) : null,
            rangeTo: r.band.rangeTo != null ? Number(r.band.rangeTo) : null,
          }
        : null;
      const clientPct =
        r.client?.percentageValue != null
          ? Number(r.client.percentageValue)
          : null;

      const { computedSaleValue, saleValueBasis } = computeSaleValue({
        saleValue: r.saleValue,
        totalOpenings: r.totalOpenings,
        salaryMin: r.salaryMin,
        band: band ? { value: band.value } : null,
        client: { percentageValue: clientPct },
      });

      if (computedSaleValue != null) exportTotalSaleValue += computedSaleValue;
      else exportOmittedCount++;

      // Stage counts for this requirement
      const reqStageCounts = countsByReq[r.id] ?? {};

      // Total funnel across all stages
      const totalFunnel = Object.values(reqStageCounts).reduce(
        (s, n) => s + n,
        0
      );

      // Terminal counts per stage — filter to stages relevant to this req's service line
      const termCountPerStage: Record<string, number> = {};
      let terminalTotal = 0;
      for (const ts of terminalStages) {
        // Stage applies to this req if: stage has no serviceLineId, or matches req's serviceLineId
        if (ts.serviceLineId && ts.serviceLineId !== r.serviceLineId) {
          termCountPerStage[ts.id] = 0;
          continue;
        }
        const cnt = reqStageCounts[ts.id] ?? 0;
        termCountPerStage[ts.id] = cnt;
        terminalTotal += cnt;
      }

      const achievedPct =
        r.totalOpenings > 0
          ? Math.min(100, (terminalTotal / r.totalOpenings) * 100)
          : 0;
      // achievedValue: universal (computed from computedSaleValue which is universal)
      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (terminalTotal / r.totalOpenings) * computedSaleValue
          : null;
      if (achievedValue != null) exportTotalAchieved += achievedValue;

      // Build row data
      const rowData: Record<string, any> = {
        // Fixed
        reqCode: r.reqCode,
        title: r.title,
        status: r.status,
        priority: r.priority,
        client: r.client?.name ?? "",
        spoc: r.clientSpoc
          ? `${r.clientSpoc.firstName} ${r.clientSpoc.lastName}`
          : "",
        agreementType: r.client?.agreementType ?? "",
        bu: r.businessUnit?.name ?? "",
        sl: r.serviceLine?.name ?? "",
        city: r.city ?? "",
        country: r.country ?? "",
        jobType: r.jobType,
        remote: r.remoteType,
        openings: r.totalOpenings,
        createdBy: `${r.createdBy.firstName} ${r.createdBy.lastName}`,
        createdAt: new Date(r.createdAt),
        daysOpen,
        respondBy: r.respondBy ? new Date(r.respondBy) : "",
        breached:
          r.isRespondByBreached || r.isTurnaroundBreached ? "Yes" : "No",
        totalFunnel,

        // Sale value — gated
        bandCode: canSeeSale ? r.band?.code ?? "" : "—",
        bandName: canSeeSale ? r.band?.name ?? "" : "—",
        bandRange:
          canSeeSale && band?.rangeFrom != null && band?.rangeTo != null
            ? `${band.rangeFrom} – ${band.rangeTo}`
            : canSeeSale
            ? ""
            : "—",
        bandValue: canSeeSale ? band?.value ?? "" : "—",
        clientPct: canSeeSale ? clientPct ?? "" : "—",
        salaryMin: canSeeSale ? r.salaryMin ?? "" : "—",
        salaryMax: canSeeSale ? r.salaryMax ?? "" : "—", // NEW
        reqSaleValue: canSeeSale ? r.saleValue ?? "" : "—",
        computedSaleValue: computedSaleValue ?? "", // EVERYONE sees this
        saleValueBasis: canSeeSale ? saleValueBasis ?? "N/A" : "—",

        // Achieved — everyone
        ...Object.fromEntries(
          terminalStages.map((ts) => [
            `term_${ts.id}`,
            termCountPerStage[ts.id] ?? 0,
          ])
        ),
        terminalCount: terminalTotal,
        achievedPct: Math.round(achievedPct * 10) / 10,
        achievedValue: achievedValue ?? "",
      };

      const dataRow = sheet1.addRow(rowData);
      dataRow.height = 20;

      // Status colour
      const sCls = STATUS_COLORS[r.status];
      if (sCls) {
        dataRow.getCell("status").fill = mkFill(sCls);
        dataRow.getCell("status").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      // Breach highlight
      if (r.isRespondByBreached || r.isTurnaroundBreached) {
        dataRow.getCell("breached").fill = mkFill("FFDE350B");
        dataRow.getCell("breached").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      // Sale value cell — green if computed, red-tint if missing
      if (computedSaleValue != null) {
        dataRow.getCell("computedSaleValue").fill = FILLS.lightGreen;
        dataRow.getCell("computedSaleValue").font = { bold: true };
        dataRow.getCell("computedSaleValue").numFmt = "#,##0.00";
      } else {
        dataRow.getCell("computedSaleValue").fill = FILLS.lightRed;
        dataRow.getCell("computedSaleValue").font = {
          color: { argb: "FFDE350B" },
        };
      }

      // Achieved value — purple tint
      if (achievedValue != null && achievedValue > 0) {
        dataRow.getCell("achievedValue").fill = FILLS.lightPurple;
        dataRow.getCell("achievedValue").font = { bold: true };
        dataRow.getCell("achievedValue").numFmt = "#,##0.00";
      }

      // Achieved % — colour scale
      if (achievedPct >= 100) {
        dataRow.getCell("achievedPct").fill = mkFill("FF00875A");
        dataRow.getCell("achievedPct").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      } else if (achievedPct >= 50) {
        dataRow.getCell("achievedPct").fill = mkFill("FFFFE082");
      }

      // Grey out gated cells for non-creator/non-manager
      if (!canSeeSale) {
        [
          "bandCode",
          "bandName",
          "bandRange",
          "bandValue",
          "clientPct",
          "salaryMin",
          "salaryMax",
          "reqSaleValue",
          "saleValueBasis",
        ].forEach((k) => {
          dataRow.getCell(k).font = {
            color: { argb: "FFBDBDBD" },
            italic: true,
          };
        });
      }

      // Date formatting
      dataRow.getCell("createdAt").numFmt = "dd-mmm-yyyy";
      if (r.respondBy) dataRow.getCell("respondBy").numFmt = "dd-mmm-yyyy";
    }

    // ── Summary row ───────────────────────────────────────────────────────────
    const summaryRow = sheet1.addRow({});
    summaryRow.height = 24;
    const svColIdx =
      [...fixedCols, ...saleValueCols].findIndex(
        (c) => c.key === "computedSaleValue"
      ) + 1;
    const achValColIdx = nFixed + nSale + terminalStages.length + 3; // after terminal stage cols + count + pct

    summaryRow.getCell(svColIdx - 1).value = `Total (${
      requirements.length - exportOmittedCount
    } computed, ${exportOmittedCount} no data)`;
    summaryRow.getCell(svColIdx - 1).font = {
      bold: true,
      italic: true,
      size: 10,
      color: { argb: "FF1E3A5F" },
    };

    summaryRow.getCell(svColIdx).value = exportTotalSaleValue;
    summaryRow.getCell(svColIdx).numFmt = "#,##0.00";
    summaryRow.getCell(svColIdx).font = {
      bold: true,
      color: { argb: "FF1A5C2A" },
    };
    summaryRow.getCell(svColIdx).fill = FILLS.lightGreen;

    summaryRow.getCell(achValColIdx).value = exportTotalAchieved;
    summaryRow.getCell(achValColIdx).numFmt = "#,##0.00";
    summaryRow.getCell(achValColIdx).font = {
      bold: true,
      color: { argb: "FF4A148C" },
    };
    summaryRow.getCell(achValColIdx).fill = FILLS.lightPurple;

    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: nFixed + nSale + nAchieved },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SHEET 2 — Candidates (one row per pipeline entry)
    // ─────────────────────────────────────────────────────────────────────────
    const sheet2 = workbook.addWorksheet("Candidates", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet2.columns = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement Title", key: "reqTitle", width: 36 },
      { header: "Service Line", key: "reqSL", width: 18 },
      { header: "Candidate Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Current Title", key: "title", width: 26 },
      { header: "Current Company", key: "company", width: 24 },
      { header: "Exp (yrs)", key: "exp", width: 10 },
      { header: "Top Skills", key: "skills", width: 40 },
      { header: "Current Stage", key: "stage", width: 22 },
      { header: "Is Terminal?", key: "isTerminal", width: 14 }, // NEW
      { header: "Recruiter", key: "recruiter", width: 22 },
      { header: "Added On", key: "addedOn", width: 16, numFmt: "dd-mmm-yyyy" },
      { header: "Days in Current Stage", key: "stageAge", width: 20 },
      { header: "Current Stage Aging", key: "stageAgingLabel", width: 18 },
      { header: "Total Pipeline Days", key: "totalDays", width: 18 },
      { header: "Rejected?", key: "rejected", width: 12 },
      { header: "Withdrawn?", key: "withdrawn", width: 12 },
      { header: "On Hold?", key: "onHold", width: 12 },
      {
        header: "Submitted At",
        key: "submittedAt",
        width: 18,
        numFmt: "dd-mmm-yyyy hh:mm",
      },
      { header: "Offer Status", key: "offerStatus", width: 14 },
      {
        header: "Joining Date",
        key: "joiningDate",
        width: 16,
        numFmt: "dd-mmm-yyyy",
      },
    ];

    applyHeader(sheet2.getRow(1));

    for (const p of pipelines) {
      const r = reqLookup[p.requirementId];
      if (!r) continue;

      const stageAgeMins = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000
      );
      const totalPipelineMins =
        (p.stageHistory ?? []).reduce(
          (sum: number, log: any) => sum + (log.timeInPrevStageMins ?? 0),
          0
        ) + stageAgeMins;

      const dataRow = sheet2.addRow({
        reqCode: r.reqCode,
        reqTitle: r.title,
        reqSL: r.serviceLine?.name ?? "",
        name: p.snapshot?.fullName ?? "",
        email: p.snapshot?.email ?? "",
        phone: p.snapshot?.phone ?? "",
        title: p.snapshot?.currentTitle ?? "",
        company: p.snapshot?.currentCompany ?? "",
        exp: p.snapshot?.totalExpYears ?? "",
        skills: (p.snapshot?.topSkills ?? []).join(", "),
        stage: p.currentStage?.label ?? "",
        isTerminal: p.currentStage?.isTerminal ? "Yes" : "No",
        recruiter: p.recruiter
          ? `${p.recruiter.firstName} ${p.recruiter.lastName}`
          : "",
        addedOn: new Date(p.createdAt),
        stageAge: Math.floor(stageAgeMins / 1440),
        stageAgingLabel: formatAging(stageAgeMins),
        totalDays: Math.floor(totalPipelineMins / 1440),
        rejected: p.isRejected ? "Yes" : "No",
        withdrawn: p.isWithdrawn ? "Yes" : "No",
        onHold: p.isOnHold ? "Yes" : "No",
        submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
        offerStatus: p.offerStatus ?? "",
        joiningDate: p.actualJoiningDate ? new Date(p.actualJoiningDate) : "",
      });

      dataRow.height = 18;
      dataRow.getCell("addedOn").numFmt = "dd-mmm-yyyy";
      if (p.submittedAt) dataRow.getCell("submittedAt").numFmt = "dd-mmm-yyyy";
      if (p.actualJoiningDate)
        dataRow.getCell("joiningDate").numFmt = "dd-mmm-yyyy";

      // Highlight terminal (achieved) rows in green
      if (p.currentStage?.isTerminal) {
        dataRow.getCell("stage").fill = FILLS.lightGreen;
        dataRow.getCell("isTerminal").fill = FILLS.lightGreen;
        dataRow.getCell("isTerminal").font = {
          bold: true,
          color: { argb: "FF1A5C2A" },
        };
      }

      // Grey out rejected/withdrawn
      if (p.isRejected || p.isWithdrawn) {
        dataRow.eachCell((cell) => {
          cell.font = { ...cell.font, color: { argb: "FF9E9E9E" } };
        });
      }
    }

    sheet2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet2.columnCount },
    };

    // ── Stream ────────────────────────────────────────────────────────────────
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `requirements-export-${dateStr}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export requirements" });
  }
};
