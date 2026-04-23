import { z } from "zod";
import {
  RequirementType,
  RemoteType,
  Priority,
  RequirementStatus,
  AssignmentType,
  AssignmentStatus,
  DocumentEventType,
} from "@prisma/client";

export const RequirementTypeEnum = z.enum(RequirementType);
export const RemoteTypeEnum = z.enum(RemoteType);
export const PriorityEnum = z.enum(Priority);
export const RequirementStatusEnum = z.enum(RequirementStatus);

export const createRequirementsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  clientId: z.string(),
  clientContactId: z.string().optional(),
  businessUnitId: z.string().optional(),
  jobType: RequirementTypeEnum,
  remoteType: RemoteTypeEnum,
  priority: PriorityEnum.optional(),
  totalOpenings: z.number().int().positive().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryType: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  respondBy: z.string().datetime().optional(),
  turnaroundDays: z.number().int().optional(),
  createdById: z.string().optional(),
  deliveryLeadId: z.string().uuid().optional(),
  teamLeadId: z.string().uuid().optional(),
});

export const getAllRequirementsSchema = z.object({
  status: z
    .enum([
      "DRAFT",
      "PENDING_APPROVAL",
      "ACTIVE",
      "ON_HOLD",
      "CLOSED",
      "CANCELLED",
    ])
    .optional(),

  clientId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),

  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),

  jobType: z
    .enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"])
    .optional(),

  search: z.string().min(1).optional(),

  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1)),

  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 25))
    .pipe(z.number().int().min(1).max(100)),
});

export const getRequirementParamsSchema = z.object({
  id: z.string(),
});

export const approveRequirementParamsSchema = z.object({
  id: z.string(),
});

export const approveRequirementBodySchema = z
  .object({
    deliveryLeadId: z.string().optional(),
    teamLeadId: z.string().optional(),
  })
  .optional();

export const changeRequirementStatusParamsSchema = z.object({
  id: z.string(),
});

export const changeRequirementStatusBodySchema = z
  .object({
    status: z
      .enum([
        "DRAFT",
        "PENDING_APPROVAL",
        "ACTIVE",
        "ON_HOLD",
        "CLOSED",
        "CANCELLED",
      ])
      .optional(),
    reason: z.string().optional(),
  })
  .optional();

export const assignRequirementParamsSchema = z.object({
  id: z.string(),
});

export const assignRequirementBodySchema = z
  .object({
    assignmentType: z.enum(AssignmentType),
    status: z.enum(AssignmentStatus).default("ACTIVE"),
    recruiterId: z.string().optional(),
    teamId: z.string().optional(),
    allocatedOpenings: z.number().int().optional(),
    isAutoRouted: z.boolean().optional(),
    isSystemAssigned: z.boolean().optional(),
  })
  .optional();

export const addNotesParamsSchema = z.object({
  id: z.string(),
});

export const addNotesBodySchema = z.object({
  notes: z.string(),
});

export const getRequirementStatusHistoryParamsSchema = z.object({
  id: z.string(),
});

export const fillAssignmentParamsSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
});

export const fillAssignmentBodySchema = z.object({
  filledOpenings: z.number().int().positive(),
});

export const uploadDocumentsParamsSchema = z.object({
  id: z.string(),
});

export const uploadDocumentsBodySchema = z.object({
  type: z.enum(DocumentEventType),
});

export const resolveIssuesParamsSchema = z.object({
  id: z.string(),
  documentId: z.string(),
});
