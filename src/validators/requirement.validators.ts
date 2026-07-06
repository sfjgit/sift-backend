// validators/requirement.validators.ts
import { CandidateDisposition } from "@prisma/client";
import { z } from "zod";

export const addNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(2000).trim(),
});
// add to: src/validators/requirement.validators.ts
// next to your other pipeline schemas (rollOfferSchema, submitCandidateSchema, etc.)

export const updatePipelineDetailsSchema = z.object({
  currentCtc: z.number().nonnegative().nullable().optional(),
  expectedCtc: z.number().nonnegative().nullable().optional(),
  negotiatedCtc: z.number().nonnegative().nullable().optional(),
  ctcNotes: z.string().max(1000).nullable().optional(),
  lastWorkingDate: z.string().datetime().nullable().optional(),
  actualJoiningDate: z.string().datetime().nullable().optional(),
});

export type UpdatePipelineDetailsInput = z.infer<
  typeof updatePipelineDetailsSchema
>;
export const createRequirementSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  description: z.string().max(5000).optional().nullable(),
  clientSpocId: z.string().min(1, "SPOC is required"),
  jobType: z.enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"]),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  jobOpenFor: z.enum(["EXTERNAL", "INTERNAL", "BOTH"]).default("EXTERNAL"),
  totalOpenings: z.number().min(1).default(1),

  // location — split
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),

  experienceMin: z.coerce.number().min(0).optional().nullable(),
  experienceMax: z.coerce.number().min(0).optional().nullable(),

  salaryMin: z.coerce.number().min(0).optional().nullable(),
  salaryMax: z.coerce.number().min(0).optional().nullable(),
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  salaryCurrency: z.string().max(10).default("INR"),
  bonusAmount: z.number().min(0).optional().nullable(),
  hideSalaryFromCandidate: z.boolean().default(false),
  showMedianSalary: z.boolean().default(false),

  // skills — split
  primarySkills: z.array(z.string().trim()).default([]),
  keySkills: z.array(z.string().trim()).default([]),

  education: z.string().max(300).optional().nullable(),
  functionalArea: z.string().max(200).optional().nullable(),
  shift: z.string().max(100).optional().nullable(),

  targetCompanies: z.array(z.string().trim()).default([]),
  noPoachCompanies: z.array(z.string().trim()).default([]),

  startDate: z.string().datetime().optional().nullable(),
  targetDate: z.string().datetime().optional().nullable(), // renamed from endDate
  respondBy: z.string().datetime().optional().nullable(),
  turnaroundDays: z.number().min(1).optional().nullable(),

  jdFileKey: z.string().optional().nullable(),
  jdFileName: z.string().optional().nullable(),
  jdFileType: z.string().optional().nullable(),

  // JD parse metadata — set by parser, passed through from frontend
  jdParsedAt: z.string().datetime().optional().nullable(),
  jdParseStatus: z
    .enum(["PARSED", "FAILED", "MANUALLY_OVERRIDDEN"])
    .optional()
    .nullable(),
  jdParsedFields: z.array(z.string()).default([]),
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

export const createAssignmentSchema = z
  .object({
    assignedToId: z.string().min(1).optional(),
    assignedToIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    deadline: z.string().datetime({ offset: true }).optional().nullable(),
    parentAssignmentId: z.string().optional().nullable(),
  })
  .refine(
    (data) =>
      data.assignedToId ||
      (data.assignedToIds && data.assignedToIds.length > 0),
    {
      message: "assignedToId or assignedToIds is required",
    },
  );

// export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

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

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR
// add to: src/validators/requirement.validators.ts
// ─────────────────────────────────────────────────────────────────────────────

export const updateDispositionSchema = z
  .object({
    disposition: z.enum(CandidateDisposition),
    dropReason: z.string().max(500).optional().nullable(),
    dropNote: z.string().max(500).optional().nullable(),
    holdNote: z.string().max(500).optional().nullable(),
    actualJoiningDate: z.string().datetime().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.disposition === CandidateDisposition.DROPPED && !data.dropReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dropReason"],
        message: "dropReason is required when disposition is DROPPED",
      });
    }
    if (data.disposition === CandidateDisposition.ON_HOLD && !data.holdNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdNote"],
        message: "holdNote is required when disposition is ON_HOLD",
      });
    }
  });

export type UpdateDispositionInput = z.infer<typeof updateDispositionSchema>;
