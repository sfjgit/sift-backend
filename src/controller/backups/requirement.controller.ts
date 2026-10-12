// File: requirement.controller.ts
// Path: src/controller/requirement.controller.ts

import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { PermissionScope, Priority, SaleValueBasis } from "@prisma/client";
import {
  generateReqCode,
  getRequirementScopeWhere,
} from "@/services/requirementService";
import { freezeSaleValue } from "@/services/saleValue.service";
import {
  BulkUploadResult,
  RowValidationError,
  ValidatedRequirementRow,
} from "@/types/bulkRequirement.type";
import { sendMail } from "@/utils/mailer";
import { parseUploadedFile } from "@/utils/bulkRequirementParser";
import { validateRequirementRow } from "@/utils/bulkRequirements";
import { updateRequirementSchema } from "@/validators/requirement.validators";
import { getSignedDownloadUrl } from "@/services/s3.service";

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC UTILS
// ─────────────────────────────────────────────────────────────────────────────

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

function formatAgingLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function computeAging(from: Date): { minutes: number; label: string } {
  const diffMs = Date.now() - new Date(from).getTime();
  const totalMins = Math.floor(diffMs / 60000);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60) % 24;
  const days = Math.floor(totalMins / 1440) % 30;
  const months = Math.floor(totalMins / 43200);

  let label = "";
  if (months > 0) label = `${months}mo ${days}d`;
  else if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${mins}m`;
  else label = `${totalMins}m`;

  return { minutes: totalMins, label };
}

// coerce any incoming value to number | null — handles strings, Decimal, empty, NaN
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE — READ SIDE
// Values are FROZEN on the requirement row by saleValue.service.ts.
// Nothing in this file computes sale value — it only reads it.
// ─────────────────────────────────────────────────────────────────────────────

// Fields whose change alters the commercial value → re-freeze on update
const SALE_VALUE_TRIGGERS = [
  "saleValue",
  "totalOpenings",
  "bandId",
  "salaryMin",
  "clientSpocId",
] as const;

// Bucket key for requirements where no basis could be resolved
const NO_BASIS_KEY = "NOT_FOUND";

// Buckets built from the enum — never hardcoded
function emptyBasisBuckets(): Record<string, { count: number; total: number }> {
  const buckets: Record<string, { count: number; total: number }> = {};
  for (const k of Object.values(SaleValueBasis))
    buckets[k] = { count: 0, total: 0 };
  buckets[NO_BASIS_KEY] = { count: 0, total: 0 };
  return buckets;
}

// achieved = placements × value of one opening (DIRECT: total / openings)
function achievedFor(
  perOpeningValue: number | null,
  terminalCount: number
): number | null {
  return perOpeningValue != null
    ? round2(perOpeningValue * terminalCount)
    : null;
}

function pctOf(count: number, openings: number): number {
  return openings > 0
    ? Math.min(100, Math.round((count / openings) * 1000) / 10)
    : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL STAGE HELPERS — shared by list / stats / summary / export
// ─────────────────────────────────────────────────────────────────────────────

type TerminalStageDef = {
  id: string;
  code: string;
  label: string;
  order: number;
  serviceLineId: string | null;
};

async function fetchTerminalStageDefs(
  serviceLineId?: string
): Promise<TerminalStageDef[]> {
  return prisma.pipelineStage.findMany({
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
}

async function fetchTerminalCountsByReq(
  reqIds: string[],
  defs: TerminalStageDef[]
): Promise<Record<string, Record<string, number>>> {
  const stageIds = defs.map((d) => d.id);
  if (!stageIds.length || !reqIds.length) return {};

  const rows = await prisma.requirementCandidatePipeline.groupBy({
    by: ["requirementId", "currentStageId"],
    where: { requirementId: { in: reqIds }, currentStageId: { in: stageIds } },
    _count: { id: true },
  });

  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!out[row.requirementId]) out[row.requirementId] = {};
    out[row.requirementId][row.currentStageId] = row._count.id;
  }
  return out;
}

// Service-line aware: a stage with serviceLineId only counts for matching reqs
function terminalForRequirement(
  defs: TerminalStageDef[],
  counts: Record<string, number> | undefined,
  reqServiceLineId: string | null
): { perStage: Record<string, number>; total: number } {
  const perStage: Record<string, number> = {};
  let total = 0;
  for (const d of defs) {
    if (d.serviceLineId && d.serviceLineId !== reqServiceLineId) continue;
    const c = counts?.[d.id] ?? 0;
    perStage[d.id] = c;
    total += c;
  }
  return { perStage, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getVisibleRecruiterIds(
  userId: string,
  isSuperAdmin: boolean,
  canViewScope: PermissionScope
): Promise<string[] | null> {
  if (isSuperAdmin || canViewScope === PermissionScope.ALL) return null;
  if (canViewScope === PermissionScope.OWN) return [userId];
  if (canViewScope === PermissionScope.TEAM) {
    const teamMembers = await prisma.user.findMany({
      where: { teamLeadId: userId, isActive: true },
      select: { id: true },
    });
    return [userId, ...teamMembers.map((u) => u.id)];
  }
  if (canViewScope === PermissionScope.REPORTING) {
    const reportees = await prisma.user.findMany({
      where: { reportingToId: userId, isActive: true },
      select: { id: true },
    });
    return [userId, ...reportees.map((u) => u.id)];
  }
  const reportees = await prisma.user.findMany({
    where: { reportingToId: userId, isActive: true },
    select: { id: true },
  });
  return [userId, ...reportees.map((u) => u.id)];
}

// Walk reportingTo chain upward per creator — used for sale-value RBAC
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
      const u: { reportingToId: string | null } | null =
        await prisma.user.findUnique({
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

type ListFilters = {
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
};

function readListFilters(q: Record<string, string>): ListFilters {
  return {
    search: q.search,
    status: q.status,
    buId: q.buId,
    serviceLineId: q.serviceLineId,
    clientId: q.clientId,
    clientSpocId: q.clientSpocId,
    priority: q.priority,
    createdById: q.createdById,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
  };
}

export async function buildRequirementsWhere(
  filters: ListFilters,
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
  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/detail
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope: PermissionScope = (req.modulePermission?.canViewScope ??
      PermissionScope.OWN) as PermissionScope;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const requirement = await prisma.requirement.findFirst({
      where: { id, ...scopeWhere, deletedAt: null },
      select: {
        id: true,
        reqCode: true,
        title: true,
        description: true,
        requirementCategory: {
          select: { id: true, name: true, slug: true, description: true },
        },
        status: true,
        priority: true,
        jobType: true,
        remoteType: true,
        jobOpenFor: true,

        city: true,
        state: true,
        country: true,

        primarySkills: true,
        keySkills: true,

        experienceMin: true,
        experienceMax: true,

        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        salaryCurrency: true,
        bonusAmount: true,
        hideSalaryFromCandidate: true,
        showMedianSalary: true,

        education: true,
        functionalArea: true,
        shift: true,

        targetCompanies: true,
        noPoachCompanies: true,

        totalOpenings: true,

        startDate: true,
        targetDate: true,
        respondBy: true,
        turnaroundDays: true,
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

        client: {
          select: {
            id: true,
            name: true,
            industry: true,
            city: true,
            country: true,
          },
        },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true, code: true } },
        clientSpoc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            email: true,
            phone: true,
            isPrimary: true,
            handler: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        closedBy: { select: { id: true, firstName: true, lastName: true } },

        assignments: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            depth: true,
            allocatedOpenings: true,
            filledOpenings: true,
            submissionsCount: true,
            interviewsCount: true,
            deadline: true,
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
          },
          orderBy: { depth: "asc" },
        },

        statusHistory: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            changedAt: true,
            changedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { changedAt: "desc" },
        },

        notes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        },

        documents: {
          select: {
            id: true,
            fileName: true,
            fileKey: true,
            fileType: true,
            content: true,
            isIssue: true,
            issueResolved: true,
            createdAt: true,
            raisedBy: { select: { id: true, firstName: true, lastName: true } },
            resolvedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
            resolvedAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    const isCreatedByMe = requirement.createdBy.id === userId;
    const visibleRecruiterIds = isCreatedByMe
      ? null
      : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

    const serviceLineId = (requirement as any).serviceLine?.id ?? null;
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        serviceLineId: true,
      },
      orderBy: { order: "asc" },
    });
    const relevantStages = allStages.filter(
      (s) => s.serviceLineId === null || s.serviceLineId === serviceLineId
    );

    const recruiterFilter =
      visibleRecruiterIds !== null
        ? { recruiterId: { in: visibleRecruiterIds } }
        : {};

    const [
      stageCounts,
      totalCandidates,
      activeCount,
      rejectedCount,
      withdrawnCount,
      onHoldCount,
    ] = await Promise.all([
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: { requirementId: id, ...recruiterFilter },
        _count: { id: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { requirementId: id, ...recruiterFilter },
      }),
      prisma.requirementCandidatePipeline.count({
        where: {
          requirementId: id,
          isRejected: false,
          isWithdrawn: false,
          ...recruiterFilter,
        },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { requirementId: id, isRejected: true, ...recruiterFilter },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { requirementId: id, isWithdrawn: true, ...recruiterFilter },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { requirementId: id, isOnHold: true, ...recruiterFilter },
      }),
    ]);

    const stageCountMap = Object.fromEntries(
      stageCounts.map((s) => [s.currentStageId, s._count.id])
    );

    const pipelineStageSummary = relevantStages.map((stage) => ({
      id: stage.id,
      code: stage.code,
      label: stage.label,
      order: stage.order,
      count: stageCountMap[stage.id] ?? 0,
    }));

    return res.json({
      success: true,
      data: {
        ...requirement,
        pipelineSummary: {
          total: totalCandidates,
          active: activeCount,
          rejected: rejectedCount,
          withdrawn: withdrawnCount,
          onHold: onHoldCount,
          byStage: pipelineStageSummary,
        },
      },
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirementDetail:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement detail" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/activities
// ─────────────────────────────────────────────────────────────────────────────

export const getActivities = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { page = "1", limit = "30" } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const [total, activities] = await Promise.all([
      prisma.requirementActivity.count({ where: { requirementId } }),
      prisma.requirementActivity.findMany({
        where: { requirementId },
        select: {
          id: true,
          type: true,
          summary: true,
          meta: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    return res.json({
      success: true,
      data: activities,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getActivities:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch activities" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/stats
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const [byStatusRaw, byPriorityRaw, breached, recentlyCreated] =
      await Promise.all([
        prisma.requirement.groupBy({
          by: ["status"],
          where: { ...scopeWhere, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.requirement.groupBy({
          by: ["priority"],
          where: { ...scopeWhere, deletedAt: null, status: "ACTIVE" },
          _count: { _all: true },
        }),
        prisma.requirement.count({
          where: {
            ...scopeWhere,
            deletedAt: null,
            status: { in: ["ACTIVE", "PENDING_APPROVAL"] },
            OR: [{ isRespondByBreached: true }, { isTurnaroundBreached: true }],
          },
        }),
        prisma.requirement.count({
          where: {
            ...scopeWhere,
            deletedAt: null,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    const byStatus = Object.fromEntries(
      byStatusRaw.map((r) => [r.status, r._count._all])
    );
    const byPriority = Object.fromEntries(
      byPriorityRaw.map((r) => [r.priority, r._count._all])
    );

    res.json({
      success: true,
      data: { byStatus, byPriority, breached, recentlyCreated },
    });
  } catch (err) {
    console.error("getRequirementStats:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id  — basic, used by edit forms
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope: PermissionScope = (req.modulePermission?.canViewScope ??
      PermissionScope.OWN) as PermissionScope;

    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const requirement = await prisma.requirement.findFirst({
      where: { id, ...scopeWhere, deletedAt: null },
      select: {
        id: true,
        reqCode: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        jobType: true,
        remoteType: true,
        jobOpenFor: true,
        country: true,
        experienceMin: true,
        experienceMax: true,
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        totalOpenings: true,
        startDate: true,
        targetDate: true,
        respondBy: true,
        turnaroundDays: true,
        closedAt: true,
        isRespondByBreached: true,
        isTurnaroundBreached: true,
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
        jdUploadedAt: true,
        parsedJDId: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,

        // ── Frozen commercials
        bandId: true,
        saleValue: true,
        perOpeningValue: true,
        saleValueBasis: true,

        client: { select: { id: true, name: true, industry: true } },
        businessUnit: { select: { id: true, name: true } },
        serviceLine: { select: { id: true, name: true } },
        clientSpoc: {
          select: {
            id: true,
            isPrimary: true,
            handler: { select: { id: true, firstName: true, lastName: true } },
            serviceLine: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        closedBy: { select: { id: true, firstName: true, lastName: true } },
        statusHistory: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            changedAt: true,
            changedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { changedAt: "desc" },
        },
        notes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    const isCreatedByMe = requirement.createdBy.id === userId;
    const visibleRecruiterIds = isCreatedByMe
      ? null
      : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

    const [allStages, stageCounts] = await Promise.all([
      prisma.pipelineStage.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          label: true,
          order: true,
          serviceLineId: true,
        },
        orderBy: { order: "asc" },
      }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where: {
          requirementId: id,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
        _count: { id: true },
      }),
    ]);

    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    const pipelineStageCounts = stageCounts
      .map((sc) => {
        const stage = stageById[sc.currentStageId];
        if (!stage) return null;
        return {
          stageId: sc.currentStageId,
          code: stage.code,
          label: stage.label,
          order: stage.order,
          count: sc._count.id,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => a.order - b.order);

    res.json({
      success: true,
      data: {
        ...requirement,
        saleValue: toNum(requirement.saleValue),
        perOpeningValue: toNum(requirement.perOpeningValue),
        pipelineStageCounts,
      },
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirementById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/tree
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementTree = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, ...scopeWhere, deletedAt: null },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        totalOpenings: true,
      },
    });

    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    const assignments = await prisma.requirementAssignment.findMany({
      where: { requirementId, status: "ACTIVE" },
      orderBy: { depth: "asc" },
      select: {
        id: true,
        depth: true,
        parentAssignmentId: true,
        status: true,
        allocatedOpenings: true,
        filledOpenings: true,
        submissionsCount: true,
        interviewsCount: true,
        deadline: true,
        deadlineMet: true,
        breachedAt: true,
        assignedAt: true,
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            department: { select: { id: true, name: true } },
          },
        },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        assigneeBU: { select: { id: true, name: true } },
        pipelines: {
          select: {
            id: true,
            recruiterId: true,
            stageUpdatedAt: true,
            isRejected: true,
            isWithdrawn: true,
            isOnHold: true,
            rejectionReason: true,
            currentStage: {
              select: { id: true, code: true, label: true, order: true },
            },
            snapshot: {
              select: {
                id: true,
                candidateServiceId: true,
                fullName: true,
                email: true,
                currentTitle: true,
                currentCompany: true,
                topSkills: true,
              },
            },
          },
          orderBy: { stageUpdatedAt: "desc" },
        },
      },
    });

    const assignmentMap = new Map<string, any>();
    const roots: any[] = [];
    assignments.forEach((a) => assignmentMap.set(a.id, { ...a, children: [] }));
    assignments.forEach((a) => {
      if (a.parentAssignmentId && assignmentMap.has(a.parentAssignmentId)) {
        assignmentMap
          .get(a.parentAssignmentId)
          .children.push(assignmentMap.get(a.id));
      } else {
        roots.push(assignmentMap.get(a.id));
      }
    });

    res.json({ success: true, data: { requirement, assignmentTree: roots } });
  } catch (err) {
    console.error("getRequirementTree:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirement tree" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements
// Sale value is NEVER written directly — freezeSaleValue owns it.
// body.saleValue (optional) = CSM-entered TOTAL → basis DIRECT.
// ─────────────────────────────────────────────────────────────────────────────

export const createRequirement = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const body = req.body;

    // ── Validate SPOC
    const spoc = await prisma.clientSpoc.findUnique({
      where: { id: body.clientSpocId },
      select: {
        clientId: true,
        businessUnitId: true,
        serviceLineId: true,
        isActive: true,
        client: { select: { name: true } },
        serviceLine: { select: { name: true } },
      },
    });

    if (!spoc || !spoc.isActive) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or inactive SPOC" });
    }

    // ── Validate band belongs to client
    if (body.bandId) {
      const band = await prisma.band.findFirst({
        where: { id: body.bandId, clientId: spoc.clientId },
        select: { id: true },
      });
      if (!band) {
        return res.status(400).json({
          success: false,
          message: "Selected band does not belong to this client",
        });
      }
    }

    // ── Dates — turnaround auto-computed, never trusted from client
    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    const targetDate = body.targetDate ? new Date(body.targetDate) : null;
    const turnaroundDays = targetDate
      ? Math.ceil((targetDate.getTime() - startDate.getTime()) / 86_400_000)
      : null;

    const reqCode = await generateReqCode(
      spoc.client?.name ?? "CLNT",
      spoc.serviceLine?.name ?? "SRVC"
    );

    // ── Resolve JD file from ParsedJDLibrary — never trust body.jdFileKey
    let resolvedJdFileKey: string | null = null;
    let resolvedJdFileName: string | null = null;
    let resolvedJdFileType: string | null = null;
    let resolvedParsedJDId: string | null = null;

    if (body.parsedJDId) {
      const parsedJD = await prisma.parsedJDLibrary.findUnique({
        where: { id: body.parsedJDId },
        select: {
          id: true,
          isActive: true,
          jdFileKey: true,
          jdFileName: true,
          jdFileType: true,
        },
      });

      if (!parsedJD || !parsedJD.isActive) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or inactive parsed JD" });
      }

      resolvedJdFileKey = parsedJD.jdFileKey;
      resolvedJdFileName = parsedJD.jdFileName;
      resolvedJdFileType = parsedJD.jdFileType;
      resolvedParsedJDId = parsedJD.id;
    }

    if (body.requirementCategoryId) {
      const category = await prisma.requirementCategory.findUnique({
        where: { id: body.requirementCategoryId },
        select: { id: true, isActive: true },
      });
      if (!category || !category.isActive) {
        return res.status(400).json({
          success: false,
          message: "Invalid or inactive requirement category",
        });
      }
    }

    const requirement = await prisma.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          reqCode,
          title: body.title,
          description: body.description ?? null,
          requirementCategoryId: body.requirementCategoryId ?? null,
          jobType: body.jobType,
          remoteType: body.remoteType,
          priority: body.priority ?? "MEDIUM",
          jobOpenFor: body.jobOpenFor ?? "EXTERNAL",
          totalOpenings: toNum(body.totalOpenings) ?? 1,

          city: body.city ?? null,
          state: body.state ?? null,
          country: body.country ?? null,

          experienceMin: toNum(body.experienceMin),
          experienceMax: toNum(body.experienceMax),

          salaryMin: toNum(body.salaryMin),
          salaryMax: toNum(body.salaryMax),
          salaryType: body.salaryType ?? null,
          salaryCurrency: body.salaryCurrency ?? "INR",
          bonusAmount: toNum(body.bonusAmount),
          hideSalaryFromCandidate: body.hideSalaryFromCandidate ?? false,
          showMedianSalary: body.showMedianSalary ?? false,

          primarySkills: body.primarySkills ?? [],
          keySkills: body.keySkills ?? [],
          targetCompanies: body.targetCompanies ?? [],
          noPoachCompanies: body.noPoachCompanies ?? [],

          education: body.education ?? null,
          functionalArea: body.functionalArea ?? null,
          shift: body.shift ?? null,

          startDate,
          targetDate,
          respondBy: null,
          turnaroundDays,

          jdFileKey: resolvedJdFileKey,
          jdFileName: resolvedJdFileName,
          jdFileType: resolvedJdFileType,
          jdUploadedAt: resolvedJdFileKey ? new Date() : null,
          jdParsedAt: body.jdParsedAt ? new Date(body.jdParsedAt) : null,
          jdParseStatus: body.jdParseStatus ?? null,
          jdParsedFields: body.jdParsedFields ?? [],
          parsedJDId: resolvedParsedJDId,

          clientSpocId: body.clientSpocId,
          clientId: spoc.clientId,
          businessUnitId: spoc.businessUnitId,
          serviceLineId: spoc.serviceLineId,
          status: "ACTIVE",
          createdById: actorId,

          bandId: body.bandId ?? null,
        },
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          createdAt: true,
        },
      });

      const frozen = await freezeSaleValue(
        tx,
        created.id,
        body.saleValue ?? null
      );

      await tx.requirementActivity.create({
        data: {
          requirementId: created.id,
          actorId,
          type: "REQUIREMENT_CREATED",
          summary: `Requirement ${reqCode} created`,
          meta: { saleValueBasis: frozen.saleValueBasis },
        },
      });

      return {
        ...created,
        saleValue: toNum(frozen.saleValue),
        perOpeningValue: toNum(frozen.perOpeningValue),
        saleValueBasis: frozen.saleValueBasis,
      };
    });

    // ── Push to JD library for future cloning (non-fatal, outside transaction)
    try {
      const libraryPayload = {
        title: body.title,
        description: body.description ?? null,
        jobType: body.jobType ?? null,
        remoteType: body.remoteType ?? null,
        experienceMin: toNum(body.experienceMin),
        experienceMax: toNum(body.experienceMax),
        salaryMin: toNum(body.salaryMin),
        salaryMax: toNum(body.salaryMax),
        salaryType: body.salaryType ?? null,
        education: body.education ?? null,
        functionalArea: body.functionalArea ?? null,
        shift: body.shift ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        country: body.country ?? null,
        bonusAmount: toNum(body.bonusAmount),
        primarySkills: body.primarySkills ?? [],
        keySkills: body.keySkills ?? [],
        targetCompanies: body.targetCompanies ?? [],
        noPoachCompanies: body.noPoachCompanies ?? [],
        _source: "requirement",
        _reqCode: reqCode,
        _reqId: requirement.id,
      };

      const existing = await prisma.parsedJDLibrary.findFirst({
        where: {
          title: { equals: body.title, mode: "insensitive" },
          isActive: true,
          requirements: { some: { clientId: spoc.clientId } },
        },
        select: { id: true },
      });

      if (existing) {
        await prisma.parsedJDLibrary.update({
          where: { id: existing.id },
          data: {
            parsedData: libraryPayload,
            parsedById: actorId,
            parsedAt: new Date(),
          },
        });
      } else {
        await prisma.parsedJDLibrary.create({
          data: {
            title: body.title,
            parsedData: libraryPayload,
            parsedById: actorId,
            usageCount: 0,
            usedByIds: [],
            isActive: true,
          },
        });
      }
    } catch (libErr) {
      console.warn(
        "createRequirement: failed to push to JD library (non-fatal)",
        libErr
      );
    }

    return res.status(201).json({
      success: true,
      message: "Requirement created",
      data: requirement,
    });
  } catch (err) {
    console.error("createRequirement:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/duplicate-preview
// requiresSaleValue = true when original is DIRECT — frontend must ask for it
// ─────────────────────────────────────────────────────────────────────────────

export const getDuplicatePreview = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const original = await prisma.requirement.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        description: true,
        jobType: true,
        remoteType: true,
        priority: true,
        jobOpenFor: true,
        totalOpenings: true,
        primarySkills: true,
        keySkills: true,
        targetCompanies: true,
        noPoachCompanies: true,
        city: true,
        state: true,
        country: true,
        experienceMin: true,
        experienceMax: true,
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        salaryCurrency: true,
        bonusAmount: true,
        hideSalaryFromCandidate: true,
        showMedianSalary: true,
        education: true,
        functionalArea: true,
        shift: true,
        bandId: true,
        saleValue: true,
        perOpeningValue: true,
        saleValueBasis: true,
        requirementCategoryId: true,
        clientSpocId: true,
        clientId: true,
        businessUnitId: true,
        serviceLineId: true,
        startDate: true,
        targetDate: true,
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
        jdUploadedAt: true,
        parsedJDId: true,
        client: { select: { name: true } },
        serviceLine: { select: { name: true } },
        clientSpoc: { select: { firstName: true, lastName: true } },
      },
    });

    if (!original) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...original,
        saleValue: toNum(original.saleValue),
        perOpeningValue: toNum(original.perOpeningValue),
        suggestedTitle: `${original.title} (Copy)`,
        requiresSaleValue: original.saleValueBasis === SaleValueBasis.DIRECT,
      },
    });
  } catch (err) {
    console.error("getDuplicatePreview:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch duplicate preview" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/duplicate
// Body: { title, totalOpenings?, saleValue? }
// DIRECT original → saleValue REQUIRED (copying a lump-sum total double counts).
// BAND / FIXED_PCT → re-frozen automatically with the new openings.
// ─────────────────────────────────────────────────────────────────────────────

export const duplicateRequirement = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { id } = req.params;
    const { title, totalOpenings, saleValue } = req.body as {
      title: string;
      totalOpenings?: number;
      saleValue?: number;
    };

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Title must be at least 3 characters",
      });
    }

    const original = await prisma.requirement.findUnique({
      where: { id, deletedAt: null },
      include: {
        client: { select: { name: true } },
        serviceLine: { select: { name: true } },
      },
    });

    if (!original) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    if (
      original.saleValueBasis === SaleValueBasis.DIRECT &&
      saleValue == null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Original has a manually entered sale value. Enter the sale value for this duplicate.",
      });
    }

    const reqCode = await generateReqCode(
      original.client?.name ?? "CLNT",
      original.serviceLine?.name ?? "SRVC"
    );

    const startDate = new Date();
    const targetDate = original.targetDate ?? null;
    const turnaroundDays = targetDate
      ? Math.ceil((targetDate.getTime() - startDate.getTime()) / 86_400_000)
      : null;

    const duplicate = await prisma.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          reqCode,
          title: title.trim(),

          description: original.description,
          jobType: original.jobType,
          remoteType: original.remoteType,
          priority: original.priority,
          jobOpenFor: original.jobOpenFor,
          totalOpenings: totalOpenings ?? original.totalOpenings,

          primarySkills: original.primarySkills,
          keySkills: original.keySkills,
          targetCompanies: original.targetCompanies,
          noPoachCompanies: original.noPoachCompanies,

          city: original.city,
          state: original.state,
          country: original.country,

          experienceMin: original.experienceMin,
          experienceMax: original.experienceMax,

          salaryMin: original.salaryMin,
          salaryMax: original.salaryMax,
          salaryType: original.salaryType,
          salaryCurrency: original.salaryCurrency ?? "INR",
          bonusAmount: original.bonusAmount,
          hideSalaryFromCandidate: original.hideSalaryFromCandidate,
          showMedianSalary: original.showMedianSalary,

          education: original.education,
          functionalArea: original.functionalArea,
          shift: original.shift,

          bandId: original.bandId,
          requirementCategoryId: original.requirementCategoryId,

          clientSpocId: original.clientSpocId,
          clientId: original.clientId,
          businessUnitId: original.businessUnitId,
          serviceLineId: original.serviceLineId,

          jdFileKey: original.jdFileKey,
          jdFileName: original.jdFileName,
          jdFileType: original.jdFileType,
          jdUploadedAt: original.jdUploadedAt,
          jdParsedAt: null,
          jdParseStatus: null,
          jdParsedFields: [],
          parsedJDId: original.parsedJDId,

          startDate,
          targetDate,
          respondBy: null,
          turnaroundDays,

          status: "ACTIVE",
          closureReason: null,
          closedAt: null,
          isRespondByBreached: false,
          isTurnaroundBreached: false,

          createdById: actorId,
          approvedById: null,
          approvedAt: null,
          closedById: null,
        },
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          createdAt: true,
        },
      });

      const frozen = await freezeSaleValue(tx, created.id, saleValue ?? null);

      await tx.requirementActivity.create({
        data: {
          requirementId: created.id,
          actorId,
          type: "REQUIREMENT_CREATED",
          summary: `Requirement ${reqCode} created as a duplicate of ${original.reqCode}`,
          meta: {
            sourceRequirementId: original.id,
            saleValueBasis: frozen.saleValueBasis,
          },
        },
      });

      return {
        ...created,
        saleValue: toNum(frozen.saleValue),
        perOpeningValue: toNum(frozen.perOpeningValue),
        saleValueBasis: frozen.saleValueBasis,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Requirement duplicated successfully",
      data: duplicate,
    });
  } catch (err) {
    console.error("duplicateRequirement:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to duplicate requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/bulk-upload
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ROWS = 50;
const MIN_ROWS = 1;

export const bulkUploadRequirementsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({
        success: false,
        error: "No file uploaded. Send the file under the field name 'file'.",
      });
      return;
    }

    const createdById = req.user!.id;
    const { clientSpocId } = req.body;

    if (!clientSpocId) {
      res.status(400).json({
        success: false,
        error:
          "clientSpocId is required. Select a client and SPOC before uploading.",
      });
      return;
    }

    const spoc = await prisma.clientSpoc.findUnique({
      where: { id: clientSpocId },
      select: {
        clientId: true,
        businessUnitId: true,
        serviceLineId: true,
        isActive: true,
        client: { select: { name: true } },
        serviceLine: { select: { name: true } },
      },
    });

    if (!spoc || !spoc.isActive) {
      res.status(400).json({
        success: false,
        error: "Invalid or inactive SPOC. Select a valid SPOC and try again.",
      });
      return;
    }

    const { clientId, businessUnitId, serviceLineId } = spoc;
    const clientName = spoc.client?.name ?? "CLNT";
    const serviceLineName = spoc.serviceLine?.name ?? "SRVC";

    let rawRows;
    try {
      rawRows = parseUploadedFile(
        file.buffer,
        file.mimetype,
        file.originalname
      );
    } catch (parseError: unknown) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : "Failed to parse file";
      res.status(400).json({ success: false, error: message });
      return;
    }

    if (rawRows.length < MIN_ROWS) {
      res
        .status(400)
        .json({
          success: false,
          error: "The uploaded file contains no data rows.",
        });
      return;
    }

    if (rawRows.length > MAX_ROWS) {
      res.status(400).json({
        success: false,
        error: `Too many rows. Maximum allowed per upload is ${MAX_ROWS}. Found ${rawRows.length} rows.`,
      });
      return;
    }

    // Excel template: 2 instruction rows + 1 header → data starts at row 4. CSV: row 2.
    const isExcel =
      file.originalname.endsWith(".xlsx") || file.originalname.endsWith(".xls");
    const dataRowOffset = isExcel ? 4 : 2;

    const validRows: Array<{
      rowNumber: number;
      data: ValidatedRequirementRow;
    }> = [];
    const allErrors: RowValidationError[] = [];

    rawRows.forEach((raw, index) => {
      const rowNumber = dataRowOffset + index;
      const result = validateRequirementRow(raw, rowNumber);
      if (result.valid && result.data) {
        validRows.push({ rowNumber, data: result.data });
      } else {
        allErrors.push(...result.errors);
      }
    });

    const failedRowNumbers = new Set(allErrors.map((e) => e.row));
    const createableRows = validRows.filter(
      ({ rowNumber }) => !failedRowNumbers.has(rowNumber)
    );

    const createdRequirementIds: string[] = [];
    const rowInsertErrors: RowValidationError[] = [];

    // Rows inserted one by one — a failed row never aborts the rest
    for (const { rowNumber, data } of createableRows) {
      try {
        const duplicate = await prisma.requirement.findFirst({
          where: {
            title: { equals: data.title, mode: "insensitive" },
            clientId,
            deletedAt: null,
          },
          select: { reqCode: true },
        });

        if (duplicate) {
          rowInsertErrors.push({
            row: rowNumber,
            field: "title",
            message: `"${data.title}" already exists for this client (${duplicate.reqCode}). Skipped.`,
          });
          continue;
        }

        const reqCode = await generateReqCode(clientName, serviceLineName);

        const startDate = data.startDate ?? new Date();
        const targetDate = data.targetDate ?? null;
        const turnaroundDays = targetDate
          ? Math.ceil((targetDate.getTime() - startDate.getTime()) / 86_400_000)
          : null;

        // Row insert + freeze are atomic per row
        const created = await prisma.$transaction(async (tx) => {
          const row = await tx.requirement.create({
            data: {
              reqCode,
              title: data.title,
              jobType: data.jobType,
              remoteType: data.remoteType,
              priority: data.priority,
              jobOpenFor: data.jobOpenFor,
              totalOpenings: data.totalOpenings,
              status: data.status,
              primarySkills: data.primarySkills,
              keySkills: data.keySkills,
              city: data.city ?? null,
              state: data.state ?? null,
              country: data.country,
              experienceMin: data.experienceMin ?? null,
              experienceMax: data.experienceMax ?? null,
              salaryMin: data.salaryMin ?? null,
              salaryMax: data.salaryMax ?? null,
              salaryType: data.salaryType ?? null,
              salaryCurrency: data.salaryCurrency,
              hideSalaryFromCandidate: data.hideSalaryFromCandidate,
              education: data.education ?? null,
              functionalArea: data.functionalArea ?? null,
              shift: data.shift ?? null,
              targetCompanies: data.targetCompanies,
              noPoachCompanies: data.noPoachCompanies,
              startDate,
              targetDate,
              respondBy: null,
              turnaroundDays,
              clientId,
              clientSpocId,
              businessUnitId: businessUnitId ?? null,
              serviceLineId: serviceLineId ?? null,
              description: data.description ?? null,
              createdById,
            },
            select: { id: true },
          });

          // Sheet has no band / sale value → falls through to client %
          await freezeSaleValue(tx, row.id, null);
          return row;
        });

        createdRequirementIds.push(created.id);
      } catch (rowErr) {
        console.error(`[bulkUpload] Row ${rowNumber} insert failed:`, rowErr);
        rowInsertErrors.push({
          row: rowNumber,
          field: "insert",
          message: "Failed to create this requirement. Please retry this row.",
        });
      }
    }

    if (createdRequirementIds.length > 0) {
      try {
        await prisma.requirementActivity.createMany({
          data: createdRequirementIds.map((requirementId) => ({
            requirementId,
            actorId: createdById,
            type: "REQUIREMENT_CREATED" as const,
            summary: "Created via bulk upload",
            meta: { source: "bulk_upload" },
          })),
        });
      } catch (activityErr) {
        console.warn(
          "[bulkUpload] Activity log failed (non-fatal):",
          activityErr
        );
      }
    }

    const combinedErrors = [...allErrors, ...rowInsertErrors];
    const totalFailed = failedRowNumbers.size + rowInsertErrors.length;

    const result: BulkUploadResult = {
      totalRows: rawRows.length,
      created: createdRequirementIds.length,
      skipped: 0,
      failed: totalFailed,
      errors: combinedErrors,
      createdRequirementIds,
    };

    const statusCode =
      result.created === 0 ? 422 : result.failed > 0 ? 207 : 201;
    res.status(statusCode).json({ success: result.created > 0, ...result });
  } catch (error) {
    console.error(
      "[bulkUploadRequirementsController] Unexpected error:",
      error
    );
    res
      .status(500)
      .json({
        success: false,
        error: "Internal server error during bulk upload.",
      });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /requirements/:id
// Any SALE_VALUE_TRIGGERS field in body → re-freeze in the same transaction.
//   body.saleValue undefined → keeps existing DIRECT value
//   body.saleValue null      → manual cleared → band / %
//   body.saleValue number    → new manual total
// ─────────────────────────────────────────────────────────────────────────────

export const updateRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    const parsed = updateRequirementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        clientId: true,
        startDate: true,
        targetDate: true,
        reqCode: true,
      },
    });

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    // ── SPOC / client change — derive related IDs from the new SPOC
    let derived: {
      clientSpocId: string;
      clientId: string;
      serviceLineId: string;
      businessUnitId: string;
    } | null = null;

    if (body.clientSpocId !== undefined) {
      const spoc = await prisma.clientSpoc.findUnique({
        where: { id: body.clientSpocId },
        select: {
          clientId: true,
          serviceLineId: true,
          businessUnitId: true,
          isActive: true,
        },
      });

      if (!spoc || !spoc.isActive) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid or inactive SPOC selected",
          });
      }

      derived = {
        clientSpocId: body.clientSpocId,
        clientId: spoc.clientId,
        serviceLineId: spoc.serviceLineId,
        businessUnitId: spoc.businessUnitId,
      };
    }

    // A client switch invalidates the old band (bands belong to a client)
    const clientChanged = !!derived && derived.clientId !== existing.clientId;

    // ── Validate bandId belongs to the (new or existing) client
    if (body.bandId !== undefined && body.bandId !== null) {
      const targetClientId = derived?.clientId ?? existing.clientId;
      const band = await prisma.band.findFirst({
        where: { id: body.bandId, clientId: targetClientId },
        select: { id: true },
      });
      if (!band) {
        return res.status(400).json({
          success: false,
          message: "Selected band does not belong to this client",
        });
      }
    }

    // ── JD file — resolved from parsedJDId, never from body.jdFileKey
    let jdFileUpdates: Record<string, unknown> = {};

    if (body.parsedJDId !== undefined && body.parsedJDId !== null) {
      const parsedJD = await prisma.parsedJDLibrary.findUnique({
        where: { id: body.parsedJDId },
        select: {
          id: true,
          isActive: true,
          jdFileKey: true,
          jdFileName: true,
          jdFileType: true,
        },
      });

      if (!parsedJD || !parsedJD.isActive) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or inactive parsed JD" });
      }

      jdFileUpdates = {
        parsedJDId: parsedJD.id,
        jdFileKey: parsedJD.jdFileKey,
        jdFileName: parsedJD.jdFileName,
        jdFileType: parsedJD.jdFileType,
        jdUploadedAt: parsedJD.jdFileKey ? new Date() : null,
      };
    } else if (body.parsedJDId === null) {
      jdFileUpdates = {
        parsedJDId: null,
        jdFileKey: null,
        jdFileName: null,
        jdFileType: null,
        jdUploadedAt: null,
      };
    }

    // ── Turnaround — recompute when a date changes and caller didn't send it
    let computedTurnaround: number | null | undefined = undefined;

    if (body.turnaroundDays !== undefined) {
      computedTurnaround = body.turnaroundDays;
    } else if (body.startDate !== undefined || body.targetDate !== undefined) {
      const resolvedStart =
        body.startDate !== undefined
          ? body.startDate
            ? new Date(body.startDate)
            : null
          : existing.startDate;

      const resolvedTarget =
        body.targetDate !== undefined
          ? body.targetDate
            ? new Date(body.targetDate)
            : null
          : existing.targetDate;

      if (resolvedStart && resolvedTarget) {
        const days = Math.ceil(
          (resolvedTarget.getTime() - resolvedStart.getTime()) / 86_400_000
        );
        computedTurnaround = days > 0 ? days : null;
      } else {
        computedTurnaround = null;
      }
    }

    // ── Build update data — only fields actually sent (PATCH semantics)
    const data: Record<string, unknown> = {};

    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.jobType !== undefined) data.jobType = body.jobType;
    if (body.remoteType !== undefined) data.remoteType = body.remoteType;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.jobOpenFor !== undefined) data.jobOpenFor = body.jobOpenFor;
    if (body.totalOpenings !== undefined)
      data.totalOpenings = body.totalOpenings;

    if (body.city !== undefined) data.city = body.city;
    if (body.state !== undefined) data.state = body.state;
    if (body.country !== undefined) data.country = body.country;

    if (body.experienceMin !== undefined)
      data.experienceMin = body.experienceMin;
    if (body.experienceMax !== undefined)
      data.experienceMax = body.experienceMax;

    if (body.salaryMin !== undefined) data.salaryMin = body.salaryMin;
    if (body.salaryMax !== undefined) data.salaryMax = body.salaryMax;
    if (body.salaryType !== undefined) data.salaryType = body.salaryType;
    if (body.salaryCurrency !== undefined)
      data.salaryCurrency = body.salaryCurrency;
    if (body.bonusAmount !== undefined) data.bonusAmount = body.bonusAmount;
    if (body.hideSalaryFromCandidate !== undefined)
      data.hideSalaryFromCandidate = body.hideSalaryFromCandidate;
    if (body.showMedianSalary !== undefined)
      data.showMedianSalary = body.showMedianSalary;

    if (body.primarySkills !== undefined)
      data.primarySkills = body.primarySkills;
    if (body.keySkills !== undefined) data.keySkills = body.keySkills;
    if (body.targetCompanies !== undefined)
      data.targetCompanies = body.targetCompanies;
    if (body.noPoachCompanies !== undefined)
      data.noPoachCompanies = body.noPoachCompanies;

    if (body.education !== undefined) data.education = body.education;
    if (body.functionalArea !== undefined)
      data.functionalArea = body.functionalArea;
    if (body.shift !== undefined) data.shift = body.shift;

    if (body.startDate !== undefined)
      data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.targetDate !== undefined)
      data.targetDate = body.targetDate ? new Date(body.targetDate) : null;
    if (body.respondBy !== undefined)
      data.respondBy = body.respondBy ? new Date(body.respondBy) : null;

    if (computedTurnaround !== undefined)
      data.turnaroundDays = computedTurnaround;

    Object.assign(data, jdFileUpdates);

    if (body.jdParsedAt !== undefined)
      data.jdParsedAt = body.jdParsedAt ? new Date(body.jdParsedAt) : null;
    if (body.jdParseStatus !== undefined)
      data.jdParseStatus = body.jdParseStatus;
    if (body.jdParsedFields !== undefined)
      data.jdParsedFields = body.jdParsedFields;

    // Band — null clears; client switch without a new band drops the old one
    if (body.bandId !== undefined) data.bandId = body.bandId ?? null;
    else if (clientChanged) data.bandId = null;

    // NOTE: saleValue is NOT written here — freezeSaleValue owns it

    if (derived) {
      data.clientSpocId = derived.clientSpocId;
      data.clientId = derived.clientId;
      data.serviceLineId = derived.serviceLineId;
      data.businessUnitId = derived.businessUnitId;
    }

    const needsRefreeze = SALE_VALUE_TRIGGERS.some(
      (k) => (body as Record<string, unknown>)[k] !== undefined
    );

    const updated = await prisma.$transaction(async (tx) => {
      await tx.requirement.update({ where: { id }, data });

      if (needsRefreeze) {
        await freezeSaleValue(
          tx,
          id,
          (body as Record<string, unknown>).saleValue as any
        );
      }

      await tx.requirementActivity.create({
        data: {
          requirementId: id,
          actorId,
          type: "STATUS_CHANGED",
          summary: derived
            ? `Client/SPOC changed on ${existing.reqCode}`
            : `Requirement ${existing.reqCode} updated`,
          meta: {
            ...(derived
              ? {
                  newClientId: derived.clientId,
                  newSpocId: derived.clientSpocId,
                  newServiceLineId: derived.serviceLineId,
                  newBusinessUnitId: derived.businessUnitId,
                }
              : {}),
            ...(needsRefreeze ? { saleValueRefrozen: true } : {}),
          },
        },
      });

      return tx.requirement.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          reqCode: true,
          title: true,
          status: true,
          updatedAt: true,
          totalOpenings: true,
          client: { select: { id: true, name: true } },
          clientSpoc: { select: { id: true, firstName: true, lastName: true } },
          serviceLine: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
          bandId: true,
          saleValue: true,
          perOpeningValue: true,
          saleValueBasis: true,
        },
      });
    });

    return res.json({
      success: true,
      message: "Requirement updated",
      data: {
        ...updated,
        saleValue: toNum(updated.saleValue),
        perOpeningValue: toNum(updated.perOpeningValue),
      },
    });
  } catch (err) {
    console.error("updateRequirement:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/viewJd
// Signed URLs are generated on demand — never stored.
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementJDSignedUrl = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const requirement = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { jdFileKey: true, jdFileName: true, jdFileType: true },
    });

    if (requirement) {
      if (!requirement.jdFileKey) {
        return res.status(404).json({
          success: false,
          message: "No JD file attached to this requirement",
        });
      }

      const url = await getSignedDownloadUrl(requirement.jdFileKey);

      return res.json({
        success: true,
        url,
        fileName: requirement.jdFileName,
        fileType: requirement.jdFileType,
      });
    }

    const parsedJD = await prisma.parsedJDLibrary.findFirst({
      where: { id, isActive: true },
      select: { jdFileKey: true, jdFileName: true, jdFileType: true },
    });

    if (parsedJD) {
      if (!parsedJD.jdFileKey) {
        return res
          .status(404)
          .json({ success: false, message: "No JD file attached" });
      }

      const url = await getSignedDownloadUrl(parsedJD.jdFileKey);

      return res.json({
        success: true,
        url,
        fileName: parsedJD.jdFileName,
        fileType: parsedJD.jdFileType,
      });
    }

    return res.status(404).json({ success: false, message: "JD not found" });
  } catch (err) {
    console.error("getRequirementJDSignedUrl:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to generate JD download URL" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /requirements/:id/status
// ─────────────────────────────────────────────────────────────────────────────

export const updateRequirementStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const actorId = req.user!.id;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        reqCode: true,
        title: true,
        priority: true,
        totalOpenings: true,
        client: { select: { name: true } },
        serviceLine: { select: { name: true } },
      },
    });

    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    if (existing.status === status)
      return res
        .status(400)
        .json({ success: false, message: "Already in this status" });

    const data: any = { status };
    if (status === "ACTIVE") {
      data.approvedById = actorId;
      data.approvedAt = new Date();
    }
    if (status === "CLOSED" || status === "CANCELLED") {
      data.closedById = actorId;
      data.closedAt = new Date();
    }

    const [updated] = await prisma.$transaction([
      prisma.requirement.update({
        where: { id },
        data,
        select: { id: true, reqCode: true, status: true },
      }),
      prisma.requirementStatusHistory.create({
        data: {
          requirementId: id,
          fromStatus: existing.status,
          toStatus: status,
          changedById: actorId,
          reason: reason ?? null,
        },
      }),
      prisma.requirementActivity.create({
        data: {
          requirementId: id,
          actorId,
          type: "STATUS_CHANGED",
          summary: `Status changed from ${existing.status} to ${status}`,
          meta: { reason },
        },
      }),
    ]);

    // ── respond immediately
    res.json({ success: true, message: "Status updated", data: updated });

    // ── email active assignees (non-blocking)
    try {
      const activeAssignments = await prisma.requirementAssignment.findMany({
        where: { requirementId: id, status: "ACTIVE" },
        select: {
          assignedTo: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
      });

      if (activeAssignments.length === 0) return;

      const statusColors: Record<string, string> = {
        ACTIVE: "#00875A",
        ON_HOLD: "#FF991F",
        CLOSED: "#DE350B",
        CANCELLED: "#DE350B",
        PENDING_APPROVAL: "#0052CC",
      };
      const badgeColor = statusColors[status] ?? "#6B778C";
      const reqUrl = `${process.env.FRONTEND_URL}/assignments`;

      await Promise.allSettled(
        activeAssignments.map(({ assignedTo }) =>
          sendMail({
            to: assignedTo.email,
            subject: `Requirement ${existing.reqCode} status changed to ${status}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1E3A5F;">Requirement Status Update</h2>

                <p>Hi ${assignedTo.firstName},</p>

                <p>
                  A requirement assigned to you has had its status updated.
                </p>

                <table style="width:100%; border-collapse:collapse; margin: 20px 0;">
                  <tr style="background:#f0f4f8;">
                    <td style="padding:10px; font-weight:bold; width:40%;">Req Code</td>
                    <td style="padding:10px;">${existing.reqCode}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; font-weight:bold;">Title</td>
                    <td style="padding:10px;">${existing.title}</td>
                  </tr>
                  <tr style="background:#f0f4f8;">
                    <td style="padding:10px; font-weight:bold;">Client</td>
                    <td style="padding:10px;">${
                      existing.client?.name ?? "—"
                    }</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; font-weight:bold;">Service Line</td>
                    <td style="padding:10px;">${
                      existing.serviceLine?.name ?? "—"
                    }</td>
                  </tr>
                  <tr style="background:#f0f4f8;">
                    <td style="padding:10px; font-weight:bold;">Previous Status</td>
                    <td style="padding:10px;">${existing.status}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; font-weight:bold;">New Status</td>
                    <td style="padding:10px;">
                      <span style="
                        background: ${badgeColor};
                        color: white;
                        padding: 4px 10px;
                        border-radius: 4px;
                        font-weight: bold;
                        font-size: 13px;
                      ">${status}</span>
                    </td>
                  </tr>
                  ${
                    reason
                      ? `<tr style="background:#f0f4f8;">
                          <td style="padding:10px; font-weight:bold;">Reason</td>
                          <td style="padding:10px;">${reason}</td>
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
                  View Requirement
                </a>

                <p style="color: #6B7280; font-size: 13px; margin-top: 24px;">
                  This is an automated notification from your ATS.
                </p>
              </div>
            `,
          })
        )
      );
    } catch (mailErr) {
      console.error("updateRequirementStatus: email failed:", mailErr);
    }
  } catch (err) {
    console.error("updateRequirementStatus:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /requirements/:id  — soft delete
// ─────────────────────────────────────────────────────────────────────────────

export const deleteRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    if (existing.status === "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete an active requirement. Close it first.",
      });
    }
    await prisma.requirement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return res.json({ success: true, message: "Requirement deleted" });
  } catch (err) {
    console.error("deleteRequirement:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete requirement" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /requirements/:id/assignments
// ─────────────────────────────────────────────────────────────────────────────

export const createAssignment = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const { assignedToId, assignedToIds, deadline, parentAssignmentId } =
      req.body;
    const actorId = req.user!.id;

    const ids: string[] = assignedToIds?.length
      ? assignedToIds
      : [assignedToId];

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, status: true, clientId: true, reqCode: true },
    });
    if (!requirement)
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });

    if (!["ACTIVE", "PENDING_APPROVAL"].includes(requirement.status))
      return res.status(400).json({
        success: false,
        message: "Can only assign on active requirements",
      });

    let depth = 0;
    if (parentAssignmentId) {
      const parent = await prisma.requirementAssignment.findUnique({
        where: { id: parentAssignmentId },
        select: { depth: true },
      });
      if (!parent)
        return res
          .status(404)
          .json({ success: false, message: "Parent assignment not found" });
      depth = parent.depth + 1;
    }

    const existingActive = await prisma.requirementAssignment.findMany({
      where: { requirementId, assignedToId: { in: ids }, status: "ACTIVE" },
      select: { assignedToId: true },
    });
    const alreadyAssigned = new Set(existingActive.map((e) => e.assignedToId));

    const assigneeUsers = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, departmentId: true, firstName: true, lastName: true },
    });
    const assigneeMap = new Map(assigneeUsers.map((u) => [u.id, u]));

    type ItemResult =
      | { assignedToId: string; status: "created"; assignment: object }
      | { assignedToId: string; status: "skipped"; reason: string };

    const results: ItemResult[] = [];

    for (const uid of ids) {
      if (alreadyAssigned.has(uid)) {
        results.push({
          assignedToId: uid,
          status: "skipped",
          reason: "Already actively assigned",
        });
        continue;
      }
      const assignee = assigneeMap.get(uid);
      if (!assignee) {
        results.push({
          assignedToId: uid,
          status: "skipped",
          reason: "User not found",
        });
        continue;
      }

      try {
        const assignment = await prisma.$transaction(async (tx) => {
          const a = await tx.requirementAssignment.create({
            data: {
              requirementId,
              assignedToId: uid,
              assignedById: actorId,
              assigneeDepartmentId: assignee.departmentId ?? null,
              clientId: requirement.clientId,
              depth,
              parentAssignmentId: parentAssignmentId ?? null,
              deadline: deadline ? new Date(deadline) : null,
              status: "ACTIVE",
            },
            select: {
              id: true,
              depth: true,
              status: true,
              deadline: true,
              assignedAt: true,
              assignedTo: {
                select: { id: true, firstName: true, lastName: true },
              },
              assignedBy: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          });
          await tx.requirementActivity.create({
            data: {
              requirementId,
              actorId,
              type: "RECRUITER_ASSIGNED",
              summary: `Assigned to ${a.assignedTo.firstName} ${a.assignedTo.lastName}`,
            },
          });
          return a;
        });

        results.push({ assignedToId: uid, status: "created", assignment });
        alreadyAssigned.add(uid);
      } catch (err) {
        console.error(`createAssignment — failed for ${uid}:`, err);
        results.push({
          assignedToId: uid,
          status: "skipped",
          reason: "Internal error",
        });
      }
    }

    const created = results.filter((r) => r.status === "created");
    const skipped = results.filter((r) => r.status === "skipped");

    if (ids.length === 1) {
      if (created.length === 1) {
        const createdAssignment = (created[0] as any).assignment;

        res.status(201).json({
          success: true,
          message: "Assignment created",
          data: createdAssignment,
        });

        // ── email after response
        try {
          const assigneeUser = await prisma.user.findUnique({
            where: { id: ids[0] },
            select: { email: true, firstName: true, lastName: true },
          });

          const fullReq = await prisma.requirement.findUnique({
            where: { id: requirementId },
            select: {
              reqCode: true,
              title: true,
              description: true,
              priority: true,
              totalOpenings: true,
              respondBy: true,
              primarySkills: true,
              experienceMin: true,
              experienceMax: true,
              client: { select: { name: true } },
              serviceLine: { select: { name: true } },
            },
          });

          if (assigneeUser && fullReq) {
            const deadlineStr = deadline
              ? new Date(deadline).toDateString()
              : "Not set";
            const expRange =
              fullReq.experienceMin != null || fullReq.experienceMax != null
                ? `${fullReq.experienceMin ?? 0} – ${
                    fullReq.experienceMax ?? "?"
                  } yrs`
                : "Not specified";

            await sendMail({
              to: assigneeUser.email,
              subject: `New Requirement Assigned: ${fullReq.reqCode} – ${fullReq.title}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1E3A5F;">You have a new requirement assigned</h2>
                  <p>Hi ${assigneeUser.firstName},</p>
                  <p><strong>${req.user!.firstName} ${
                req.user!.lastName
              }</strong> has assigned the following requirement to you.</p>
                  <table style="width:100%; border-collapse:collapse; margin: 20px 0;">
                    <tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold; width:40%;">Req Code</td>
                      <td style="padding:10px;">${fullReq.reqCode}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Title</td>
                      <td style="padding:10px;">${fullReq.title}</td>
                    </tr>
                    <tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold;">Client</td>
                      <td style="padding:10px;">${
                        fullReq.client?.name ?? "—"
                      }</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Service Line</td>
                      <td style="padding:10px;">${
                        fullReq.serviceLine?.name ?? "—"
                      }</td>
                    </tr>
                    <tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold;">Priority</td>
                      <td style="padding:10px;">${fullReq.priority}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Total Openings</td>
                      <td style="padding:10px;">${fullReq.totalOpenings}</td>
                    </tr>
                    <tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold;">Experience</td>
                      <td style="padding:10px;">${expRange}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Primary Skills</td>
                      <td style="padding:10px;">${
                        (fullReq.primarySkills ?? []).join(", ") || "—"
                      }</td>
                    </tr>
                    <tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold;">Your Deadline</td>
                      <td style="padding:10px;">${deadlineStr}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Respond By</td>
                      <td style="padding:10px;">${
                        fullReq.respondBy
                          ? new Date(fullReq.respondBy).toDateString()
                          : "Not set"
                      }</td>
                    </tr>
                    ${
                      fullReq.description
                        ? `<tr style="background:#f0f4f8;">
                          <td style="padding:10px; font-weight:bold;">Description</td>
                          <td style="padding:10px;">${fullReq.description}</td>
                        </tr>`
                        : ""
                    }
                  </table>
                  <a href="${process.env.FRONTEND_URL}/assignments" style="
                    display:inline-block; padding:12px 24px;
                    background:#1E3A5F; color:white;
                    text-decoration:none; border-radius:6px; font-weight:bold;">
                    View Assignment
                  </a>
                  <p style="color:#6B7280; font-size:13px; margin-top:24px;">
                    This is an automated notification from your ATS.
                  </p>
                </div>
              `,
            });
          }
        } catch (mailErr) {
          console.error("createAssignment: email failed:", mailErr);
        }

        return;
      } else {
        const reason = (skipped[0] as any)?.reason ?? "Failed";
        const statusCode =
          reason === "Already actively assigned"
            ? 409
            : reason === "User not found"
            ? 404
            : 400;
        return res.status(statusCode).json({ success: false, message: reason });
      }
    }

    return res.status(201).json({
      success: true,
      message: `${created.length} assignment(s) created${
        skipped.length > 0 ? `, ${skipped.length} skipped` : ""
      }`,
      data: { created, skipped },
    });
  } catch (err) {
    console.error("createAssignment:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /requirements/:id/assignments/:assignmentId
// ─────────────────────────────────────────────────────────────────────────────

export const removeAssignment = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, assignmentId } = req.params;
    const actorId = req.user!.id;
    const reason =
      req.body?.reason ??
      `Removed by ${req.user!.firstName} ${req.user!.lastName}`;

    const assignment = await prisma.requirementAssignment.findFirst({
      where: { id: assignmentId, requirementId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!assignment)
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found" });

    await prisma.requirementAssignment.update({
      where: { id: assignmentId },
      data: { status: "REMOVED", removedAt: new Date(), removedReason: reason },
    });
    await prisma.requirementActivity.create({
      data: {
        requirementId,
        actorId,
        type: "ASSIGNMENT_REMOVED",
        summary: "Assignment removed",
        meta: { reason },
      },
    });

    return res.json({ success: true, message: "Assignment removed" });
  } catch (err) {
    console.error("removeAssignment:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to remove assignment" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates  — scope-filtered, paginated
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementCandidates = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope: PermissionScope = (req.modulePermission?.canViewScope ??
      PermissionScope.OWN) as PermissionScope;

    const {
      stageId,
      activeOnly,
      search,
      page = "1",
      limit = "25",
      sortBy = "stageUpdatedAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, createdById: true },
    });

    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    const isCreatedByMe = requirement.createdById === userId;
    const visibleRecruiterIds = isCreatedByMe
      ? null
      : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

    const where: any = { requirementId };

    if (visibleRecruiterIds !== null)
      where.recruiterId = { in: visibleRecruiterIds };
    if (stageId) where.currentStageId = stageId;
    if (activeOnly === "true") {
      where.isRejected = false;
      where.isWithdrawn = false;
    }
    if (search) {
      where.snapshot = {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { currentTitle: { contains: search, mode: "insensitive" } },
          { currentCompany: { contains: search, mode: "insensitive" } },
          { topSkills: { has: search } },
        ],
      };
    }

    const SORTABLE = ["stageUpdatedAt", "createdAt", "updatedAt"];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { stageUpdatedAt: "desc" as const };

    const [total, pipelines] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: {
          id: true,
          requirementId: true,
          recruiterId: true,
          currentStageId: true,
          stageUpdatedAt: true,
          isRejected: true,
          isWithdrawn: true,
          isOnHold: true,
          onHoldReason: true,
          rejectionReason: true,
          withdrawnReason: true,
          submittedAt: true,
          submissionNote: true,
          offeredCtc: true,
          salaryCurrency: true,
          salaryType: true,
          offeredAt: true,
          offerStatus: true,
          expectedJoiningDate: true,
          actualJoiningDate: true,
          createdAt: true,
          updatedAt: true,
          currentStage: {
            select: { id: true, code: true, label: true, order: true },
          },
          recruiter: { select: { id: true, firstName: true, lastName: true } },
          snapshot: {
            select: {
              id: true,
              candidateServiceId: true,
              fullName: true,
              email: true,
              phone: true,
              type: true,
              currentTitle: true,
              currentCompany: true,
              totalExpYears: true,
              topSkills: true,
              resumeUrl: true,
              rawSnapshot: true,
              snapshotAt: true,
            },
          },
          stageHistory: {
            select: {
              id: true,
              fromStageId: true,
              toStageId: true,
              timeInPrevStageMins: true,
              createdAt: true,
              fromStage: { select: { code: true, label: true } },
              toStage: { select: { code: true, label: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    const now = Date.now();
    const enriched = pipelines.map((p) => {
      const agingMins = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000
      );
      return {
        ...p,
        aging: { minutes: agingMins, label: formatAgingLabel(agingMins) },
      };
    });

    res.json({
      success: true,
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirementCandidates:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates/:pipelineId — full detail + history
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementCandidateById = async (
  req: Request,
  res: Response
) => {
  try {
    const { id: requirementId, pipelineId } = req.params;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope: PermissionScope = (req.modulePermission?.canViewScope ??
      PermissionScope.OWN) as PermissionScope;

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      select: { id: true, createdById: true },
    });

    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    const isCreatedByMe = requirement.createdById === userId;
    const visibleRecruiterIds = isCreatedByMe
      ? null
      : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: {
        id: pipelineId,
        requirementId,
        ...(visibleRecruiterIds !== null
          ? { recruiterId: { in: visibleRecruiterIds } }
          : {}),
      },
      select: {
        id: true,
        requirementId: true,
        recruiterId: true,
        currentStageId: true,
        stageUpdatedAt: true,
        isRejected: true,
        isWithdrawn: true,
        isOnHold: true,
        onHoldAt: true,
        onHoldReason: true,
        rejectedAt: true,
        rejectionReason: true,
        withdrawnAt: true,
        withdrawnReason: true,
        submittedAt: true,
        submissionNote: true,
        offeredCtc: true,
        salaryCurrency: true,
        salaryType: true,
        offeredAt: true,
        offerStatus: true,
        expectedJoiningDate: true,
        actualJoiningDate: true,
        createdAt: true,
        updatedAt: true,
        currentStage: {
          select: { id: true, code: true, label: true, order: true },
        },
        recruiter: { select: { id: true, firstName: true, lastName: true } },
        stageUpdatedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        submittedBy: { select: { id: true, firstName: true, lastName: true } },
        offeredBy: { select: { id: true, firstName: true, lastName: true } },
        rejectedBy: { select: { id: true, firstName: true, lastName: true } },
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
            createdBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        stageHistory: {
          select: {
            id: true,
            fromStageId: true,
            toStageId: true,
            timeInPrevStageMins: true,
            wasSkipped: true,
            skipReason: true,
            note: true,
            createdAt: true,
            fromStage: {
              select: { id: true, code: true, label: true, order: true },
            },
            toStage: {
              select: { id: true, code: true, label: true, order: true },
            },
            changedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!pipeline) {
      return res
        .status(404)
        .json({ success: false, message: "Candidate pipeline not found" });
    }

    const agingMins = Math.floor(
      (Date.now() - new Date(pipeline.stageUpdatedAt).getTime()) / 60000
    );

    const totalPipelineMins =
      pipeline.stageHistory.reduce(
        (sum, log) => sum + (log.timeInPrevStageMins ?? 0),
        0
      ) + agingMins;

    res.json({
      success: true,
      data: {
        ...pipeline,
        aging: { minutes: agingMins, label: formatAgingLabel(agingMins) },
        totalPipelineAging: {
          minutes: totalPipelineMins,
          label: formatAgingLabel(totalPipelineMins),
        },
      },
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getRequirementCandidateById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate detail" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getCandidates — filtered candidate list variant
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidates = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.params;
    const {
      stageCode,
      stageId,
      assignmentId,
      recruiterId,
      isRejected,
      isWithdrawn,
      isOnHold,
      activeOnly,
      search,
      page = "1",
      limit = "25",
      sortBy = "stageUpdatedAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const where: any = { requirementId };

    if (assignmentId) where.assignmentId = assignmentId;
    if (recruiterId) where.recruiterId = recruiterId;
    if (isRejected !== undefined) where.isRejected = isRejected === "true";
    if (isWithdrawn !== undefined) where.isWithdrawn = isWithdrawn === "true";
    if (isOnHold !== undefined) where.isOnHold = isOnHold === "true";
    if (activeOnly === "true") {
      where.isRejected = false;
      where.isWithdrawn = false;
    }
    if (stageId) {
      where.currentStageId = stageId;
    } else if (stageCode) {
      where.currentStage = { code: stageCode };
    }
    if (search) {
      where.snapshot = {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { currentCompany: { contains: search, mode: "insensitive" } },
          { currentTitle: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const SORTABLE = ["stageUpdatedAt", "createdAt", "submittedAt"];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { stageUpdatedAt: "desc" as const };

    const [total, pipelines] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: {
          id: true,
          isRejected: true,
          isWithdrawn: true,
          isOnHold: true,
          rejectionReason: true,
          withdrawnReason: true,
          onHoldReason: true,
          stageUpdatedAt: true,
          createdAt: true,
          submittedAt: true,
          submissionNote: true,
          offeredCtc: true,
          salaryCurrency: true,
          salaryType: true,
          offeredAt: true,
          offerStatus: true,
          expectedJoiningDate: true,
          actualJoiningDate: true,
          currentStage: {
            select: { id: true, code: true, label: true, order: true },
          },
          stageHistory: {
            select: {
              id: true,
              fromStage: { select: { id: true, code: true, label: true } },
              toStage: { select: { id: true, code: true, label: true } },
              changedBy: {
                select: { id: true, firstName: true, lastName: true },
              },
              wasSkipped: true,
              skipReason: true,
              timeInPrevStageMins: true,
              note: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
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
              snapshotAt: true,
              rawSnapshot: true,
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
                  employeeId: true,
                },
              },
            },
          },
          recruiter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeId: true,
            },
          },
          submittedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          offeredBy: { select: { id: true, firstName: true, lastName: true } },
          rejectedBy: { select: { id: true, firstName: true, lastName: true } },
          stageUpdatedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    const enriched = pipelines.map((p) => ({
      ...p,
      aging: computeAging(p.stageUpdatedAt),
    }));

    return res.json({
      success: true,
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getCandidates:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getCandidateDetail — single candidate detail variant
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidateDetail = async (req: Request, res: Response) => {
  try {
    const { id: requirementId, pipelineId } = req.params;

    const pipeline = await prisma.requirementCandidatePipeline.findFirst({
      where: { id: pipelineId, requirementId },
      select: {
        id: true,
        isRejected: true,
        rejectedAt: true,
        rejectionReason: true,
        isWithdrawn: true,
        withdrawnAt: true,
        withdrawnReason: true,
        isOnHold: true,
        onHoldAt: true,
        onHoldReason: true,
        stageUpdatedAt: true,
        submittedAt: true,
        submissionNote: true,
        offeredCtc: true,
        salaryCurrency: true,
        salaryType: true,
        offeredAt: true,
        offerStatus: true,
        expectedJoiningDate: true,
        actualJoiningDate: true,
        createdAt: true,
        updatedAt: true,
        currentStage: {
          select: { id: true, code: true, label: true, order: true },
        },
        stageUpdatedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        stageHistory: {
          select: {
            id: true,
            wasSkipped: true,
            skipReason: true,
            timeInPrevStageMins: true,
            note: true,
            createdAt: true,
            fromStage: {
              select: { id: true, code: true, label: true, order: true },
            },
            toStage: {
              select: { id: true, code: true, label: true, order: true },
            },
            changedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        snapshot: {
          select: {
            id: true,
            candidateServiceId: true,
            snapshotAt: true,
            fullName: true,
            email: true,
            phone: true,
            currentTitle: true,
            currentCompany: true,
            totalExpYears: true,
            topSkills: true,
            resumeUrl: true,
            rawSnapshot: true,
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
                employeeId: true,
              },
            },
          },
        },
        recruiter: { select: { id: true, firstName: true, lastName: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true } },
        offeredBy: { select: { id: true, firstName: true, lastName: true } },
        rejectedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!pipeline) {
      return res
        .status(404)
        .json({ success: false, message: "Candidate pipeline not found" });
    }

    return res.json({
      success: true,
      data: { ...pipeline, aging: computeAging(pipeline.stageUpdatedAt) },
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getCandidateDetail:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate detail" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// LIST / STATS / SUMMARY / EXPORT — read FROZEN sale value columns only
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements
// saleValue / perOpeningValue / saleValueBasis read straight from the row.
// achievedValue = terminalCount × perOpeningValue
// RBAC: total + per-opening visible to all; inputs (band, %, salary, basis,
// manual value) only to creator + managers up the chain + super admin.
// computedSaleValue kept as an alias of saleValue for frontend compatibility.
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirements = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const {
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = q;
    const filters = readListFilters(q);

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const where = await buildRequirementsWhere(filters, userId, isSuperAdmin);

    // saleValue / perOpeningValue are real columns now → DB-level sort works
    const SORTABLE = [
      "createdAt",
      "updatedAt",
      "respondBy",
      "priority",
      "status",
      "saleValue",
      "perOpeningValue",
      "totalOpenings",
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

          // ── Frozen commercials
          saleValue: true,
          perOpeningValue: true,
          saleValueBasis: true,

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

          _count: { select: { pipelines: true } },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    const permissions = {
      canAdd: req.modulePermission.canAdd,
      canEdit: req.modulePermission.canEdit,
      canDelete: req.modulePermission.canDelete,
    };

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
        permissions,
      });
    }

    const reqIds = requirements.map((r) => r.id);
    const terminalStageDefs = await fetchTerminalStageDefs(
      filters.serviceLineId
    );
    const terminalByReq = await fetchTerminalCountsByReq(
      reqIds,
      terminalStageDefs
    );

    const uniqueCreatorIds = [
      ...new Set(requirements.map((r) => r.createdBy.id)),
    ];
    const managerSetByCreator = await resolveManagerSets(uniqueCreatorIds);

    const enrichedRequirements = requirements.map((r) => {
      const creatorId = r.createdBy.id;
      const canSeeSale =
        isSuperAdmin ||
        userId === creatorId ||
        (managerSetByCreator[creatorId]?.has(userId) ?? false);

      const saleValue = toNum(r.saleValue);
      const perOpeningValue = toNum(r.perOpeningValue);

      const { perStage: terminalStageCounts, total: terminalCount } =
        terminalForRequirement(
          terminalStageDefs,
          terminalByReq[r.id],
          r.serviceLineId
        );

      const achievedValue = achievedFor(perOpeningValue, terminalCount);
      const achievedPct = pctOf(terminalCount, r.totalOpenings);

      const saleFields = canSeeSale
        ? {
            saleValue,
            perOpeningValue,
            saleValueBasis: r.saleValueBasis,
            salaryMin: r.salaryMin,
            salaryMax: r.salaryMax,
            salaryType: r.salaryType,
            salaryCurrency: r.salaryCurrency,
            band: r.band
              ? {
                  ...r.band,
                  rangeFrom: toNum(r.band.rangeFrom),
                  rangeTo: toNum(r.band.rangeTo),
                  value: toNum(r.band.value),
                }
              : null,
            client: r.client
              ? {
                  ...r.client,
                  percentageValue: toNum(r.client.percentageValue),
                }
              : null,
            computedSaleValue: saleValue,
          }
        : {
            saleValue: null,
            perOpeningValue, // universal — needed for achieved math on the frontend
            saleValueBasis: null,
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
            computedSaleValue: saleValue, // universal
          };

      return {
        ...r,
        ...saleFields,
        totalFunnelCount: r._count.pipelines,
        terminalCount,
        terminalStageCounts,
        achievedValue,
        achievedPct,
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
        terminalStageDefs,
      },
      scope: { isSuperAdmin },
      permissions,
    });
  } catch (err) {
    console.error("getRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch requirements" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/sale-value-stats
// Totals + basis breakdown come from ONE DB groupBy on frozen columns.
// Achieved still needs terminal counts per req (placements are live data).
// ─────────────────────────────────────────────────────────────────────────────

export const getSaleValueStats = async (req: Request, res: Response) => {
  try {
    const filters = readListFilters(req.query as Record<string, string>);
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const where = await buildRequirementsWhere(filters, userId, isSuperAdmin);

    const [requirements, basisGroups] = await Promise.all([
      prisma.requirement.findMany({
        where,
        select: { id: true, serviceLineId: true, perOpeningValue: true },
      }),
      prisma.requirement.groupBy({
        by: ["saleValueBasis"],
        where,
        _count: { _all: true },
        _sum: { saleValue: true },
      }),
    ]);

    const byBasis = emptyBasisBuckets();
    for (const g of basisGroups) {
      const key = g.saleValueBasis ?? NO_BASIS_KEY;
      byBasis[key] = {
        count: g._count._all,
        total: toNum(g._sum.saleValue) ?? 0,
      };
    }

    const totalSaleValue = round2(
      Object.entries(byBasis)
        .filter(([k]) => k !== NO_BASIS_KEY)
        .reduce((s, [, v]) => s + v.total, 0)
    );
    const omittedCount = byBasis[NO_BASIS_KEY].count;

    let totalAchievedValue = 0;
    if (requirements.length) {
      const terminalStageDefs = await fetchTerminalStageDefs(
        filters.serviceLineId
      );
      const terminalByReq = await fetchTerminalCountsByReq(
        requirements.map((r) => r.id),
        terminalStageDefs
      );
      for (const r of requirements) {
        const { total: terminalCount } = terminalForRequirement(
          terminalStageDefs,
          terminalByReq[r.id],
          r.serviceLineId
        );
        totalAchievedValue +=
          achievedFor(toNum(r.perOpeningValue), terminalCount) ?? 0;
      }
    }

    return res.json({
      success: true,
      data: {
        totalRequirements: requirements.length,
        includedCount: requirements.length - omittedCount,
        omittedCount,
        totalSaleValue,
        totalAchievedValue: round2(totalAchievedValue),
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
        priorities: Object.values(Priority), // from enum — never hardcoded
        saleValueBases: Object.values(SaleValueBasis),
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
// GET /requirements/pipeline-summary
// Full dataset (no pagination) — per-req terminal breakdown + frozen values
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementsPipelineSummary = async (
  req: Request,
  res: Response
) => {
  try {
    const filters = readListFilters(req.query as Record<string, string>);
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const where = await buildRequirementsWhere(filters, userId, isSuperAdmin);

    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        totalOpenings: true,
        serviceLineId: true,
        saleValue: true,
        perOpeningValue: true,
        saleValueBasis: true,
        _count: { select: { pipelines: true } },
      },
    });

    if (!requirements.length) {
      return res.json({
        success: true,
        data: [],
        meta: { terminalStageDefs: [] },
      });
    }

    const terminalStageDefs = await fetchTerminalStageDefs(
      filters.serviceLineId
    );
    const terminalByReq = await fetchTerminalCountsByReq(
      requirements.map((r) => r.id),
      terminalStageDefs
    );

    const data = requirements.map((r) => {
      const saleValue = toNum(r.saleValue);
      const perOpeningValue = toNum(r.perOpeningValue);
      const { perStage: terminalStageCounts, total: terminalCount } =
        terminalForRequirement(
          terminalStageDefs,
          terminalByReq[r.id],
          r.serviceLineId
        );

      return {
        requirementId: r.id,
        totalOpenings: r.totalOpenings,
        totalFunnelCount: r._count.pipelines,
        terminalCount,
        terminalStageCounts,
        achievedPct: pctOf(terminalCount, r.totalOpenings),
        saleValue,
        perOpeningValue,
        saleValueBasis: r.saleValueBasis,
        computedSaleValue: saleValue, // alias — frontend compatibility
        achievedValue: achievedFor(perOpeningValue, terminalCount),
      };
    });

    return res.json({ success: true, data, meta: { terminalStageDefs } });
  } catch (err) {
    console.error("getRequirementsPipelineSummary:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch pipeline summary" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/export
// Sheet 1 — Requirements (frozen sale value + terminal achieved)
// Sheet 2 — Candidates
// ─────────────────────────────────────────────────────────────────────────────

export const exportRequirements = async (req: Request, res: Response) => {
  try {
    const filters = readListFilters(req.query as Record<string, string>);
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const where = await buildRequirementsWhere(filters, userId, isSuperAdmin);

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

        // ── Frozen commercials
        saleValue: true,
        perOpeningValue: true,
        saleValueBasis: true,

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

    const uniqueCreatorIds = [
      ...new Set(requirements.map((r) => r.createdBy.id)),
    ];
    const managerSetByCreator = await resolveManagerSets(uniqueCreatorIds);

    const terminalStages = await fetchTerminalStageDefs(filters.serviceLineId);

    // Full stage counts — needed for total funnel per req
    const pipelineCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    const countsByReq: Record<string, Record<string, number>> = {};
    for (const pc of pipelineCounts) {
      if (!countsByReq[pc.requirementId]) countsByReq[pc.requirementId] = {};
      countsByReq[pc.requirementId][pc.currentStageId] = pc._count.id;
    }

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

    // ── Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

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

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 1 — Requirements
    // ════════════════════════════════════════════════════════════════════════
    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    const fixedCols = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Title", key: "title", width: 38 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Client", key: "client", width: 24 },
      { header: "Client SPOC", key: "spoc", width: 22 },
      { header: "Agreement", key: "agreementType", width: 14 },
      { header: "Business Unit", key: "bu", width: 22 },
      { header: "Service Line", key: "sl", width: 20 },
      { header: "City", key: "city", width: 16 },
      { header: "Country", key: "country", width: 14 },
      { header: "Job Type", key: "jobType", width: 16 },
      { header: "Remote", key: "remote", width: 12 },
      { header: "Total Openings", key: "openings", width: 14 },
      { header: "Created By", key: "createdBy", width: 22 },
      { header: "Created Date", key: "createdAt", width: 18 },
      { header: "Days Open", key: "daysOpen", width: 12 },
      { header: "Respond By", key: "respondBy", width: 18 },
      { header: "SLA Breached?", key: "breached", width: 14 },
      { header: "Total Funnel", key: "totalFunnel", width: 14 },
    ];

    // Inputs gated by RBAC; per-opening + total visible to everyone
    const saleValueCols = [
      { header: "Band Code", key: "bandCode", width: 12 },
      { header: "Band Name", key: "bandName", width: 18 },
      { header: "Band Range", key: "bandRange", width: 20 },
      { header: "Band Value", key: "bandValue", width: 14 },
      { header: "Client %", key: "clientPct", width: 12 },
      { header: "Salary Min", key: "salaryMin", width: 14 },
      { header: "Salary Max", key: "salaryMax", width: 14 },
      { header: "Manual Sale Value", key: "manualSaleValue", width: 18 },
      { header: "Per Opening Value", key: "perOpeningValue", width: 18 },
      { header: "Sale Value (Total)", key: "saleValue", width: 20 },
      { header: "Sale Basis", key: "saleValueBasis", width: 16 },
    ];

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

    const allCols = [...fixedCols, ...saleValueCols, ...achievedCols];
    sheet1.columns = allCols;

    const colIndex = (key: string) =>
      allCols.findIndex((c) => c.key === key) + 1;

    const nFixed = fixedCols.length;
    const nSale = saleValueCols.length;
    const nAchieved = achievedCols.length;

    // Group header row (row 1)
    const groupRow = sheet1.getRow(1);
    groupRow.getCell(1).value = "Requirement Details";
    groupRow.getCell(nFixed + 1).value =
      "Sale Value (inputs: Creator / Manager only)";
    groupRow.getCell(nFixed + nSale + 1).value = "Achieved (Terminal Stages)";

    sheet1.mergeCells(1, 1, 1, nFixed);
    sheet1.mergeCells(1, nFixed + 1, 1, nFixed + nSale);
    if (nAchieved > 1)
      sheet1.mergeCells(1, nFixed + nSale + 1, 1, nFixed + nSale + nAchieved);

    applyHeader(groupRow);
    groupRow.getCell(nFixed + 1).fill = FILLS.darkGreen;
    groupRow.getCell(nFixed + nSale + 1).fill = FILLS.purple;

    // Column header row (row 2)
    const colHeaderRow = sheet1.getRow(2);
    allCols.forEach((col, i) => {
      colHeaderRow.getCell(i + 1).value = col.header;
    });
    applyHeader(colHeaderRow, FILLS.midBlue);

    const GATED_KEYS = [
      "bandCode",
      "bandName",
      "bandRange",
      "bandValue",
      "clientPct",
      "salaryMin",
      "salaryMax",
      "manualSaleValue",
      "saleValueBasis",
    ];

    const now = Date.now();
    let exportTotalSaleValue = 0;
    let exportTotalAchieved = 0;
    let exportOmittedCount = 0;

    for (const r of requirements) {
      const daysOpen = Math.floor(
        (now - new Date(r.createdAt).getTime()) / 86_400_000
      );

      const canSeeSale =
        isSuperAdmin ||
        userId === r.createdBy.id ||
        (managerSetByCreator[r.createdBy.id]?.has(userId) ?? false);

      const saleValue = toNum(r.saleValue);
      const perOpeningValue = toNum(r.perOpeningValue);
      const bandValue = toNum(r.band?.value);
      const bandFrom = toNum(r.band?.rangeFrom);
      const bandTo = toNum(r.band?.rangeTo);
      const clientPct = toNum(r.client?.percentageValue);

      if (saleValue != null) exportTotalSaleValue += saleValue;
      else exportOmittedCount++;

      const reqStageCounts = countsByReq[r.id] ?? {};
      const totalFunnel = Object.values(reqStageCounts).reduce(
        (s, n) => s + n,
        0
      );

      const { perStage, total: terminalTotal } = terminalForRequirement(
        terminalStages,
        reqStageCounts,
        r.serviceLineId
      );

      const achievedPct = pctOf(terminalTotal, r.totalOpenings);
      const achievedValue = achievedFor(perOpeningValue, terminalTotal);
      if (achievedValue != null) exportTotalAchieved += achievedValue;

      const gated = (v: any) => (canSeeSale ? v : "—");

      const rowData: Record<string, any> = {
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

        bandCode: gated(r.band?.code ?? ""),
        bandName: gated(r.band?.name ?? ""),
        bandRange: gated(
          bandFrom != null && bandTo != null ? `${bandFrom} – ${bandTo}` : ""
        ),
        bandValue: gated(bandValue ?? ""),
        clientPct: gated(clientPct ?? ""),
        salaryMin: gated(r.salaryMin ?? ""),
        salaryMax: gated(r.salaryMax ?? ""),
        manualSaleValue: gated(
          r.saleValueBasis === SaleValueBasis.DIRECT && saleValue != null
            ? saleValue
            : ""
        ),
        perOpeningValue: perOpeningValue ?? "",
        saleValue: saleValue ?? "No Data",
        saleValueBasis: gated(r.saleValueBasis ?? NO_BASIS_KEY),

        ...Object.fromEntries(
          terminalStages.map((ts) => [`term_${ts.id}`, perStage[ts.id] ?? 0])
        ),
        terminalCount: terminalTotal,
        achievedPct,
        achievedValue: achievedValue ?? "",
      };

      const dataRow = sheet1.addRow(rowData);
      dataRow.height = 20;

      const statusColor = STATUS_COLORS[r.status];
      if (statusColor) {
        dataRow.getCell("status").fill = mkFill(statusColor);
        dataRow.getCell("status").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      if (r.isRespondByBreached || r.isTurnaroundBreached) {
        dataRow.getCell("breached").fill = mkFill("FFDE350B");
        dataRow.getCell("breached").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      if (saleValue != null) {
        dataRow.getCell("saleValue").fill = FILLS.lightGreen;
        dataRow.getCell("saleValue").font = { bold: true };
        dataRow.getCell("saleValue").numFmt = "#,##0.00";
      } else {
        dataRow.getCell("saleValue").fill = FILLS.lightRed;
        dataRow.getCell("saleValue").font = { color: { argb: "FFDE350B" } };
      }
      if (perOpeningValue != null)
        dataRow.getCell("perOpeningValue").numFmt = "#,##0.00";
      if (canSeeSale && typeof rowData.manualSaleValue === "number")
        dataRow.getCell("manualSaleValue").numFmt = "#,##0.00";

      if (achievedValue != null && achievedValue > 0) {
        dataRow.getCell("achievedValue").fill = FILLS.lightPurple;
        dataRow.getCell("achievedValue").font = { bold: true };
        dataRow.getCell("achievedValue").numFmt = "#,##0.00";
      }

      if (achievedPct >= 100) {
        dataRow.getCell("achievedPct").fill = mkFill("FF00875A");
        dataRow.getCell("achievedPct").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      } else if (achievedPct >= 50) {
        dataRow.getCell("achievedPct").fill = mkFill("FFFFE082");
      }

      if (!canSeeSale) {
        GATED_KEYS.forEach((k) => {
          dataRow.getCell(k).font = {
            color: { argb: "FFBDBDBD" },
            italic: true,
          };
        });
      }

      dataRow.getCell("createdAt").numFmt = "dd-mmm-yyyy";
      if (r.respondBy) dataRow.getCell("respondBy").numFmt = "dd-mmm-yyyy";
    }

    // ── Summary row — column positions resolved by key, never by arithmetic
    const summaryRow = sheet1.addRow({});
    summaryRow.height = 24;

    const svCol = colIndex("saleValue");
    const achCol = colIndex("achievedValue");

    summaryRow.getCell(svCol - 1).value = `Total (${
      requirements.length - exportOmittedCount
    } computed, ${exportOmittedCount} no data)`;
    summaryRow.getCell(svCol - 1).font = {
      bold: true,
      italic: true,
      size: 10,
      color: { argb: "FF1E3A5F" },
    };

    summaryRow.getCell(svCol).value = round2(exportTotalSaleValue);
    summaryRow.getCell(svCol).numFmt = "#,##0.00";
    summaryRow.getCell(svCol).font = {
      bold: true,
      color: { argb: "FF1A5C2A" },
    };
    summaryRow.getCell(svCol).fill = FILLS.lightGreen;

    summaryRow.getCell(achCol).value = round2(exportTotalAchieved);
    summaryRow.getCell(achCol).numFmt = "#,##0.00";
    summaryRow.getCell(achCol).font = {
      bold: true,
      color: { argb: "FF4A148C" },
    };
    summaryRow.getCell(achCol).fill = FILLS.lightPurple;

    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: allCols.length },
    };

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 2 — Candidates
    // ════════════════════════════════════════════════════════════════════════
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
      { header: "Is Terminal?", key: "isTerminal", width: 14 },
      { header: "Recruiter", key: "recruiter", width: 22 },
      { header: "Added On", key: "addedOn", width: 16 },
      { header: "Days in Current Stage", key: "stageAge", width: 20 },
      { header: "Current Stage Aging", key: "stageAgingLabel", width: 18 },
      { header: "Total Pipeline Days", key: "totalDays", width: 18 },
      { header: "Rejected?", key: "rejected", width: 12 },
      { header: "Withdrawn?", key: "withdrawn", width: 12 },
      { header: "On Hold?", key: "onHold", width: 12 },
      { header: "Submitted At", key: "submittedAt", width: 18 },
      { header: "Offer Status", key: "offerStatus", width: 14 },
      { header: "Joining Date", key: "joiningDate", width: 16 },
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
          (sum, log) => sum + (log.timeInPrevStageMins ?? 0),
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
      if (p.submittedAt)
        dataRow.getCell("submittedAt").numFmt = "dd-mmm-yyyy hh:mm";
      if (p.actualJoiningDate)
        dataRow.getCell("joiningDate").numFmt = "dd-mmm-yyyy";

      if (p.currentStage?.isTerminal) {
        dataRow.getCell("stage").fill = FILLS.lightGreen;
        dataRow.getCell("isTerminal").fill = FILLS.lightGreen;
        dataRow.getCell("isTerminal").font = {
          bold: true,
          color: { argb: "FF1A5C2A" },
        };
      }

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

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="requirements-export-${dateStr}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportRequirements:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to export requirements" });
  }
};
