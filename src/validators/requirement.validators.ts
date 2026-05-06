// validators/requirement.validators.ts
import { z } from "zod";

// add to requirement.validators.ts

export const addNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(2000).trim(),
});

export type AddNoteInput = z.infer<typeof addNoteSchema>;

export const createRequirementSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  description: z.string().max(5000).optional().nullable(),
  clientSpocId: z.string().min(1, "SPOC is required"),
  jobType: z.enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"]),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  location: z.string().max(200).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  experienceMin: z.number().min(0).optional().nullable(),
  experienceMax: z.number().min(0).optional().nullable(),
  salaryMin: z.number().min(0).optional().nullable(),
  salaryMax: z.number().min(0).optional().nullable(),
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  skills: z.array(z.string().trim()).default([]),
  totalOpenings: z.number().min(1).default(1),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  respondBy: z.string().datetime().optional().nullable(),
  turnaroundDays: z.number().min(1).optional().nullable(),
  jdFileKey: z.string().optional().nullable(),
  jdFileName: z.string().optional().nullable(),
  jdFileType: z.string().optional().nullable(),
});

export const updateRequirementSchema = createRequirementSchema
  .omit({ clientSpocId: true })
  .partial();

export const updateRequirementStatusSchema = z.object({
  status: z.enum([
    "DRAFT",
    "PENDING_APPROVAL",
    "ACTIVE",
    "ON_HOLD",
    "CLOSED",
    "CANCELLED",
  ]),
  reason: z.string().max(500).optional().nullable(),
});

export const createAssignmentSchema = z.object({
  assignedToId: z.string().min(1, "Assignee is required"),
  allocatedOpenings: z.number().min(1).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  parentAssignmentId: z.string().optional().nullable(),
});

export const updateCandidateStageSchema = z.object({
  currentStage: z.enum([
    "SOURCED",
    "SCREENING",
    "SUBMITTED",
    "INTERVIEW_SCHEDULED",
    "INTERVIEW_DONE",
    "OFFER_ROLLED",
    "OFFER_ACCEPTED",
    "JOINED",
    "REJECTED",
    "WITHDRAWN",
  ]),
  rejectionReason: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const pushCandidateSchema = z.object({
  candidateId: z.string().min(1),
  candidateName: z.string().min(1),
  candidateEmail: z.string().email().optional().nullable(),
  assignmentId: z.string().optional().nullable(),
});

export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
