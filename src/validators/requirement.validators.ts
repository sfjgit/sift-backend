// validators/requirement.validators.ts
import { z } from "zod";

export const addNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(2000).trim(),
});

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

// ── Candidate snapshot push — called by Candidate Service after ingest
// Core receives this and creates CandidateSnapshot + RequirementCandidatePipeline
export const pushCandidateSchema = z.object({
  candidateServiceId: z.string().min(1, "candidateServiceId is required"),
  assignmentId: z.string().optional().nullable(),
  recruiterId: z.string().min(1, "recruiterId is required"),
  // snapshot display fields — point-in-time copy
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  currentTitle: z.string().optional().nullable(),
  currentCompany: z.string().optional().nullable(),
  totalExpYears: z.number().optional().nullable(),
  topSkills: z.array(z.string()).default([]),
  resumeUrl: z.string().url().optional().nullable(),
  // full candidate profile blob from Candidate Service
  rawSnapshot: z.record(z.unknown()),
});

// ── Stage transition — stageId is the PipelineStage UUID from Core DB
// Validator only checks shape. Sequence enforcement is in pipelineService.ts.
export const updatePipelineStageSchema = z.object({
  stageId: z.string().min(1, "stageId is required"),
  skipReason: z.string().max(500).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

// ── Submission to client
export const submitCandidateSchema = z.object({
  submissionNote: z.string().min(1, "Submission note is required").max(2000),
});

// ── Offer
export const rollOfferSchema = z.object({
  offeredCtc: z.number().min(0),
  salaryCurrency: z.string().default("INR"),
  salaryType: z.enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"]),
  expectedJoiningDate: z.string().datetime().optional().nullable(),
});

// ── Offer response
export const updateOfferStatusSchema = z.object({
  offerStatus: z.enum(["ACCEPTED", "DECLINED", "REVOKED"]),
  actualJoiningDate: z.string().datetime().optional().nullable(),
  declineReason: z.string().max(500).optional().nullable(),
  revocationReason: z.string().max(500).optional().nullable(),
});

// ── Reject candidate
export const rejectCandidateSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required").max(500),
});

// ── Withdraw candidate
export const withdrawCandidateSchema = z.object({
  withdrawnReason: z.string().min(1, "Withdrawal reason is required").max(500),
});

// ── On hold
export const holdCandidateSchema = z.object({
  onHoldReason: z.string().min(1, "On-hold reason is required").max(500),
});

export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type PushCandidateInput = z.infer<typeof pushCandidateSchema>;
export type UpdatePipelineStageInput = z.infer<
  typeof updatePipelineStageSchema
>;
export type RollOfferInput = z.infer<typeof rollOfferSchema>;
