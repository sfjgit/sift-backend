// File: requirement.controller.ts
// Path: src/controller/requirement.controller.ts

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
import { sendMail } from "@/utils/mailer";

import ExcelJS from "exceljs";
import { parseUploadedFile } from "@/utils/bulkRequirementParser";
import { validateRequirementRow } from "@/utils/bulkRequirements";
import { updateRequirementSchema } from "@/validators/requirement.validators";
import { getSignedDownloadUrl } from "@/services/s3.service";
// ─────────────────────────────────────────────────────────────────────────────
// HELPER — compute aging string from a date to now
// "2h 15m", "3d 4h", "1m 2d"
// ─────────────────────────────────────────────────────────────────────────────
// function computeAging(from: Date): { minutes: number; label: string } {
//   const diffMs = Date.now() - new Date(from).getTime();
//   const totalMins = Math.floor(diffMs / 60000);
//   const mins = totalMins % 60;
//   const hours = Math.floor(totalMins / 60) % 24;
//   const days = Math.floor(totalMins / 1440) % 30;
//   const months = Math.floor(totalMins / 43200);

//   let label = "";
//   if (months > 0) label = `${months}mo ${days}d`;
//   else if (days > 0) label = `${days}d ${hours}h`;
//   else if (hours > 0) label = `${hours}h ${mins}m`;
//   else label = `${totalMins}m`;

