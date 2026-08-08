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

import ExcelJS from "exceljs";
import { parseUploadedFile } from "@/utils/bulkRequirementParser";
import { validateRequirementRow } from "@/utils/bulkRequirements";
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
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
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
    const reqCode = await generateReqCode(
      clientName,
      serviceLineName,
      // spoc.serviceLine.name
    );

    const requirement = await prisma.requirement.create({
      data: {
        reqCode,
        title: body.title,
        description: body.description ?? null,
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
        respondBy: null, // removed from form — always null on create
        turnaroundDays, // computed, never from body

        jdFileKey: body.jdFileKey ?? null,
        jdFileName: body.jdFileName ?? null,
        jdFileType: body.jdFileType ?? null,
        jdUploadedAt: body.jdFileKey ? new Date() : null,
        jdParsedAt: body.jdParsedAt ? new Date(body.jdParsedAt) : null,
        jdParseStatus: body.jdParseStatus ?? null,
        jdParsedFields: body.jdParsedFields ?? [],

        clientSpocId: body.clientSpocId,
        clientId: spoc.clientId,
        businessUnitId: spoc.businessUnitId,
        serviceLineId: spoc.serviceLineId,
        status: "ACTIVE",
        createdById: actorId,
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
    // Saved as parsedData so the library search + clone flow works identically
    // to a JD upload. Non-fatal — requirement is already created, don't fail.
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
        // meta — not used for cloning but useful for traceability
        _source: "requirement",
        _reqCode: reqCode,
        _reqId: requirement.id,
      };

      const existing = await prisma.parsedJDLibrary.findFirst({
        where: {
          title: { equals: body.title, mode: "insensitive" },
          isActive: true,
        },
        select: { id: true },
      });

      if (existing) {
        // update with latest data — most recent requirement wins
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
    const body = req.body;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Requirement not found" });
    if (["CLOSED", "CANCELLED"].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot edit a closed or cancelled requirement",
      });
    }
    // ── Client/SPOC change — derive everything from the SPOC, never trust the payload ──
    let derived: {
      clientId?: string;
      clientSpocId?: string;
      serviceLineId?: string;
      businessUnitId?: string;
    } | null = null;

    if (body.clientSpocId !== undefined && body.clientSpocId !== null) {
      // reuse the SAME resolver bulk-upload uses so behaviour never drifts
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
          message: "Invalid or inActive SPOC selected",
        });
      }

      derived = {
        clientSpocId: body.clientSpocId,
        clientId: spoc.clientId,
        businessUnitId: spoc.businessUnitId,
        serviceLineId: spoc.serviceLineId,
      };
    }
    const updated = await prisma.requirement.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.jobType !== undefined && { jobType: body.jobType }),
        ...(body.remoteType !== undefined && { remoteType: body.remoteType }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.jobOpenFor !== undefined && { jobOpenFor: body.jobOpenFor }),
        ...(body.totalOpenings !== undefined && {
          totalOpenings: body.totalOpenings,
        }),

        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.country !== undefined && { country: body.country }),

        ...(body.experienceMin !== undefined && {
          experienceMin: body.experienceMin,
        }),
        ...(body.experienceMax !== undefined && {
          experienceMax: body.experienceMax,
        }),

        ...(body.salaryMin !== undefined && { salaryMin: body.salaryMin }),
        ...(body.salaryMax !== undefined && { salaryMax: body.salaryMax }),
        ...(body.salaryType !== undefined && { salaryType: body.salaryType }),
        ...(body.salaryCurrency !== undefined && {
          salaryCurrency: body.salaryCurrency,
        }),
        ...(body.bonusAmount !== undefined && {
          bonusAmount: body.bonusAmount,
        }),
        ...(body.hideSalaryFromCandidate !== undefined && {
          hideSalaryFromCandidate: body.hideSalaryFromCandidate,
        }),
        ...(body.showMedianSalary !== undefined && {
          showMedianSalary: body.showMedianSalary,
        }),

        ...(body.primarySkills !== undefined && {
          primarySkills: body.primarySkills,
        }),
        ...(body.keySkills !== undefined && { keySkills: body.keySkills }),
        ...(body.targetCompanies !== undefined && {
          targetCompanies: body.targetCompanies,
        }),
        ...(body.noPoachCompanies !== undefined && {
          noPoachCompanies: body.noPoachCompanies,
        }),

        ...(body.education !== undefined && { education: body.education }),
        ...(body.functionalArea !== undefined && {
          functionalArea: body.functionalArea,
        }),
        ...(body.shift !== undefined && { shift: body.shift }),

        ...(body.startDate !== undefined && {
          startDate: body.startDate ? new Date(body.startDate) : null,
        }),
        ...(body.targetDate !== undefined && {
          targetDate: body.targetDate ? new Date(body.targetDate) : null,
        }),
        ...(body.respondBy !== undefined && {
          respondBy: body.respondBy ? new Date(body.respondBy) : null,
        }),
        ...(body.turnaroundDays !== undefined && {
          turnaroundDays: body.turnaroundDays,
        }),

        ...(body.jdFileKey !== undefined && {
          jdFileKey: body.jdFileKey,
          jdUploadedAt: new Date(),
        }),
        ...(body.jdFileName !== undefined && { jdFileName: body.jdFileName }),
        ...(body.jdFileType !== undefined && { jdFileType: body.jdFileType }),

        ...(body.jdParsedAt !== undefined && {
          jdParsedAt: body.jdParsedAt ? new Date(body.jdParsedAt) : null,
        }),
        ...(body.jdParseStatus !== undefined && {
          jdParseStatus: body.jdParseStatus,
        }),
        ...(body.jdParsedFields !== undefined && {
          jdParsedFields: body.jdParsedFields,
        }),
        ...(derived && {
          clientSpocId: derived.clientSpocId,
          clientId: derived.clientId,
          businessUnitId: derived.businessUnitId,
          serviceLineId: derived.serviceLineId,
        }),
      },
      select: {
        id: true,
        reqCode: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    });

    await prisma.requirementActivity.create({
      data: {
        requirementId: id,
        actorId,
        type: "STATUS_CHANGED",
        summary: derived
          ? `Client/SPOC changed on ${updated.reqCode}`
          : `Requirement ${updated.reqCode} updated`,
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

export const updateRequirementStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const actorId = req.user!.id;

    const existing = await prisma.requirement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, reqCode: true },
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
    // ── Client/SPOC change — derive everything from the SPOC, never trust the payload ──
    let derived: {
      clientId?: string;
      clientSpocId?: string;
      serviceLineId?: string;
      businessUnitId?: string;
    } = {};

    // if (body.clientSpocId !== undefined && body.clientSpocId !== null) {
    //   // reuse the SAME resolver bulk-upload uses so behaviour never drifts
    //   const spoc = await prisma.clientSpoc.findFirst({
    //     where: { id: body.clientSpocId, deletedAt: null },
    //     select: {
    //       id: true,
    //       clientId: true,
    //       serviceLineId: true,
    //       businessUnitId: true,
    //     },
    //   });

    //   if (!spoc) {
    //     return res
    //       .status(400)
    //       .json({ success: false, message: "Invalid SPOC selected" });
    //   }
    //   derived = {
    //     clientSpocId: spoc.id,
    //     clientId: spoc.clientId,
    //     serviceLineId: spoc.serviceLineId ?? undefined,
    //     businessUnitId: spoc.businessUnitId ?? undefined,
    //   };
    // }
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

    return res.json({
      success: true,
      message: "Status updated",
      data: updated,
    });
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
        return res.status(201).json({
          success: true,
          message: "Assignment created",
          data: (created[0] as any).assignment,
        });
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

// File: requirementCandidates.controller.ts
// Path: src/controllers/requirementCandidates.controller.ts

// import prisma from "@/utils/prisma/client";
// import { Request, Response } from "express";
// import { PermissionScope } from "@prisma/client";

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
// GET /requirements
//
// KEY CHANGE: default scope is now "requirements I created" (OWN).
// Use query param `createdByScope` to widen:
//   ?createdByScope=TEAM       → mine + team
//   ?createdByScope=REPORTING  → mine + reportees
//   ?createdByScope=ALL        → all (superAdmin only)
//
// The existing pipeline count scoping (canViewScope from RBAC) still controls
// which candidate counts are shown — that has NOT changed.
// ─────────────────────────────────────────────────────────────────────────────

export const getRequirements = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      priority,
      // NEW: which creators to show requirements for (default OWN)
      createdByScope = "OWN",
      // NEW: filter by a specific creator userId (superAdmin or manager use case)
      createdById,
      closedAt,
      closedById,
      dateFrom,
      dateTo,
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;
    const canViewScope: PermissionScope = (req.modulePermission?.canViewScope ??
      PermissionScope.OWN) as PermissionScope;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    // ── Base scope: requirements accessible to this user (existing service)
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
    const where: any = { ...scopeWhere, deletedAt: null };

    // ── Creator scope filter (NEW default behaviour)
    // If a specific createdById is passed, use that directly.
    // Otherwise, compute the set of userIds based on createdByScope.
    if (createdById) {
      // Direct filter — manager looking at a specific person's requirements
      where.createdById = createdById;
    } else {
      const creatorIds = await getCreatorScopeUserIds(
        userId,
        isSuperAdmin,
        createdByScope,
      );
      if (creatorIds !== null) {
        // Apply creator filter — only requirements made by these users
        where.createdById = { in: creatorIds };
      }
      // null means no filter (ALL / superAdmin)
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (clientId) where.clientId = clientId;
    if (serviceLineId) where.serviceLineId = serviceLineId;
    if (buId) where.businessUnit = { ancestorIds: { has: buId } };
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo
          ? { lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)) }
          : {}),
      };
    }

    if (search) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { reqCode: { contains: search, mode: "insensitive" } },
            { primarySkills: { has: search } },
            { keySkills: { has: search } },
          ],
        },
      ];
    }

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
          client: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
          serviceLine: { select: { id: true, name: true } },
          clientSpoc: {
            select: {
              handler: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
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

          _count: { select: { pipelines: true, assignments: true } },
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
        },
        permissions: {
          canAdd: req.modulePermission.canAdd,
          canEdit: req.modulePermission.canEdit,
          canDelete: req.modulePermission.canDelete,
        },
      });
    }

    // ── Pipeline stage counts (existing two-bucket logic, unchanged)
    const reqIds = requirements.map((r) => r.id);
    const createdByMeIds = new Set(
      requirements.filter((r) => r.createdBy.id === userId).map((r) => r.id),
    );
    const assignedOnlyIds = reqIds.filter((id) => !createdByMeIds.has(id));

    const visibleRecruiterIds = await getVisibleRecruiterIds(
      userId,
      isSuperAdmin,
      canViewScope,
    );

    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        serviceLineId: true,
        canonicalStage: true,
      },
      orderBy: { order: "asc" },
    });
    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    const [fullCounts, scopedCounts] = await Promise.all([
      createdByMeIds.size > 0
        ? prisma.requirementCandidatePipeline.groupBy({
            by: ["requirementId", "currentStageId"],
            where: { requirementId: { in: [...createdByMeIds] } },
            _count: { id: true },
          })
        : Promise.resolve([]),
      assignedOnlyIds.length > 0
        ? prisma.requirementCandidatePipeline.groupBy({
            by: ["requirementId", "currentStageId"],
            where: {
              requirementId: { in: assignedOnlyIds },
              ...(visibleRecruiterIds !== null
                ? { recruiterId: { in: visibleRecruiterIds } }
                : {}),
            },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    type StageCount = {
      stageId: string;
      code: string;
      label: string;
      order: number;
      canonicalStage: string | null;
      count: number;
    };

    const countsByReq: Record<string, StageCount[]> = {};

    const pushToCountsByReq = (rows: any[]) => {
      for (const sc of rows) {
        const stage = stageById[sc.currentStageId];
        if (!stage) continue;
        if (!countsByReq[sc.requirementId]) countsByReq[sc.requirementId] = [];
        countsByReq[sc.requirementId].push({
          stageId: sc.currentStageId,
          code: stage.code,
          label: stage.label,
          order: stage.order,
          canonicalStage: stage.canonicalStage ?? null,
          count: sc._count.id,
        });
      }
    };

    pushToCountsByReq(fullCounts as any[]);
    pushToCountsByReq(scopedCounts as any[]);

    for (const key of Object.keys(countsByReq)) {
      countsByReq[key].sort((a, b) => a.order - b.order);
    }

    // ── Aggregate canonical stage counts per requirement.
    // All canonical stage keys from DB are included (even zeros) so the
    // frontend table always has consistent columns regardless of candidate counts.
    const allCanonicalKeys: string[] = await prisma.pipelineStage
      .findMany({
        where: { isActive: true, canonicalStage: { not: null } },
        select: { canonicalStage: true },
        distinct: ["canonicalStage"],
        orderBy: { order: "asc" },
      })
      .then((rows) =>
        rows
          .map((r) => r.canonicalStage!)
          .filter((v, i, a) => a.indexOf(v) === i),
      );

    const canonicalCountsByReq: Record<string, Record<string, number>> = {};

    for (const [reqId, stageCounts] of Object.entries(countsByReq)) {
      // Start with all keys at zero — never hardcoded, pulled from DB
      const canonical: Record<string, number> = Object.fromEntries(
        allCanonicalKeys.map((k) => [k, 0]),
      );
      for (const sc of stageCounts) {
        if (!sc.canonicalStage) continue;
        canonical[sc.canonicalStage] =
          (canonical[sc.canonicalStage] ?? 0) + sc.count;
      }
      canonicalCountsByReq[reqId] = canonical;
    }

    // Requirements with zero candidates also get full zero-filled canonical map
    for (const r of requirements) {
      if (!canonicalCountsByReq[r.id]) {
        canonicalCountsByReq[r.id] = Object.fromEntries(
          allCanonicalKeys.map((k) => [k, 0]),
        );
      }
    }

    const enrichedRequirements = requirements.map((r) => ({
      ...r,
      pipelineStageCounts: countsByReq[r.id] ?? [],
      // Canonical stage rollup — dynamic, never hardcoded
      canonicalStageCounts: canonicalCountsByReq[r.id] ?? {},
    }));

    return res.json({
      success: true,
      data: enrichedRequirements,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      // Echo back the active scope so the frontend scope switcher reflects
      // the current state. isSuperAdmin is exposed separately.
      scope: {
        createdByScope,
        canViewScope,
        isSuperAdmin,
      },
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

export const exportRequirements = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      clientId,
      priority,
      createdByScope = "OWN",
      createdById,
      // createdBy,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    // const createdById = createdBy || null;

    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    // ── Build same where clause as getRequirements (no pagination)
    const scopeWhere = await getRequirementScopeWhere(userId, isSuperAdmin);
    const where: any = { ...scopeWhere, deletedAt: null };

    if (createdById) {
      where.createdById = createdById;
    } else {
      const creatorIds = await getCreatorScopeUserIds(
        userId,
        isSuperAdmin,
        createdByScope ?? "OWN",
      );
      if (creatorIds !== null) {
        where.createdById = { in: creatorIds };
      }
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (clientId) where.clientId = clientId;
    if (createdById) where.createdById = createdById;
    if (serviceLineId) where.serviceLineId = serviceLineId;
    if (buId) where.businessUnit = { ancestorIds: { has: buId } };
    // ✅ Date range filter on createdAt
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo
          ? { lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)) }
          : {}),
      };
    }
    if (search) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { reqCode: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }
    console.log("where", where);
    // ── Fetch requirements (no limit for export — capped at 1000 rows)
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
        client: { select: { name: true } },
        businessUnit: { select: { name: true } },
        serviceLine: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
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

    // ── Fetch all active pipeline stages from DB — no hardcoding
    const allStages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        order: true,
        canonicalStage: true,
        serviceLineId: true,
      },
      orderBy: { order: "asc" },
    });

    // ── Fetch all canonical stage keys from DB-backed enum
    // We read the distinct canonicalStage values that actually exist in PipelineStage
    // so export columns match what's configured — not what's in the Prisma enum.
    const canonicalStageKeys: string[] = await prisma.pipelineStage
      .findMany({
        where: { isActive: true, canonicalStage: { not: null } },
        select: { canonicalStage: true },
        distinct: ["canonicalStage"],
        orderBy: { order: "asc" },
      })
      .then((rows) =>
        rows
          .map((r) => r.canonicalStage!)
          .filter((v, i, a) => a.indexOf(v) === i),
      );

    // ── Fetch pipeline counts grouped by requirementId + currentStageId
    const stageCounts = await prisma.requirementCandidatePipeline.groupBy({
      by: ["requirementId", "currentStageId"],
      where: { requirementId: { in: reqIds } },
      _count: { id: true },
    });

    const stageById = Object.fromEntries(allStages.map((s) => [s.id, s]));

    // Build canonical count map per requirement
    // { reqId: { SOURCED: 3, SCREENING: 1, ... } }
    const canonicalByReq: Record<string, Record<string, number>> = {};
    for (const sc of stageCounts) {
      const stage = stageById[(sc as any).currentStageId];
      if (!stage?.canonicalStage) continue;
      if (!canonicalByReq[sc.requirementId])
        canonicalByReq[sc.requirementId] = {};
      canonicalByReq[sc.requirementId][stage.canonicalStage] =
        (canonicalByReq[sc.requirementId][stage.canonicalStage] ?? 0) +
        (sc as any)._count.id;
    }

    // ── Fetch all pipeline rows for Sheet 2
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
        currentStage: {
          select: { code: true, label: true, canonicalStage: true },
        },
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
        stageHistory: {
          select: { timeInPrevStageMins: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Build a lookup for requirement basic info
    const reqLookup = Object.fromEntries(requirements.map((r) => [r.id, r]));

    // ─────────────────────────────────────────────────────────────────────────
    // Build workbook
    // ─────────────────────────────────────────────────────────────────────────

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TalentOS";
    workbook.created = new Date();

    // ── Header style helpers
    const headerFill: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    const headerFont: Partial<ExcelJS.Font> = {
      color: { argb: "FFFFFFFF" },
      bold: true,
      size: 11,
    };
    const subHeaderFill: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2D5986" },
    };

    const applyHeaderRow = (
      row: ExcelJS.Row,
      fill: ExcelJS.Fill = headerFill,
    ) => {
      row.eachCell((cell) => {
        cell.fill = fill;
        cell.font = headerFont;
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

    // ── Sheet 1: Requirements summary ──────────────────────────────────────

    const sheet1 = workbook.addWorksheet("Requirements", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    // Fixed columns — date columns get numFmt at column level so Excel shows them correctly
    const fixedCols = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Title", key: "title", width: 40 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Client", key: "client", width: 24 },
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
      { header: "Total Candidates", key: "total", width: 16 },
    ];

    // Dynamic canonical stage columns — come from DB, never hardcoded.
    // Header uses title-case label (e.g. "Offer In Progress") not raw enum key.
    const canonicalCols = canonicalStageKeys.map((key) => ({
      header: key
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" "),
      key: `cs_${key}`,
      width: 14,
    }));

    sheet1.columns = [...fixedCols, ...canonicalCols];

    // Group header row (row 1): "Basic Info" spans fixed cols, "Pipeline Stages" spans dynamic cols
    const basicSpan = fixedCols.length;
    const stageSpan = canonicalCols.length;

    const groupRow = sheet1.getRow(1);
    groupRow.getCell(1).value = "Requirement Details";
    groupRow.getCell(basicSpan + 1).value =
      stageSpan > 0 ? "Pipeline Stages (from DB)" : "";
    sheet1.mergeCells(1, 1, 1, basicSpan);
    if (stageSpan > 0) {
      sheet1.mergeCells(1, basicSpan + 1, 1, basicSpan + stageSpan);
    }
    applyHeaderRow(groupRow);
    groupRow.getCell(basicSpan + 1).fill = subHeaderFill;

    // Column header row (row 2)
    const colHeaderRow = sheet1.getRow(2);
    [...fixedCols, ...canonicalCols].forEach((col, i) => {
      colHeaderRow.getCell(i + 1).value = col.header;
    });
    applyHeaderRow(colHeaderRow, subHeaderFill);

    // Data rows (start at row 3)
    const now = Date.now();
    for (const req of requirements) {
      const totalCandidates = Object.values(
        canonicalByReq[req.id] ?? {},
      ).reduce((s, n) => s + n, 0);
      const daysOpen = Math.floor(
        (now - new Date(req.createdAt).getTime()) / 86400000,
      );

      const rowData: Record<string, any> = {
        reqCode: req.reqCode,
        title: req.title,
        status: req.status,
        priority: req.priority,
        client: req.client?.name ?? "",
        bu: req.businessUnit?.name ?? "",
        sl: req.serviceLine?.name ?? "",
        city: req.city ?? "",
        country: req.country ?? "",
        jobType: req.jobType,
        remote: req.remoteType,
        openings: req.totalOpenings,
        createdBy: `${req.createdBy.firstName} ${req.createdBy.lastName}`,
        createdAt: new Date(req.createdAt),
        daysOpen,
        respondBy: req.respondBy ? new Date(req.respondBy) : "",
        breached:
          req.isRespondByBreached || req.isTurnaroundBreached ? "Yes" : "No",
        total: totalCandidates,
      };

      // Add canonical stage counts
      for (const key of canonicalStageKeys) {
        rowData[`cs_${key}`] = canonicalByReq[req.id]?.[key] ?? 0;
      }

      const dataRow = sheet1.addRow(rowData);
      dataRow.height = 20;

      // Colour code status cell
      const statusCell = dataRow.getCell("status");
      const statusColors: Record<string, string> = {
        ACTIVE: "FF00875A",
        CLOSED: "FFDE350B",
        ON_HOLD: "FFFF991F",
        PENDING_APPROVAL: "FF0052CC",
        DRAFT: "FF6B778C",
        CANCELLED: "FF5E6C84",
      };
      const statusColor = statusColors[req.status];
      if (statusColor) {
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: statusColor },
        };
        statusCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
      }

      // Colour breach cell
      if (req.isRespondByBreached || req.isTurnaroundBreached) {
        dataRow.getCell("breached").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDE350B" },
        };
        dataRow.getCell("breached").font = {
          color: { argb: "FFFFFFFF" },
          bold: true,
        };
      }

      // Format date cells — apply at cell level too for robustness
      const createdAtCell = dataRow.getCell("createdAt");
      createdAtCell.value = new Date(req.createdAt);
      createdAtCell.numFmt = "dd-mmm-yyyy";
      if (req.respondBy) {
        const respondByCell = dataRow.getCell("respondBy");
        respondByCell.value = new Date(req.respondBy);
        respondByCell.numFmt = "dd-mmm-yyyy";
      }
    }

    // Auto-filter on row 2
    sheet1.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: fixedCols.length + canonicalCols.length },
    };

    // ── Sheet 2: Candidates ────────────────────────────────────────────────

    const sheet2 = workbook.addWorksheet("Candidates", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet2.columns = [
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement Title", key: "reqTitle", width: 36 },
      { header: "Candidate Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Current Title", key: "title", width: 26 },
      { header: "Current Company", key: "company", width: 24 },
      { header: "Exp (yrs)", key: "exp", width: 10 },
      { header: "Top Skills", key: "skills", width: 40 },
      { header: "Current Stage", key: "stage", width: 20 },
      { header: "Canonical Stage", key: "canonical", width: 20 },
      { header: "Recruiter", key: "recruiter", width: 22 },
      { header: "Added On", key: "addedOn", width: 16, numFmt: "dd-mmm-yyyy" },
      { header: "Days in Current Stage", key: "stageAge", width: 20 },
      { header: "Current Stage Aging", key: "stageAgingLabel", width: 18 },
      { header: "Total Pipeline Days", key: "totalDays", width: 18 },
      { header: "Total Pipeline Aging", key: "totalAgingLabel", width: 18 },
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

    const s2Header = sheet2.getRow(1);
    applyHeaderRow(s2Header);

    for (const p of pipelines) {
      const req = reqLookup[p.requirementId];
      if (!req) continue;

      const stageAgeMins = Math.floor(
        (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
      );
      const totalPipelineMins =
        (p.stageHistory ?? []).reduce(
          (sum: number, log: any) => sum + (log.timeInPrevStageMins ?? 0),
          0,
        ) + stageAgeMins;

      const dataRow = sheet2.addRow({
        reqCode: req.reqCode,
        reqTitle: req.title,
        name: p.snapshot?.fullName ?? "",
        email: p.snapshot?.email ?? "",
        phone: p.snapshot?.phone ?? "",
        title: p.snapshot?.currentTitle ?? "",
        company: p.snapshot?.currentCompany ?? "",
        exp: p.snapshot?.totalExpYears ?? "",
        skills: (p.snapshot?.topSkills ?? []).join(", "),
        stage: p.currentStage?.label ?? "",
        canonical: p.currentStage?.canonicalStage ?? "",
        recruiter: p.recruiter
          ? `${p.recruiter.firstName} ${p.recruiter.lastName}`
          : "",
        addedOn: new Date(p.createdAt),
        stageAge: Math.floor(stageAgeMins / 1440), // days
        stageAgingLabel: formatAging(stageAgeMins),
        totalDays: Math.floor(totalPipelineMins / 1440),
        totalAgingLabel: formatAging(totalPipelineMins),
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

      // Flag rejected/withdrawn rows
      if (p.isRejected || p.isWithdrawn) {
        dataRow.eachCell((cell) => {
          cell.font = { ...cell.font, color: { argb: "FF7A869A" } };
        });
      }
    }

    sheet2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet2.columnCount },
    };

    // ── Stream to response
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