//   return { minutes: totalMins, label };
// }

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/detail
// Full requirement detail — header + pipeline stage counts + team
// ─────────────────────────────────────────────────────────────────────────────
// File: requirement.controller.ts
// Path: src/controller/requirement.controller.ts

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: formatAging — minutes → human label
// ─────────────────────────────────────────────────────────────────────────────

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────────────────────────────────────
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

        // location — split fields
        city: true,
        state: true,
        country: true,

        // skills — split
        primarySkills: true,
        keySkills: true,

        experienceMin: true,
        experienceMax: true,

        // compensation
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        salaryCurrency: true,
        bonusAmount: true,
        hideSalaryFromCandidate: true,
        showMedianSalary: true,

        // employment
        education: true,
        functionalArea: true,
        shift: true,

        // sourcing
        targetCompanies: true,
        noPoachCompanies: true,

        totalOpenings: true,

        // dates
        startDate: true,
        targetDate: true,
        respondBy: true,
        turnaroundDays: true,
        closedAt: true,
        closureReason: true,

        isRespondByBreached: true,
        isTurnaroundBreached: true,

        // JD file
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
        jdUploadedAt: true,

        // JD parse
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

    // ── Scope: creator sees all pipeline counts, others get filtered
    const isCreatedByMe = requirement.createdBy.id === userId;
    const visibleRecruiterIds = isCreatedByMe
      ? null
      : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

    // ── Stages relevant to this service line
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
      (s) => s.serviceLineId === null || s.serviceLineId === serviceLineId,
    );

    // ── Scoped stage counts + summary counts — all in one Promise.all
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
        where: {
          requirementId: id,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
        _count: { id: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: {
          requirementId: id,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
      }),
      prisma.requirementCandidatePipeline.count({
        where: {
          requirementId: id,
          isRejected: false,
          isWithdrawn: false,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
      }),
      prisma.requirementCandidatePipeline.count({
        where: {
          requirementId: id,
          isRejected: true,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
      }),
      prisma.requirementCandidatePipeline.count({
        where: {
          requirementId: id,
          isWithdrawn: true,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
      }),
      prisma.requirementCandidatePipeline.count({
        where: {
          requirementId: id,
          isOnHold: true,
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
      }),
    ]);

    const stageCountMap = Object.fromEntries(
      stageCounts.map((s) => [s.currentStageId, s._count.id]),
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

// File: requirementCandidates.controller.ts
// Path: src/controllers/requirementCandidates.controller.ts

// import { Request, Response } from "express";
// import { prisma } from "../lib/prisma";
// import { PermissionScope } from "@prisma/client";
// import { getVisibleRecruiterIds } from "../lib/scopeHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates
// Paginated, scope-filtered pipeline rows for a requirement
// ─────────────────────────────────────────────────────────────────────────────
// export const getRequirementCandidates = async (req: Request, res: Response) => {
//   try {
//     const { id: requirementId } = req.params;
//     const userId = req.user!.id;
//     const isSuperAdmin = req.user!.isSuperAdmin;
//     const canViewScope: PermissionScope =
//       req.modulePermission?.canViewScope ?? PermissionScope.OWN;

//     const {
//       stageId,
//       activeOnly,
//       search,
//       page = "1",
//       limit = "25",
//       sortBy = "stageUpdatedAt",
//       sortDir = "desc",
//     } = req.query as Record<string, string>;

//     const skip = (parseInt(page) - 1) * parseInt(limit);
//     const take = Math.min(parseInt(limit), 100);

//     // ── Verify requirement exists and user has access
//     const requirement = await prisma.requirement.findFirst({
//       where: { id: requirementId, deletedAt: null },
//       select: { id: true, createdById: true },
//     });

//     if (!requirement) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Requirement not found" });
//     }

//     // ── Scope: creator sees all, others get filtered
//     const isCreatedByMe = requirement.createdById === userId;
//     const visibleRecruiterIds = isCreatedByMe
//       ? null
//       : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

//     // ── Build where clause
//     const where: any = { requirementId };

//     if (visibleRecruiterIds !== null) {
//       where.recruiterId = { in: visibleRecruiterIds };
//     }

//     if (stageId) {
//       where.currentStageId = stageId;
//     }

//     if (activeOnly === "true") {
//       where.isRejected = false;
//       where.isWithdrawn = false;
//     }

//     if (search) {
//       where.snapshot = {
//         OR: [
//           { fullName: { contains: search, mode: "insensitive" } },
//           { email: { contains: search, mode: "insensitive" } },
//           { currentTitle: { contains: search, mode: "insensitive" } },
//           { currentCompany: { contains: search, mode: "insensitive" } },
//           { topSkills: { has: search } },
//         ],
//       };
//     }

//     const SORTABLE = ["stageUpdatedAt", "createdAt", "updatedAt"];
//     const orderBy = SORTABLE.includes(sortBy)
//       ? { [sortBy]: sortDir as "asc" | "desc" }
//       : { stageUpdatedAt: "desc" as const };

//     const [total, pipelines] = await Promise.all([
//       prisma.requirementCandidatePipeline.count({ where }),
//       prisma.requirementCandidatePipeline.findMany({
//         where,
//         select: {
//           id: true,
//           requirementId: true,
//           recruiterId: true,
//           currentStageId: true,
//           stageUpdatedAt: true,
//           isRejected: true,
//           isWithdrawn: true,
//           isOnHold: true,
//           onHoldReason: true,
//           rejectionReason: true,
//           withdrawnReason: true,
//           submittedAt: true,
//           submissionNote: true,
//           offeredCtc: true,
//           salaryCurrency: true,
//           salaryType: true,
//           offeredAt: true,
//           offerStatus: true,
//           expectedJoiningDate: true,
//           actualJoiningDate: true,
//           createdAt: true,
//           updatedAt: true,
//           currentStage: {
//             select: { id: true, code: true, label: true, order: true },
//           },
//           recruiter: {
//             select: { id: true, firstName: true, lastName: true },
//           },
//           snapshot: {
//             select: {
//               id: true,
//               candidateServiceId: true,
//               fullName: true,
//               email: true,
//               phone: true,
//               currentTitle: true,
//               currentCompany: true,
//               totalExpYears: true,
//               topSkills: true,
//               resumeUrl: true,
//               rawSnapshot: true,
//               snapshotAt: true,
//             },
//           },
//           // summary stage history — count of transitions only for list view
//           stageHistory: {
//             select: {
//               id: true,
//               fromStageId: true,
//               toStageId: true,
//               timeInPrevStageMins: true,
//               createdAt: true,
//               fromStage: { select: { code: true, label: true } },
//               toStage: { select: { code: true, label: true } },
//             },
//             orderBy: { createdAt: "asc" },
//           },
//         },
//         orderBy,
//         skip,
//         take,
//       }),
//     ]);

//     // ── Compute current stage aging (now - stageUpdatedAt) for each pipeline
//     const now = Date.now();
//     const enriched = pipelines.map((p) => {
//       const agingMins = Math.floor(
//         (now - new Date(p.stageUpdatedAt).getTime()) / 60000
//       );
//       return {
//         ...p,
//         aging: {
//           minutes: agingMins,
//           label: formatAgingLabel(agingMins),
//         },
//       };
//     });

//     res.json({
//       success: true,
//       data: enriched,
//       meta: {
//         total,
//         page: parseInt(page),
//         limit: take,
//         pages: Math.ceil(total / take),
//       },
//     });
//   } catch (err) {
//     console.error("getRequirementCandidates:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch candidates" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates/:pipelineId
// Full single candidate detail — snapshot + complete stage history with aging
// ─────────────────────────────────────────────────────────────────────────────
// export const getRequirementCandidateById = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const { id: requirementId, pipelineId } = req.params;
//     const userId = req.user!.id;
//     const isSuperAdmin = req.user!.isSuperAdmin;
//     const canViewScope: PermissionScope =
//       req.modulePermission?.canViewScope ?? PermissionScope.OWN;

//     // ── Verify requirement
//     const requirement = await prisma.requirement.findFirst({
//       where: { id: requirementId, deletedAt: null },
//       select: { id: true, createdById: true },
//     });

//     if (!requirement) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Requirement not found" });
//     }

//     const isCreatedByMe = requirement.createdById === userId;
//     const visibleRecruiterIds = isCreatedByMe
//       ? null
//       : await getVisibleRecruiterIds(userId, isSuperAdmin, canViewScope);

//     // ── Fetch pipeline with full history
//     const pipeline = await prisma.requirementCandidatePipeline.findFirst({
//       where: {
//         id: pipelineId,
//         requirementId,
//         // scope guard — can't access candidates outside your scope
//         ...(visibleRecruiterIds !== null
//           ? { recruiterId: { in: visibleRecruiterIds } }
//           : {}),
//       },
//       select: {
//         id: true,
//         requirementId: true,
//         recruiterId: true,
//         currentStageId: true,
//         stageUpdatedAt: true,
//         isRejected: true,
//         isWithdrawn: true,
//         isOnHold: true,
//         onHoldAt: true,
//         onHoldReason: true,
//         rejectedAt: true,
//         rejectionReason: true,
//         withdrawnAt: true,
//         withdrawnReason: true,
//         submittedAt: true,
//         submissionNote: true,
//         offeredCtc: true,
//         salaryCurrency: true,
//         salaryType: true,
//         offeredAt: true,
//         offerStatus: true,
//         expectedJoiningDate: true,
//         actualJoiningDate: true,
//         createdAt: true,
//         updatedAt: true,
//         currentStage: {
//           select: { id: true, code: true, label: true, order: true },
//         },
//         recruiter: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//         stageUpdatedBy: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//         submittedBy: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//         offeredBy: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//         rejectedBy: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//         snapshot: {
//           select: {
//             id: true,
//             candidateServiceId: true,
//             fullName: true,
//             email: true,
//             phone: true,
//             currentTitle: true,
//             currentCompany: true,
//             totalExpYears: true,
//             topSkills: true,
//             resumeUrl: true,
//             rawSnapshot: true,
//             snapshotAt: true,
//             createdBy: {
//               select: { id: true, firstName: true, lastName: true },
//             },
//           },
//         },
//         // Full stage history with time spent per stage
//         stageHistory: {
//           select: {
//             id: true,
//             fromStageId: true,
//             toStageId: true,
//             timeInPrevStageMins: true,
//             wasSkipped: true,
//             skipReason: true,
//             note: true,
//             createdAt: true,
//             fromStage: {
//               select: { id: true, code: true, label: true, order: true },
//             },
//             toStage: {
//               select: { id: true, code: true, label: true, order: true },
//             },
//             changedBy: {
//               select: { id: true, firstName: true, lastName: true },
//             },
//           },
//           orderBy: { createdAt: "asc" },
//         },
//       },
//     });

//     if (!pipeline) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Candidate pipeline not found" });
//     }

//     // ── Compute current stage aging
//     const agingMins = Math.floor(
//       (Date.now() - new Date(pipeline.stageUpdatedAt).getTime()) / 60000
//     );

//     // ── Compute total time in pipeline
//     const totalPipelineMins =
//       pipeline.stageHistory.reduce(
//         (sum, log) => sum + (log.timeInPrevStageMins ?? 0),
//         0
//       ) + agingMins;

//     res.json({
//       success: true,
//       data: {
//         ...pipeline,
//         aging: {
//           minutes: agingMins,
//           label: formatAgingLabel(agingMins),
//         },
//         totalPipelineAging: {
//           minutes: totalPipelineMins,
//           label: formatAgingLabel(totalPipelineMins),
//         },
//       },
//     });
//   } catch (err) {
//     console.error("getRequirementCandidateById:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch candidate detail" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// UTIL
// // ─────────────────────────────────────────────────────────────────────────────
// function formatAgingLabel(mins: number): string {
//   if (mins < 60) return `${mins}m`;
//   const hrs = Math.floor(mins / 60);
//   if (hrs < 24) return `${hrs}h`;
//   const days = Math.floor(hrs / 24);
//   if (days < 30) return `${days}d`;
//   const months = Math.floor(days / 30);
//   return `${months}mo`;
// }

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates
// Paginated, filtered candidate pipeline list with aging
// Query params:
//   stageCode, stageId, assignmentId, recruiterId
//   isRejected, isWithdrawn, isOnHold, activeOnly (bool)
//   search (fullName, email, phone, currentCompany)
//   page, limit, sortBy (stageUpdatedAt | createdAt | aging), sortDir
// ─────────────────────────────────────────────────────────────────────────────
// export const getCandidates = async (req: Request, res: Response) => {
//   try {
//     const { id: requirementId } = req.params;
//     const {
//       stageCode,
//       stageId,
//       assignmentId,
//       recruiterId,
//       isRejected,
//       isWithdrawn,
//       isOnHold,
//       activeOnly,
//       search,
//       page = "1",
//       limit = "25",
//       sortBy = "stageUpdatedAt",
//       sortDir = "desc",
//     } = req.query as Record<string, string>;

//     const skip = (parseInt(page) - 1) * parseInt(limit);
//     const take = Math.min(parseInt(limit), 100);

//     const where: any = { requirementId };

//     if (assignmentId) where.assignmentId = assignmentId;
//     if (recruiterId) where.recruiterId = recruiterId;

//     // terminal state filters
//     if (isRejected !== undefined) where.isRejected = isRejected === "true";
//     if (isWithdrawn !== undefined) where.isWithdrawn = isWithdrawn === "true";
//     if (isOnHold !== undefined) where.isOnHold = isOnHold === "true";

//     // activeOnly = not rejected AND not withdrawn
//     if (activeOnly === "true") {
//       where.isRejected = false;
//       where.isWithdrawn = false;
//     }

//     // stage filter
//     if (stageId) {
//       where.currentStageId = stageId;
//     } else if (stageCode) {
//       where.currentStage = { code: stageCode };
//     }

//     // search across snapshot display fields
//     if (search) {
//       where.snapshot = {
//         OR: [
//           { fullName: { contains: search, mode: "insensitive" } },
//           { email: { contains: search, mode: "insensitive" } },
//           { phone: { contains: search, mode: "insensitive" } },
//           { currentCompany: { contains: search, mode: "insensitive" } },
//           { currentTitle: { contains: search, mode: "insensitive" } },
//         ],
//       };
//     }

//     const SORTABLE = ["stageUpdatedAt", "createdAt", "submittedAt"];
//     const orderBy = SORTABLE.includes(sortBy)
//       ? { [sortBy]: sortDir as "asc" | "desc" }
//       : { stageUpdatedAt: "desc" as const };

//     const [total, pipelines] = await Promise.all([
//       prisma.requirementCandidatePipeline.count({ where }),
//       prisma.requirementCandidatePipeline.findMany({
//         where,
//         select: {
//           id: true,
//           isRejected: true,
//           isWithdrawn: true,
//           isOnHold: true,
//           rejectionReason: true,
//           withdrawnReason: true,
//           onHoldReason: true,
//           stageUpdatedAt: true,
//           createdAt: true,

//           // submission
//           submittedAt: true,
//           submissionNote: true,

//           // offer
//           offeredCtc: true,
//           salaryCurrency: true,
//           salaryType: true,
//           offeredAt: true,
//           offerStatus: true,
//           expectedJoiningDate: true,
//           actualJoiningDate: true,

//           currentStage: {
//             select: { id: true, code: true, label: true, order: true },
//           },

//           // full stage history for this candidate in this requirement
//           stageHistory: {
//             select: {
//               id: true,
//               fromStage: { select: { id: true, code: true, label: true } },
//               toStage: { select: { id: true, code: true, label: true } },
//               changedBy: {
//                 select: { id: true, firstName: true, lastName: true },
//               },
//               wasSkipped: true,
//               skipReason: true,
//               timeInPrevStageMins: true,
//               note: true,
//               createdAt: true,
//             },
//             orderBy: { createdAt: "asc" },
//           },

//           snapshot: {
//             select: {
//               id: true,
//               candidateServiceId: true,
//               fullName: true,
//               email: true,
//               phone: true,
//               currentTitle: true,
//               currentCompany: true,
//               totalExpYears: true,
//               topSkills: true,
//               resumeUrl: true,
//               snapshotAt: true,
//               rawSnapshot: true, // full candidate blob from candidate service
//             },
//           },

//           assignment: {
//             select: {
//               id: true,
//               depth: true,
//               assignedTo: {
//                 select: {
//                   id: true,
//                   firstName: true,
//                   lastName: true,
//                   employeeId: true,
//                 },
//               },
//             },
//           },

//           recruiter: {
//             select: {
//               id: true,
//               firstName: true,
//               lastName: true,
//               employeeId: true,
//             },
//           },

//           submittedBy: {
//             select: { id: true, firstName: true, lastName: true },
//           },
//           offeredBy: { select: { id: true, firstName: true, lastName: true } },
//           rejectedBy: { select: { id: true, firstName: true, lastName: true } },
//           stageUpdatedBy: {
//             select: { id: true, firstName: true, lastName: true },
//           },
//         },
//         orderBy,
//         skip,
//         take,
//       }),
//     ]);

//     // ── Compute aging for each candidate
//     const enriched = pipelines.map((p) => ({
//       ...p,
//       aging: computeAging(p.stageUpdatedAt),
//     }));

//     return res.json({
//       success: true,
//       data: enriched,
//       meta: {
//         total,
//         page: parseInt(page),
//         limit: take,
//         pages: Math.ceil(total / take),
//       },
//     });
//   } catch (err) {
//     console.error("getCandidates:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch candidates" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/activities
// Requirement activity log — all events on this requirement
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
// GET /requirements/:id/candidates/:pipelineId
// Single candidate full detail in this requirement
// ─────────────────────────────────────────────────────────────────────────────
// export const getCandidateDetail = async (req: Request, res: Response) => {
//   try {
//     const { id: requirementId, pipelineId } = req.params;

//     const pipeline = await prisma.requirementCandidatePipeline.findFirst({
//       where: { id: pipelineId, requirementId },
//       select: {
//         id: true,
//         isRejected: true,
//         rejectedAt: true,
//         rejectionReason: true,
//         isWithdrawn: true,
//         withdrawnAt: true,
//         withdrawnReason: true,
//         isOnHold: true,
//         onHoldAt: true,
//         onHoldReason: true,
//         stageUpdatedAt: true,
//         submittedAt: true,
//         submissionNote: true,
//         offeredCtc: true,
//         salaryCurrency: true,
//         salaryType: true,
//         offeredAt: true,
//         offerStatus: true,
//         expectedJoiningDate: true,
//         actualJoiningDate: true,
//         createdAt: true,
//         updatedAt: true,

//         currentStage: {
//           select: { id: true, code: true, label: true, order: true },
//         },
//         stageUpdatedBy: {
//           select: { id: true, firstName: true, lastName: true },
//         },

//         stageHistory: {
//           select: {
//             id: true,
//             wasSkipped: true,
//             skipReason: true,
//             timeInPrevStageMins: true,
//             note: true,
//             createdAt: true,
//             fromStage: {
//               select: { id: true, code: true, label: true, order: true },
//             },
//             toStage: {
//               select: { id: true, code: true, label: true, order: true },
//             },
//             changedBy: {
//               select: { id: true, firstName: true, lastName: true },
//             },
//           },
//           orderBy: { createdAt: "asc" },
//         },

//         snapshot: {
//           select: {
//             id: true,
//             candidateServiceId: true,
//             snapshotAt: true,
//             fullName: true,
//             email: true,
//             phone: true,
//             currentTitle: true,
//             currentCompany: true,
//             totalExpYears: true,
//             topSkills: true,
//             resumeUrl: true,
//             rawSnapshot: true,
//           },
//         },

//         assignment: {
//           select: {
//             id: true,
//             depth: true,
//             assignedTo: {
//               select: {
//                 id: true,
//                 firstName: true,
//                 lastName: true,
//                 employeeId: true,
//               },
//             },
//           },
//         },
//         recruiter: { select: { id: true, firstName: true, lastName: true } },
//         submittedBy: { select: { id: true, firstName: true, lastName: true } },
//         offeredBy: { select: { id: true, firstName: true, lastName: true } },
//         rejectedBy: { select: { id: true, firstName: true, lastName: true } },
//       },
//     });

//     if (!pipeline) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Candidate pipeline not found" });
//     }

//     return res.json({
//       success: true,
//       data: {
//         ...pipeline,
//         aging: computeAging(pipeline.stageUpdatedAt),
//       },
//     });
//   } catch (err) {
//     console.error("getCandidateDetail:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch candidate detail" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// ALL EXISTING CONTROLLERS BELOW — UNTOUCHED
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
      byStatusRaw.map((r) => [r.status, r._count._all]),
    );
    const byPriority = Object.fromEntries(
      byPriorityRaw.map((r) => [r.priority, r._count._all]),
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

// export const getRequirements = async (req: Request, res: Response) => {
//   try {
//     const {
//       search,
//       status,
//       buId,
//       serviceLineId,
//       clientId,
//       priority,
//       page = "1",
//       limit = "25",
//       sortBy = "createdAt",
//       sortDir = "desc",
//     } = req.query as Record<string, string>;

//     const userId = req.user!.id;
//     const isSuperAdmin = req.user!.isSuperAdmin;
//     const skip = (parseInt(page) - 1) * parseInt(limit);
//     const take = Math.min(parseInt(limit), 100);
//     const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
//     const where: any = { ...scopeWhere, deletedAt: null };

//     if (status) where.status = status;
//     if (priority) where.priority = priority;
//     if (clientId) where.clientId = clientId;
//     if (serviceLineId) where.serviceLineId = serviceLineId;
//     if (buId) where.businessUnit = { ancestorIds: { has: buId } };
//     if (search) {
//       where.AND = [
//         ...(where.AND ?? []),
//         {
//           OR: [
//             { title: { contains: search, mode: "insensitive" } },
//             { reqCode: { contains: search, mode: "insensitive" } },
//             { skills: { has: search } },
//           ],
//         },
//       ];
//     }

//     const SORTABLE = [
//       "createdAt",
//       "updatedAt",
//       "respondBy",
//       "priority",
//       "status",
//     ];
//     const orderBy = SORTABLE.includes(sortBy)
//       ? { [sortBy]: sortDir as "asc" | "desc" }
//       : { createdAt: "desc" as const };

//     const [total, requirements] = await Promise.all([
//       prisma.requirement.count({ where }),
//       prisma.requirement.findMany({
//         where,
//         select: {
//           id: true,
//           reqCode: true,
//           title: true,
//           status: true,
//           priority: true,
//           jobType: true,
//           remoteType: true,
//           location: true,
//           skills: true,
//           totalOpenings: true,
//           filledOpenings: true,
//           activeApplications: true,
//           interviewsScheduled: true,
//           offersRolledOut: true,
//           respondBy: true,
//           isRespondByBreached: true,
//           isTurnaroundBreached: true,
//           createdAt: true,
//           client: { select: { id: true, name: true } },
//           businessUnit: { select: { id: true, name: true } },
//           serviceLine: { select: { id: true, name: true } },
//           clientSpoc: {
//             select: {
//               handler: {
//                 select: { id: true, firstName: true, lastName: true },
//               },
//             },
//           },
//           createdBy: { select: { id: true, firstName: true, lastName: true } },
//           assignments: {
//             where: { status: "ACTIVE", depth: 0 },
//             select: {
//               id: true,
//               depth: true,
//               assignedTo: {
//                 select: { id: true, firstName: true, lastName: true },
//               },
//             },
//           },
//           _count: { select: { pipelines: true, assignments: true } },
//         },
//         orderBy,
//         skip,
//         take,
//       }),
//     ]);

//     res.json({
//       success: true,
//       data: requirements,
//       meta: {
//         total,
//         page: parseInt(page),
//         limit: take,
//         pages: Math.ceil(total / take),
//       },
//       permissions: {
//         canAdd: req.modulePermission.canAdd,
//         canEdit: req.modulePermission.canEdit,
//         canDelete: req.modulePermission.canDelete,
//       },
//     });
//   } catch (err) {
//     console.error("getRequirements:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch requirements" });
//   }
// };

// File: requirement.controller.ts
// Path: src/controller/requirement.controller.ts
// REPLACE ONLY: getRequirements function

// File: requirements.controller.ts
// Path: src/controllers/requirements.controller.ts

// import { Request, Response } from "express";
// import { prisma } from "../lib/prisma";
// import { getRequirementScopeWhere } from "../lib/scopeHelpers";

/**
 * Build the set of recruiter IDs visible to `userId` based on their canViewScope.
 * Returns null when no recruiter filter should be applied (ALL / superAdmin).
 */
// async function getVisibleRecruiterIds(
//   userId: string,
//   isSuperAdmin: boolean,
//   canViewScope: PermissionScope
// ): Promise<string[] | null> {
//   // superAdmin or ALL scope → no recruiter filter
//   if (isSuperAdmin || canViewScope === PermissionScope.ALL) return null;

//   if (canViewScope === PermissionScope.OWN) return [userId];

//   if (canViewScope === PermissionScope.TEAM) {
//     // self + everyone whose teamLeadId = userId
//     const teamMembers = await prisma.user.findMany({
//       where: { teamLeadId: userId, isActive: true },
//       select: { id: true },
//     });
//     return [userId, ...teamMembers.map((u) => u.id)];
//   }

//   if (canViewScope === PermissionScope.REPORTING) {
//     // self + everyone whose reportingToId = userId (direct reportees — recruiters under DM)
//     const reportees = await prisma.user.findMany({
//       where: { reportingToId: userId, isActive: true },
//       select: { id: true },
//     });
//     return [userId, ...reportees.map((u) => u.id)];
//   }

//   // DEPARTMENT / BU fallback — treat same as REPORTING for now
//   const reportees = await prisma.user.findMany({
//     where: { reportingToId: userId, isActive: true },
//     select: { id: true },
//   });
//   return [userId, ...reportees.map((u) => u.id)];
// }

// export const getRequirements = async (req: Request, res: Response) => {
//   try {
//     const {
//       search,
//       status,
//       buId,
//       serviceLineId,
//       clientId,
//       priority,
//       page = "1",
//       limit = "25",
//       sortBy = "createdAt",
//       sortDir = "desc",
//     } = req.query as Record<string, string>;

//     const userId = req.user!.id;
//     const isSuperAdmin = req.user!.isSuperAdmin;
//     const canViewScope: PermissionScope =
//       req.modulePermission?.canViewScope ?? PermissionScope.OWN;

//     const skip = (parseInt(page) - 1) * parseInt(limit);
//     const take = Math.min(parseInt(limit), 100);

//     const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
//     const where: any = { ...scopeWhere, deletedAt: null };

//     if (status) where.status = status;
//     if (priority) where.priority = priority;
//     if (clientId) where.clientId = clientId;
//     if (serviceLineId) where.serviceLineId = serviceLineId;
//     if (buId) where.businessUnit = { ancestorIds: { has: buId } };
//     if (search) {
//       where.AND = [
//         ...(where.AND ?? []),
//         {
//           OR: [
//             { title: { contains: search, mode: "insensitive" } },
//             { reqCode: { contains: search, mode: "insensitive" } },
//             { skills: { has: search } },
//           ],
//         },
//       ];
//     }

//     const SORTABLE = [
//       "createdAt",
//       "updatedAt",
//       "respondBy",
//       "priority",
//       "status",
//     ];
//     const orderBy = SORTABLE.includes(sortBy)
//       ? { [sortBy]: sortDir as "asc" | "desc" }
//       : { createdAt: "desc" as const };

//     const [total, requirements] = await Promise.all([
//       prisma.requirement.count({ where }),
//       prisma.requirement.findMany({
//         where,
//         select: {
//           id: true,
//           reqCode: true,
//           title: true,
//           status: true,
//           priority: true,
//           jobType: true,
//           remoteType: true,
//           // location: true,
//           // skills: true,
//           totalOpenings: true,
//           city: true,
//           state: true,
//           country: true,
//           primarySkills: true,
//           keySkills: true,
//           jobOpenFor: true,
//           targetDate: true,
//           closureReason: true,
//           jdParseStatus: true,
//           // filledOpenings: true,
//           // activeApplications: true,
//           // interviewsScheduled: true,
//           // offersRolledOut: true,
//           respondBy: true,
//           isRespondByBreached: true,
//           isTurnaroundBreached: true,
//           createdAt: true,
//           serviceLineId: true,
//           client: { select: { id: true, name: true } },
//           businessUnit: { select: { id: true, name: true } },
//           serviceLine: { select: { id: true, name: true } },
//           clientSpoc: {
//             select: {
//               handler: {
//                 select: { id: true, firstName: true, lastName: true },
//               },
//             },
//           },
//           createdBy: { select: { id: true, firstName: true, lastName: true } },
//           assignments: {
//             where: { status: "ACTIVE" },
//             select: {
//               id: true,
//               depth: true,
//               allocatedOpenings: true,
//               deadline: true,
//               assignedTo: {
//                 select: { id: true, firstName: true, lastName: true },
//               },
//             },
//             orderBy: { depth: "asc" },
//           },
//           _count: { select: { pipelines: true, assignments: true } },
//         },
//         orderBy,
//         skip,
//         take,
//       }),
//     ]);

//     if (!requirements.length) {
//       return res.json({
//         success: true,
//         data: [],
//         meta: {
//           total,
//           page: parseInt(page),
//           limit: take,
//           pages: Math.ceil(total / take),
//         },
//         permissions: {
//           canAdd: req.modulePermission.canAdd,
//           canEdit: req.modulePermission.canEdit,
//           canDelete: req.modulePermission.canDelete,
//         },
//       });
//     }

//     // ── Split requirements into two buckets:
//     //    1. createdByMe  → show full pipeline counts (no recruiter filter)
//     //    2. assignedOnly → filter pipeline counts by scope-derived recruiter IDs
//     const reqIds = requirements.map((r) => r.id);
//     const createdByMeIds = new Set(
//       requirements.filter((r) => r.createdBy.id === userId).map((r) => r.id)
//     );
//     const assignedOnlyIds = reqIds.filter((id) => !createdByMeIds.has(id));

//     // ── Resolve visible recruiter IDs for scope-filtered bucket (one DB call)
//     const visibleRecruiterIds = await getVisibleRecruiterIds(
//       userId,
//       isSuperAdmin,
//       canViewScope
//     );

//     // ── Fetch pipeline stages lookup
//     const allStages = await prisma.pipelineStage.findMany({
//       where: { isActive: true },
//       select: {
//         id: true,
//         code: true,
//         label: true,
//         order: true,
//         serviceLineId: true,
//       },
//       orderBy: { order: "asc" },
//     });
//     const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

//     // ── Run both groupBy queries in parallel
//     const [fullCounts, scopedCounts] = await Promise.all([
//       // Bucket 1 — created by me: no recruiter filter, full counts
//       createdByMeIds.size > 0
//         ? prisma.requirementCandidatePipeline.groupBy({
//             by: ["requirementId", "currentStageId"],
//             where: { requirementId: { in: [...createdByMeIds] } },
//             _count: { id: true },
//           })
//         : Promise.resolve([]),

//       // Bucket 2 — assigned only: recruiter-filtered counts
//       assignedOnlyIds.length > 0
//         ? prisma.requirementCandidatePipeline.groupBy({
//             by: ["requirementId", "currentStageId"],
//             where: {
//               requirementId: { in: assignedOnlyIds },
//               // null visibleRecruiterIds means ALL scope — no filter
//               ...(visibleRecruiterIds !== null
//                 ? { recruiterId: { in: visibleRecruiterIds } }
//                 : {}),
//             },
//             _count: { id: true },
//           })
//         : Promise.resolve([]),
//     ]);

//     // ── Merge both result sets into countsByReq
//     type StageCount = {
//       stageId: string;
//       code: string;
//       label: string;
//       order: number;
//       count: number;
//     };

//     const countsByReq: Record<string, StageCount[]> = {};

//     const pushToCountsByReq = (rows: typeof fullCounts) => {
//       for (const sc of rows as any[]) {
//         const stage = stageById[sc.currentStageId];
//         if (!stage) continue;
//         if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = [];
//         countsByReq[sc.requirementId].push({
//           stageId: sc.currentStageId,
//           code: stage.code,
//           label: stage.label,
//           order: stage.order,
//           count: sc._count.id,
//         });
//       }
//     };

//     pushToCountsByReq(fullCounts);
//     pushToCountsByReq(scopedCounts);

//     // Sort each req's stages by order
//     for (const key of Object.keys(countsByReq)) {
//       countsByReq[key].sort((a, b) => a.order - b.order);
//     }

//     const enrichedRequirements = requirements.map((r) => ({
//       ...r,
//       pipelineStageCounts: countsByReq[r.id] ?? [],
//     }));

//     res.json({
//       success: true,
//       data: enrichedRequirements,
//       meta: {
//         total,
//         page: parseInt(page),
//         limit: take,
//         pages: Math.ceil(total / take),
//       },
//       permissions: {
//         canAdd: req.modulePermission.canAdd,
//         canEdit: req.modulePermission.canEdit,
//         canDelete: req.modulePermission.canDelete,
//       },
//     });
//   } catch (err) {
//     console.error("getRequirements:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch requirements" });
//   }
// };

// File: requirements.controller.ts
// Path: src/controllers/requirements.controller.ts

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
        // location: true,
        country: true,
        // skills: true,
        experienceMin: true,
        experienceMax: true,
        salaryMin: true,
        salaryMax: true,
        salaryType: true,
        totalOpenings: true,
        // filledOpenings: true,
        // activeApplications: true,
        // interviewsScheduled: true,
        // offersRolledOut: true,
        startDate: true,
        // endDate: true,
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
        saleValue: true,
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

    // ── Pipeline stage counts — same two-bucket logic as getRequirements
    const isCreatedByMe = requirement.createdBy.id === userId;

    const visibleRecruiterIds = isCreatedByMe
      ? null // creator sees full counts — skip scope resolution entirely
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
          // null = no filter (creator or ALL scope)
          ...(visibleRecruiterIds !== null
            ? { recruiterId: { in: visibleRecruiterIds } }
            : {}),
        },
        _count: { id: true },
      }),
    ]);

    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    const pipelineStageCounts = stageCounts
      .map((sc: any) => {
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
      .filter(Boolean)
      .sort((a: any, b: any) => a.order - b.order);

    res.json({
      success: true,
      data: { ...requirement, pipelineStageCounts },
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
      where: {
        requirementId,
        status: "ACTIVE",
      },
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

// coerce any incoming value to number | null — handles strings, empty, NaN
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
export const createRequirement = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const body = req.body;

    // ── Validate SPOC ─────────────────────────────────────────────────────
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

    // ── Validate band belongs to client (if provided) ─────────────────────
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

    // ── Dates ─────────────────────────────────────────────────────────────
    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    const targetDate = body.targetDate ? new Date(body.targetDate) : null;

    // auto-compute — never trust client value
    const turnaroundDays = targetDate
      ? Math.ceil(
          (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    const clientName = spoc.client?.name ?? "CLNT";
    const serviceLineName = spoc.serviceLine?.name ?? "SRVC";
    const reqCode = await generateReqCode(clientName, serviceLineName);

    //get parsed JD
    // let parsedJD = null;
    // if (body.parsedJDId) {
    //   parsedJD = await prisma.parsedJDLibrary.findUnique({
    //     where: {
    //       id: body.parsedJDId,
    //     },
    //   });

    //   if (!parsedJD || !parsedJD.isActive) {
    //     return res.status(400).json({
    //       success: false,
    //       message: "Invalid or inactive parsed JD",
    //     });
    //   }
    // }

    // ── Fix #2: Resolve JD file from ParsedJDLibrary — never trust body.jdFileKey ──
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
        return res.status(400).json({
          success: false,
          message: "Invalid or inactive parsed JD",
        });
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

    const requirement = await prisma.requirement.create({
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

        // jdFileKey: body.jdFileKey ?? null,
        // jdFileName: body.jdFileName ?? null,
        // jdFileType: body.jdFileType ?? null,
        // jdUploadedAt: body.jdFileKey ? new Date() : null,
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

        // ── NEW ──────────────────────────────────────────────────────────
        bandId: body.bandId ?? null,
        saleValue: body.saleValue != null ? Number(body.saleValue) : null,
      },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        createdAt: true,
      },
    });

    await prisma.requirementActivity.create({
      data: {
        requirementId: requirement.id,
        actorId,
        type: "REQUIREMENT_CREATED",
        summary: `Requirement ${reqCode} created`,
      },
    });

    // ── Push to JD library for future cloning ─────────────────────────────
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
        libErr,
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
        suggestedTitle: `${original.title} (Copy)`,
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
// Body: { title: string } — ONLY title comes from body.
// Every other field is read directly from the original requirement in DB.
// This bypasses all createRequirement validation (clientSpocId, jobType, etc.)
// because nothing is sourced from req.body except the new title.
// ─────────────────────────────────────────────────────────────────────────────
export const duplicateRequirement = async (req: Request, res: Response) => {
  try {
    const actorId = req.user!.id;
    const { id } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Title must be at least 3 characters",
      });
    }

    // ── Fetch the full original from DB — nothing from req.body ──────────────
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

    // ── Fresh reqCode ─────────────────────────────────────────────────────────
    const clientName = original.client?.name ?? "CLNT";
    const serviceLineName = original.serviceLine?.name ?? "SRVC";
    const reqCode = await generateReqCode(clientName, serviceLineName);

    // ── Recompute turnaroundDays (startDate = now) ────────────────────────────
    const startDate = new Date();
    const targetDate = original.targetDate ?? null;
    const turnaroundDays = targetDate
      ? Math.ceil(
          (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    // ── Create duplicate ──────────────────────────────────────────────────────
    // Every field sourced from `original` — zero dependency on req.body beyond title.
    const duplicate = await prisma.requirement.create({
      data: {
        reqCode,

        // ── Only field from body ──────────────────────────────────────────────
        title: title.trim(),

        // ── Copied verbatim from original ─────────────────────────────────────
        description: original.description,
        jobType: original.jobType,
        remoteType: original.remoteType,
        priority: original.priority,
        jobOpenFor: original.jobOpenFor,
        totalOpenings: original.totalOpenings,

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
        saleValue: original.saleValue,
        requirementCategoryId: original.requirementCategoryId,

        // ── Relations — all from original ─────────────────────────────────────
        clientSpocId: original.clientSpocId,
        clientId: original.clientId,
        businessUnitId: original.businessUnitId,
        serviceLineId: original.serviceLineId,

        // ── JD — file ref copied, parse metadata reset ────────────────────────
        jdFileKey: original.jdFileKey,
        jdFileName: original.jdFileName,
        jdFileType: original.jdFileType,
        jdUploadedAt: original.jdUploadedAt,
        jdParsedAt: null,
        jdParseStatus: null,
        jdParsedFields: [],
        parsedJDId: original.parsedJDId,

        // ── Dates ─────────────────────────────────────────────────────────────
        startDate,
        targetDate,
        respondBy: null,
        turnaroundDays,

        // ── Status — always fresh ─────────────────────────────────────────────
        status: "ACTIVE",
        closureReason: null,
        closedAt: null,
        isRespondByBreached: false,
        isTurnaroundBreached: false,

        // ── Audit — new actor, cleared approvals ──────────────────────────────
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

    // ── Activity log ──────────────────────────────────────────────────────────
    await prisma.requirementActivity.create({
      data: {
        requirementId: duplicate.id,
        actorId,
        type: "REQUIREMENT_CREATED",
        summary: `Requirement ${reqCode} created as a duplicate of ${original.reqCode}`,
      },
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

const MAX_ROWS = 50;
const MIN_ROWS = 1;

export const bulkUploadRequirementsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // ─── 1. Validate file presence ──────────────────────────────────────────

    const file = req.file;
    if (!file) {
      res.status(400).json({
        success: false,
        error: "No file uploaded. Send the file under the field name 'file'.",
      });
      return;
    }

    // ─── 2. Actor — never trust body for createdById ──────────────────────

    const createdById = req.user!.id;

    // ─── 3. clientSpocId from body (selected via UI dropdown) ─────────────
    // clientId, businessUnitId, serviceLineId are derived from the SPOC.
    // They are never read from the Excel sheet.

    const { clientSpocId } = req.body;

    if (!clientSpocId) {
      res.status(400).json({
        success: false,
        error:
          "clientSpocId is required. Select a client and SPOC before uploading.",
      });
      return;
    }

    // ─── 4. Validate SPOC + derive all relational fields ─────────────────
    // Also fetch client name + service line name for reqCode generation.

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

    // ─── 5. Parse file into raw rows ──────────────────────────────────────

    let rawRows;
    try {
      rawRows = parseUploadedFile(
        file.buffer,
        file.mimetype,
        file.originalname,
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
      res.status(400).json({
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

    // ─── 6. Validate all rows ─────────────────────────────────────────────
    // Excel template: 2 instruction rows + 1 header row → data starts at row 4
    // CSV: 1 header row → data starts at row 2

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

    // ─── 7. Filter out invalid rows ───────────────────────────────────────

    const failedRowNumbers = new Set(allErrors.map((e) => e.row));
    const createableRows = validRows.filter(
      ({ rowNumber }) => !failedRowNumbers.has(rowNumber),
    );

    // ─── 8. Insert rows sequentially — NO $transaction ────────────────────

    const createdRequirementIds: string[] = [];
    const rowInsertErrors: RowValidationError[] = [];

    for (const { rowNumber, data } of createableRows) {
      try {
        // ─── Dedup check — skip if same title already exists for this client ──
        const duplicate = await prisma.requirement.findFirst({
          where: {
            title: { equals: data.title, mode: "insensitive" },
            clientId, // ← already available from SPOC lookup above
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
          continue; // ← skip to next row, don't insert
        }
        // generateReqCode is scoped to SL + client + year —
        // no collision possible between different clients or service lines.
        // Sequential inserts within the same client/SL are safe because
        // each commit is visible before the next call.
        const reqCode = await generateReqCode(clientName, serviceLineName);

        const startDate = data.startDate ?? new Date();
        const targetDate = data.targetDate ?? null;
        const turnaroundDays = targetDate
          ? Math.ceil(
              (targetDate.getTime() - startDate.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null;

        const created = await prisma.requirement.create({
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
            // ── From SPOC lookup — never from the sheet ──────────────────
            clientId,
            clientSpocId,
            businessUnitId: businessUnitId ?? null,
            serviceLineId: serviceLineId ?? null,
            description: data.description ?? null,
            createdById,
          },
          select: { id: true },
        });

        createdRequirementIds.push(created.id);
      } catch (rowErr) {
        // Row failed — log and continue, don't abort remaining rows
        console.error(`[bulkUpload] Row ${rowNumber} insert failed:`, rowErr);
        rowInsertErrors.push({
          row: rowNumber,
          field: "insert",
          message: "Failed to create this requirement. Please retry this row.",
        });
      }
    }

    // ─── 9. Activity log (non-fatal) ──────────────────────────────────────

    if (createdRequirementIds.length > 0) {
      try {
        await prisma.requirementActivity.createMany({
          data: createdRequirementIds.map((requirementId) => ({
            requirementId,
            actorId: createdById,
            type: "REQUIREMENT_CREATED",
            summary: "Created via bulk upload",
            meta: { source: "bulk_upload" },
          })),
        });
      } catch (activityErr) {
        console.warn(
          "[bulkUpload] Activity log failed (non-fatal):",
          activityErr,
        );
      }
    }

    // ─── 10. Return result summary ────────────────────────────────────────

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
      error,
    );
    res.status(500).json({
      success: false,
      error: "Internal server error during bulk upload.",
    });
  }
};

export const updateRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    // ── Validate input ───────────────────────────────────────────────────────
    const parsed = updateRequirementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

    // ── Fetch existing requirement ───────────────────────────────────────────
    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        clientId: true,
        startDate: true,
        targetDate: true,
        reqCode: true,
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
      },
    });

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    }

    if (["CLOSED", "CANCELLED"].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot edit a closed or cancelled requirement",
      });
    }

    // ── SPOC / client change — derive related IDs from the new SPOC ─────────
    //
    // When clientSpocId is sent, we re-derive clientId, serviceLineId, and
    // businessUnitId from the SPOC row. This covers:
    //   • Pure SPOC change within the same client
    //   • Full client + SPOC change
    //
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
        return res.status(400).json({
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

    // ── Validate bandId belongs to the correct client ────────────────────────
    //
    // Use the newly derived clientId if SPOC is also changing, otherwise fall
    // back to the existing requirement's clientId. Pass null to clear the band.
    //
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
    // ── Fix #2: Resolve JD file from parsedJDId if a new one was uploaded ──
    // The edit form sends parsedJDId when the user uploads a new JD.
    // We never read jdFileKey directly from the body.
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
        return res.status(400).json({
          success: false,
          message: "Invalid or inactive parsed JD",
        });
      }

      jdFileUpdates = {
        parsedJDId: parsedJD.id,
        jdFileKey: parsedJD.jdFileKey,
        jdFileName: parsedJD.jdFileName,
        jdFileType: parsedJD.jdFileType,
        jdUploadedAt: parsedJD.jdFileKey ? new Date() : null,
      };
    } else if (body.parsedJDId === null) {
      // Explicit null = clear the JD
      jdFileUpdates = {
        parsedJDId: null,
        jdFileKey: null,
        jdFileName: null,
        jdFileType: null,
        jdUploadedAt: null,
      };
    }
    // If parsedJDId is not in body at all — preserve existing file, no changes
    // ── Auto-compute turnaroundDays ───────────────────────────────────────────
    //
    // If either date is being changed and the caller didn't send turnaroundDays
    // explicitly, compute it from the resolved start + target values.
    //
    let computedTurnaround: number | null | undefined = undefined; // undefined = don't touch

    if (body.turnaroundDays !== undefined) {
      // Caller sent it directly — trust it.
      computedTurnaround = body.turnaroundDays;
    } else if (body.startDate !== undefined || body.targetDate !== undefined) {
      // At least one date is changing — recompute.
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
          (resolvedTarget.getTime() - resolvedStart.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        computedTurnaround = days > 0 ? days : null;
      } else {
        // One of the dates was cleared — clear the turnaround too.
        computedTurnaround = null;
      }
    }

    // ── Build update data ────────────────────────────────────────────────────
    //
    // Only spread a field when it was actually sent in the body (PATCH).
    // Explicit null values (e.g. bandId: null) are preserved so the column
    // can be cleared.
    //
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

    // if (body.jdFileKey !== undefined) {
    //   data.jdFileKey = body.jdFileKey;
    //   if (body.jdFileKey) data.jdUploadedAt = new Date();
    // }
    // if (body.jdFileName !== undefined) data.jdFileName = body.jdFileName;
    // if (body.jdFileType !== undefined) data.jdFileType = body.jdFileType;
    Object.assign(data, jdFileUpdates);

    if (body.jdParsedAt !== undefined)
      data.jdParsedAt = body.jdParsedAt ? new Date(body.jdParsedAt) : null;
    if (body.jdParseStatus !== undefined)
      data.jdParseStatus = body.jdParseStatus;
    if (body.jdParsedFields !== undefined)
      data.jdParsedFields = body.jdParsedFields;

    // Band + sale value — null is a valid value (clears the field)
    if (body.bandId !== undefined) data.bandId = body.bandId ?? null;
    if (body.saleValue !== undefined)
      data.saleValue = body.saleValue != null ? Number(body.saleValue) : null;

    // Derived SPOC/client fields — written as an atomic block
    if (derived) {
      data.clientSpocId = derived.clientSpocId;
      data.clientId = derived.clientId;
      data.serviceLineId = derived.serviceLineId;
      data.businessUnitId = derived.businessUnitId;
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const updated = await prisma.requirement.update({
      where: { id },
      data,
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        updatedAt: true,
        client: { select: { id: true, name: true } },
        clientSpoc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        serviceLine: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
        bandId: true,
        saleValue: true,
      },
    });

    // ── Activity log ─────────────────────────────────────────────────────────
    const activitySummary = derived
      ? `Client/SPOC changed on ${updated.reqCode}`
      : `Requirement ${updated.reqCode} updated`;

    await prisma.requirementActivity.create({
      data: {
        requirementId: id,
        actorId,
        type: "STATUS_CHANGED",
        summary: activitySummary,
        meta: derived
          ? {
              newClientId: derived.clientId,
              newSpocId: derived.clientSpocId,
              newServiceLineId: derived.serviceLineId,
              newBusinessUnitId: derived.businessUnitId,
            }
          : undefined,
      },
    });

    return res.json({
      success: true,
      message: "Requirement updated",
      data: updated,
    });
  } catch (err) {
    console.error("updateRequirement:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update requirement" });
  }
};

// export const updateRequirement = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const actorId = req.user!.id;
//     const body = req.body;

//     const existing = await prisma.requirement.findFirst({
//       where: { id, deletedAt: null },
//       select: { id: true, status: true, clientId: true },
//     });

//     if (!existing)
//       return res
//         .status(404)
//         .json({ success: false, message: "Requirement not found" });

//     if (["CLOSED", "CANCELLED"].includes(existing.status)) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot edit a closed or cancelled requirement",
//       });
//     }

//     // ── Client/SPOC change — derive everything from the SPOC ──────────────
//     let derived: {
//       clientId?: string;
//       clientSpocId?: string;
//       serviceLineId?: string;
//       businessUnitId?: string;
//     } | null = null;

//     if (body.clientSpocId !== undefined && body.clientSpocId !== null) {
//       const spoc = await prisma.clientSpoc.findUnique({
//         where: { id: body.clientSpocId },
//         select: {
//           clientId: true,
//           serviceLineId: true,
//           businessUnitId: true,
//           isActive: true,
//         },
//       });

//       if (!spoc || !spoc.isActive) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid or inactive SPOC selected",
//         });
//       }

//       derived = {
//         clientSpocId: body.clientSpocId,
//         clientId: spoc.clientId,
//         businessUnitId: spoc.businessUnitId,
//         serviceLineId: spoc.serviceLineId,
//       };
//     }

//     // ── Validate band belongs to the correct client ───────────────────────
//     // Use the derived clientId if SPOC is also changing, otherwise use existing
//     if (body.bandId !== undefined && body.bandId !== null) {
//       const targetClientId = derived?.clientId ?? existing.clientId;
//       const band = await prisma.band.findFirst({
//         where: { id: body.bandId, clientId: targetClientId },
//         select: { id: true },
//       });
//       if (!band) {
//         return res.status(400).json({
//           success: false,
//           message: "Selected band does not belong to this client",
//         });
//       }
//     }

//     const updated = await prisma.requirement.update({
//       where: { id },
//       data: {
//         ...(body.title !== undefined && { title: body.title }),
//         ...(body.description !== undefined && {
//           description: body.description,
//         }),
//         ...(body.jobType !== undefined && { jobType: body.jobType }),
//         ...(body.remoteType !== undefined && { remoteType: body.remoteType }),
//         ...(body.priority !== undefined && { priority: body.priority }),
//         ...(body.jobOpenFor !== undefined && { jobOpenFor: body.jobOpenFor }),
//         ...(body.totalOpenings !== undefined && {
//           totalOpenings: body.totalOpenings,
//         }),

//         ...(body.city !== undefined && { city: body.city }),
//         ...(body.state !== undefined && { state: body.state }),
//         ...(body.country !== undefined && { country: body.country }),

//         ...(body.experienceMin !== undefined && {
//           experienceMin: body.experienceMin,
//         }),
//         ...(body.experienceMax !== undefined && {
//           experienceMax: body.experienceMax,
//         }),

//         ...(body.salaryMin !== undefined && { salaryMin: body.salaryMin }),
//         ...(body.salaryMax !== undefined && { salaryMax: body.salaryMax }),
//         ...(body.salaryType !== undefined && { salaryType: body.salaryType }),
//         ...(body.salaryCurrency !== undefined && {
//           salaryCurrency: body.salaryCurrency,
//         }),
//         ...(body.bonusAmount !== undefined && {
//           bonusAmount: body.bonusAmount,
//         }),
//         ...(body.hideSalaryFromCandidate !== undefined && {
//           hideSalaryFromCandidate: body.hideSalaryFromCandidate,
//         }),
//         ...(body.showMedianSalary !== undefined && {
//           showMedianSalary: body.showMedianSalary,
//         }),

//         ...(body.primarySkills !== undefined && {
//           primarySkills: body.primarySkills,
//         }),
//         ...(body.keySkills !== undefined && { keySkills: body.keySkills }),
//         ...(body.targetCompanies !== undefined && {
//           targetCompanies: body.targetCompanies,
//         }),
//         ...(body.noPoachCompanies !== undefined && {
//           noPoachCompanies: body.noPoachCompanies,
//         }),

//         ...(body.education !== undefined && { education: body.education }),
//         ...(body.functionalArea !== undefined && {
//           functionalArea: body.functionalArea,
//         }),
//         ...(body.shift !== undefined && { shift: body.shift }),

//         ...(body.startDate !== undefined && {
//           startDate: body.startDate ? new Date(body.startDate) : null,
//         }),
//         ...(body.targetDate !== undefined && {
//           targetDate: body.targetDate ? new Date(body.targetDate) : null,
//         }),
//         ...(body.respondBy !== undefined && {
//           respondBy: body.respondBy ? new Date(body.respondBy) : null,
//         }),
//         ...(body.turnaroundDays !== undefined && {
//           turnaroundDays: body.turnaroundDays,
//         }),

//         ...(body.jdFileKey !== undefined && {
//           jdFileKey: body.jdFileKey,
//           jdUploadedAt: new Date(),
//         }),
//         ...(body.jdFileName !== undefined && { jdFileName: body.jdFileName }),
//         ...(body.jdFileType !== undefined && { jdFileType: body.jdFileType }),
//         ...(body.jdParsedAt !== undefined && {
//           jdParsedAt: body.jdParsedAt ? new Date(body.jdParsedAt) : null,
//         }),
//         ...(body.jdParseStatus !== undefined && {
//           jdParseStatus: body.jdParseStatus,
//         }),
//         ...(body.jdParsedFields !== undefined && {
//           jdParsedFields: body.jdParsedFields,
//         }),

//         // ── NEW ────────────────────────────────────────────────────────────
//         ...(body.bandId !== undefined && { bandId: body.bandId ?? null }),
//         ...(body.saleValue !== undefined && {
//           saleValue: body.saleValue != null ? Number(body.saleValue) : null,
//         }),

//         ...(derived && {
//           clientSpocId: derived.clientSpocId,
//           clientId: derived.clientId,
//           businessUnitId: derived.businessUnitId,
//           serviceLineId: derived.serviceLineId,
//         }),
//       },
//       select: {
//         id: true,
//         reqCode: true,
//         title: true,
//         status: true,
//         updatedAt: true,
//       },
//     });

//     await prisma.requirementActivity.create({
//       data: {
//         requirementId: id,
//         actorId,
//         type: "STATUS_CHANGED",
//         summary: derived
//           ? `Client/SPOC changed on ${updated.reqCode}`
//           : `Requirement ${updated.reqCode} updated`,
//       },
//     });

//     return res.json({
//       success: true,
//       message: "Requirement updated",
//       data: updated,
//     });
//   } catch (err) {
//     console.error("updateRequirement:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to update requirement" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/jd
//
// Fix #1: Never store signed URLs. Generate on demand here, gated by auth.
// Returns a short-lived URL (1 hour) for the frontend to open in a new tab.
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirementJDSignedUrl = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;

    // 1. First check if this is an existing Requirement
    const requirement = await prisma.requirement.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
      },
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
        // url,
        fileName: requirement.jdFileName,
        fileType: requirement.jdFileType,
      });
    }

    // 2. If not a Requirement, check ParsedJDLibrary
    const parsedJD = await prisma.parsedJDLibrary.findFirst({
      where: {
        id,
        isActive: true,
      },
      select: {
        jdFileKey: true,
        jdFileName: true,
        jdFileType: true,
      },
    });

    if (parsedJD) {
      if (!parsedJD.jdFileKey) {
        return res.status(404).json({
          success: false,
          message: "No JD file attached",
        });
      }

      const url = await getSignedDownloadUrl(parsedJD.jdFileKey);

      return res.json({
        success: true,
        url,
        fileName: parsedJD.jdFileName,
        fileType: parsedJD.jdFileType,
      });
    }

    // 3. Neither exists
    return res.status(404).json({
      success: false,
      message: "JD not found",
    });
  } catch (err) {
    console.error("getRequirementJDSignedUrl:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to generate JD download URL",
    });
  }
};

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
        title: true, // ← add
        priority: true, // ← add
        totalOpenings: true, // ← add
        client: { select: { name: true } }, // ← add
        serviceLine: { select: { name: true } }, // ← add
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

    // ── respond immediately ───────────────────────────────────────────────────
    res.json({ success: true, message: "Status updated", data: updated });

    // ── fetch all active assignees and email them (non-blocking) ─────────────
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

      // send one email per assignee
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
                    <td style="padding:10px;">${existing.client?.name ?? "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; font-weight:bold;">Service Line</td>
                    <td style="padding:10px;">${existing.serviceLine?.name ?? "—"}</td>
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
          }),
        ),
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

    // ── Normalise to array — works for both single and bulk ──────────────────
    const ids: string[] = assignedToIds?.length
      ? assignedToIds
      : [assignedToId];

    // ── 1. Validate requirement ───────────────────────────────────────────────
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

    // ── 2. Validate parent once ───────────────────────────────────────────────
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

    // ── 3. Fetch existing active assignments in one query ─────────────────────
    const existingActive = await prisma.requirementAssignment.findMany({
      where: { requirementId, assignedToId: { in: ids }, status: "ACTIVE" },
      select: { assignedToId: true },
    });
    const alreadyAssigned = new Set(existingActive.map((e) => e.assignedToId));

    // ── 4. Fetch assignee metadata in one query ───────────────────────────────
    const assigneeUsers = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, departmentId: true, firstName: true, lastName: true },
    });
    const assigneeMap = new Map(assigneeUsers.map((u) => [u.id, u]));

    // ── 5. Process each id ────────────────────────────────────────────────────
    type ItemResult =
      | { assignedToId: string; status: "created"; assignment: object }
      | { assignedToId: string; status: "skipped"; reason: string };

    const results: ItemResult[] = [];

    for (const id of ids) {
      if (alreadyAssigned.has(id)) {
        results.push({
          assignedToId: id,
          status: "skipped",
          reason: "Already actively assigned",
        });
        continue;
      }
      const assignee = assigneeMap.get(id);
      if (!assignee) {
        results.push({
          assignedToId: id,
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
              assignedToId: id,
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

        results.push({ assignedToId: id, status: "created", assignment });
        alreadyAssigned.add(id); // prevent same-batch duplicate
      } catch (err) {
        console.error(`createAssignment — failed for ${id}:`, err);
        results.push({
          assignedToId: id,
          status: "skipped",
          reason: "Internal error",
        });
      }
    }

    const created = results.filter((r) => r.status === "created");
    const skipped = results.filter((r) => r.status === "skipped");

    // ── 6. Response — single returns flat object, bulk returns array ──────────
    if (ids.length === 1) {
      if (created.length === 1) {
        const createdAssignment = (created[0] as any).assignment;

        res.status(201).json({
          success: true,
          message: "Assignment created",
          data: createdAssignment,
        });

        // ── send email after response ───────────────────────────────────────
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
                ? `${fullReq.experienceMin ?? 0} – ${fullReq.experienceMax ?? "?"} yrs`
                : "Not specified";

            await sendMail({
              to: assigneeUser.email,
              subject: `New Requirement Assigned: ${fullReq.reqCode} – ${fullReq.title}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1E3A5F;">You have a new requirement assigned</h2>
                  <p>Hi ${assigneeUser.firstName},</p>
                  <p><strong>${req.user!.firstName} ${req.user!.lastName}</strong> has assigned the following requirement to you.</p>
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
                      <td style="padding:10px;">${fullReq.client?.name ?? "—"}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Service Line</td>
                      <td style="padding:10px;">${fullReq.serviceLine?.name ?? "—"}</td>
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
                      <td style="padding:10px;">${(fullReq.primarySkills ?? []).join(", ") || "—"}</td>
                    </tr>
                    <tr style="background:#f0f4f8;">
                      <td style="padding:10px; font-weight:bold;">Your Deadline</td>
                      <td style="padding:10px;">${deadlineStr}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px; font-weight:bold;">Respond By</td>
                      <td style="padding:10px;">${fullReq.respondBy ? new Date(fullReq.respondBy).toDateString() : "Not set"}</td>
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

    // Bulk response
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

// async function getVisibleRecruiterIds(
//   userId: string,
//   isSuperAdmin: boolean,
//   canViewScope: PermissionScope
// ): Promise<string[] | null> {
//   if (isSuperAdmin || canViewScope === PermissionScope.ALL) return null;
//   if (canViewScope === PermissionScope.OWN) return [userId];
//   if (canViewScope === PermissionScope.TEAM) {
//     const teamMembers = await prisma.user.findMany({
//       where: { teamLeadId: userId, isActive: true },
//       select: { id: true },
//     });
//     return [userId, ...teamMembers.map((u) => u.id)];
//   }
//   if (canViewScope === PermissionScope.REPORTING) {
//     const reportees = await prisma.user.findMany({
//       where: { reportingToId: userId, isActive: true },
//       select: { id: true },
//     });
//     return [userId, ...reportees.map((u) => u.id)];
//   }
//   const reportees = await prisma.user.findMany({
//     where: { reportingToId: userId, isActive: true },
//     select: { id: true },
//   });
//   return [userId, ...reportees.map((u) => u.id)];
// }

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/:id/candidates
// Paginated, scope-filtered pipeline rows for a requirement
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

    if (visibleRecruiterIds !== null) {
      where.recruiterId = { in: visibleRecruiterIds };
    }
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
          recruiter: {
            select: { id: true, firstName: true, lastName: true },
          },
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
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
      );
      return {
        ...p,
        aging: {
          minutes: agingMins,
          label: formatAgingLabel(agingMins),
        },
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
// GET /requirements/:id/candidates/:pipelineId
// Full single candidate detail — snapshot + complete stage history with aging
// ─────────────────────────────────────────────────────────────────────────────
export const getRequirementCandidateById = async (
  req: Request,
  res: Response,
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
        recruiter: {
          select: { id: true, firstName: true, lastName: true },
        },
        stageUpdatedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        submittedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        offeredBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        rejectedBy: {
          select: { id: true, firstName: true, lastName: true },
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
      (Date.now() - new Date(pipeline.stageUpdatedAt).getTime()) / 60000,
    );

    const totalPipelineMins =
      pipeline.stageHistory.reduce(
        (sum, log) => sum + (log.timeInPrevStageMins ?? 0),
        0,
      ) + agingMins;

    res.json({
      success: true,
      data: {
        ...pipeline,
        aging: {
          minutes: agingMins,
          label: formatAgingLabel(agingMins),
        },
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
// GET /requirements/:id/candidates  (getCandidates variant)
// Paginated, filtered candidate pipeline list with aging
// Query params:
//   stageCode, stageId, assignmentId, recruiterId
//   isRejected, isWithdrawn, isOnHold, activeOnly (bool)
//   search (fullName, email, phone, currentCompany)
//   page, limit, sortBy (stageUpdatedAt | createdAt | aging), sortDir
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
// GET /requirements/:id/candidates/:pipelineId  (getCandidateDetail variant)
// Single candidate full detail in this requirement
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
      data: {
        ...pipeline,
        aging: computeAging(pipeline.stageUpdatedAt),
      },
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

// File: requirement.controller.ts
// Path: src/controller/requirement.controller.ts
//
// CHANGES IN THIS PATCH:
//
// 1. getRequirements — scope default changed from "assigned to me" view to
//    "created by me + my reporting line" view. New query param `createdByScope`
//    controls this:
//      - "OWN"       → only requirements I created (default)
//      - "TEAM"      → mine + team members I lead
//      - "REPORTING" → mine + direct reportees
//      - "ALL"       → superAdmin only
//
// 2. exportRequirements — new controller. Returns:
//      - Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
//      - Sheet 1: Requirements summary with canonical stage counts
//      - Sheet 2: All candidates across those requirements with full history + aging
//
// 3. Canonical stages are NEVER hardcoded. All stage labels/codes come from
//    prisma.pipelineStage and CanonicalStage enum from @prisma/client.
//
// ─────────────────────────────────────────────────────────────────────────────

// import prisma from "@/utils/prisma/client";
// import { Request, Response } from "express";
// import { PermissionScope, CanonicalStage } from "@prisma/client";
// import {
//   generateReqCode,
//   getRequirementScopeWhere,
// } from "@/services/requirementService";
// import { getSubordinateIds } from "@/services/orgService";

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: getVisibleRecruiterIds (scope filter for pipeline counts)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /requirements/export
//
// Downloads an Excel workbook (.xlsx) with two sheets:
//
// Sheet 1 — Requirements summary
//   Columns: Req Code | Title | Status | Priority | Client | BU | Service Line |
//            City | Country | Job Type | Remote | Total Openings | Created By |
//            Created At | Days Open | Respond By | Breached? |
//            + one column per canonical stage (from DB, never hardcoded)
//
// Sheet 2 — Candidates
//   Columns: Req Code | Req Title | Candidate Name | Email | Phone |
//            Current Title | Current Company | Exp (yrs) | Top Skills |
//            Current Stage | Canonical Stage | Recruiter |
//            Added On | Days in Current Stage | Total Pipeline Days |
//            Is Rejected | Is Withdrawn | Is On Hold |
//            Submitted At | Offer Status | Actual Joining Date
//
// Respects the same createdByScope + filters as getRequirements.
// ─────────────────────────────────────────────────────────────────────────────

async function getVisibleRecruiterIds(
  userId: string,
  isSuperAdmin: boolean,
  canViewScope: PermissionScope,
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

// ─────────────────────────────────────────────────────────────────────────────
// UTIL: getCreatorScopeUserIds
//
// Controls WHICH requirements are visible based on who created them.
// This is the new "creator scope" — separate from the pipeline count scope.
//
//   "OWN"       → [userId]
//   "TEAM"      → userId + users whose teamLeadId = userId
//   "REPORTING" → userId + direct reportees (reportingToId = userId)
//   "ALL"       → null (no filter — superAdmin only)
//
// Returns null when no filter should be applied.
// ─────────────────────────────────────────────────────────────────────────────

async function getCreatorScopeUserIds(
  userId: string,
  isSuperAdmin: boolean,
  createdByScope: string,
): Promise<string[] | null> {
  // Only ALL scope (explicit opt-in) removes the creator filter entirely.
  // isSuperAdmin does NOT auto-bypass — even a superAdmin clicking "Mine"
  // should only see requirements they personally created.
  if (createdByScope === "ALL") return null;

  if (createdByScope === "OWN") {
    return [userId];
  }

  // if (createdByScope === "TEAM") {
  //   const teamMembers = await prisma.user.findMany({
  //     where: { teamLeadId: userId, isActive: true },
  //     select: { id: true },
  //   });
  //   return [userId, ...teamMembers.map((u) => u.id)];
  // }

  if (createdByScope === "TEAM") {
    const teamMembers = await prisma.user.findMany({
      where: {
        OR: [{ teamLeadId: userId }, { reportingToId: userId }],
        isActive: true,
      },
      select: { id: true },
    });
    return [userId, ...teamMembers.map((u) => u.id)];
  }

  if (createdByScope === "REPORTING") {
    // Direct reportees (reportingToId = userId) — typically recruiters under a DM
    const reportees = await prisma.user.findMany({
      where: { reportingToId: userId, isActive: true },
      select: { id: true },
    });
    return [userId, ...reportees.map((u) => u.id)];
  }

  // Default fallback: OWN
  return [userId];
}

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE COMPUTATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

export function computeSaleValue(input: {
  saleValue?: number | null;
  totalOpenings: number;
  salaryMin?: number | null;
  band?: { value?: number | null } | null;
  client?: { percentageValue?: number | null } | null;
}): {
  computedSaleValue: number | null;
  saleValueBasis: "SALE_VALUE" | "BAND" | "FIXED_PCT" | "SALARY_MIN" | null;
} {
  const openings = input.totalOpenings ?? 1;
  if (input.saleValue != null && input.saleValue > 0)
    return {
      computedSaleValue: input.saleValue * openings,
      saleValueBasis: "SALE_VALUE",
    };
  const bandValue = input.band?.value != null ? Number(input.band.value) : null;
  if (bandValue != null && bandValue > 0)
    return { computedSaleValue: bandValue * openings, saleValueBasis: "BAND" };
  const salMin = input.salaryMin != null ? Number(input.salaryMin) : null;
  const pct =
    input.client?.percentageValue != null
      ? Number(input.client.percentageValue)
      : null;
  if (pct != null && pct > 0 && salMin != null && salMin > 0)
    return {
      computedSaleValue: salMin * (pct / 100) * openings,
      saleValueBasis: "FIXED_PCT",
    };
  if (salMin != null && salMin > 0)
    return {
      computedSaleValue: salMin * openings,
      saleValueBasis: "SALARY_MIN",
    };
  return { computedSaleValue: null, saleValueBasis: null };
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
  },
  userId: string,
  isSuperAdmin: boolean,
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
// resolveManagerSets — walk reportingTo chain upward per creator (batched)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveManagerSets(
  creatorIds: string[],
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
      },
      userId,
      isSuperAdmin,
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
              Math.round((terminalCount / r.totalOpenings) * 1000) / 10,
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
      isSuperAdmin,
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
      SALARY_MIN: { count: 0, total: 0 },
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

      if (computedSaleValue != null && saleValueBasis != null) {
        totalSaleValue += computedSaleValue;
        byBasis[saleValueBasis].count++;
        byBasis[saleValueBasis].total += computedSaleValue;

        // Terminal count for this req (service-line-aware)
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
      } else {
        omittedCount++;
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
          statusCounts.map((s) => [s.status, s._count.id]),
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
  res: Response,
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
      isSuperAdmin,
    );

    // Minimal fields — only what's needed for computation
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
        meta: { terminalStageDefs: [] },
      });
    }

    const reqIds = requirements.map((r) => r.id);

    // ── Fetch terminal stage definitions ──────────────────────────────────────
    // isTerminal = true only. Service-line scoped if filter is active.
    const terminalStageDefs = await prisma.pipelineStage.findMany({
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

    const terminalStageIds = terminalStageDefs.map((s) => s.id);

    // ── Count candidates in terminal stages per requirement ───────────────────
    // Single groupBy — only terminal stage rows, no complexity
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

    // Build: { reqId → { stageId → count } }
    const terminalByReq: Record<string, Record<string, number>> = {};
    for (const tc of terminalCounts as any[]) {
      if (!terminalByReq[tc.requirementId])
        terminalByReq[tc.requirementId] = {};
      terminalByReq[tc.requirementId][tc.currentStageId] = tc._count.id;
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

      // Total funnel — all candidates ever linked (simple _count)
      const totalFunnelCount = r._count.pipelines;

      // Terminal counts — per stage, service-line-aware
      const reqTerminal = terminalByReq[r.id] ?? {};
      const terminalStageCounts: Record<string, number> = {};
      let terminalCount = 0;

      for (const tsDef of terminalStageDefs) {
        // Skip stage if it belongs to a different service line
        if (tsDef.serviceLineId && tsDef.serviceLineId !== r.serviceLineId)
          continue;
        const cnt = reqTerminal[tsDef.id] ?? 0;
        terminalStageCounts[tsDef.id] = cnt;
        terminalCount += cnt;
      }

      const achievedPct =
        r.totalOpenings > 0
          ? Math.min(
              100,
              Math.round((terminalCount / r.totalOpenings) * 1000) / 10,
            )
          : 0;

      const achievedValue =
        computedSaleValue != null && r.totalOpenings > 0
          ? (terminalCount / r.totalOpenings) * computedSaleValue
          : null;

      return {
        requirementId: r.id,
        totalOpenings: r.totalOpenings,
        totalFunnelCount,
        terminalCount,
        terminalStageCounts, // { stageId → count } — frontend maps against terminalStageDefs
        achievedPct,
        computedSaleValue,
        achievedValue,
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
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
// File: exportRequirements.ts
// Path: src/controllers/exportRequirements.ts

// ─────────────────────────────────────────────────────────────────────────────
// exportRequirements
//
// Sheet 1 — Requirements: one row per requirement
//   • Fixed info columns (code, title, status, priority, client, SPOC, BU, SL, …)
//   • Sale Value section (RBAC-gated: only for creator + their managers up chain)
//       Band Code / Band Name / Band Range / Band Value / Client % /
//       Salary Min / Salary Max / Req. Sale Value / Computed Sale Value / Basis
//   • computedSaleValue shown to everyone (not RBAC-gated)
//   • Achieved section (terminal stage headcounts + achieved value)
//       one column per terminal stage (from DB, not hardcoded) + Achieved % + Achieved Value
//   • Summary row at bottom: totals for computedSaleValue and achievedValue
//
// Sheet 2 — Candidates: one row per pipeline entry
//
// Filters: same as getRequirements (uses buildRequirementsWhere)
// Cap: 1000 requirements
// ─────────────────────────────────────────────────────────────────────────────

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
      isSuperAdmin,
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
        (now - new Date(r.createdAt).getTime()) / 86400000,
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
        0,
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
        bandCode: canSeeSale ? (r.band?.code ?? "") : "—",
        bandName: canSeeSale ? (r.band?.name ?? "") : "—",
        bandRange:
          canSeeSale && band?.rangeFrom != null && band?.rangeTo != null
            ? `${band.rangeFrom} – ${band.rangeTo}`
            : canSeeSale
              ? ""
              : "—",
        bandValue: canSeeSale ? (band?.value ?? "") : "—",
        clientPct: canSeeSale ? (clientPct ?? "") : "—",
        salaryMin: canSeeSale ? (r.salaryMin ?? "") : "—",
        salaryMax: canSeeSale ? (r.salaryMax ?? "") : "—", // NEW
        reqSaleValue: canSeeSale ? (r.saleValue ?? "") : "—",
        computedSaleValue: computedSaleValue ?? "", // EVERYONE sees this
        saleValueBasis: canSeeSale ? (saleValueBasis ?? "N/A") : "—",

        // Achieved — everyone
        ...Object.fromEntries(
          terminalStages.map((ts) => [
            `term_${ts.id}`,
            termCountPerStage[ts.id] ?? 0,
          ]),
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
        (c) => c.key === "computedSaleValue",
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
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
      );
      const totalPipelineMins =
        (p.stageHistory ?? []).reduce(
          (sum: number, log: any) => sum + (log.timeInPrevStageMins ?? 0),
          0,
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
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
