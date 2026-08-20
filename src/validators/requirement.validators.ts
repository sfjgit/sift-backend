// validators/requirement.validators.ts
import { CandidateDisposition } from "@prisma/client";
// import { z } from "zod";
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
  noticePeriod: z.number().nonnegative().nullable().optional(),
});

export type UpdatePipelineDetailsInput = z.infer<
  typeof updatePipelineDetailsSchema
>;
// File: requirement.schema.ts
// Path: src/validators/requirement.schema.ts

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const optionalString = z.string().max(300).optional().nullable();
const optionalNumber = z.coerce.number().min(0).optional().nullable();

// ─────────────────────────────────────────────────────────────────────────────
// CREATE SCHEMA — all required fields enforced
// ─────────────────────────────────────────────────────────────────────────────

export const createRequirementSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  description: z.string().max(15000).optional().nullable(),

  clientSpocId: z.string().min(1, "SPOC is required"),

  jobType: z.enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"]),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  jobOpenFor: z.enum(["EXTERNAL", "INTERNAL", "BOTH"]).default("EXTERNAL"),
  totalOpenings: z.number().min(1).default(1),

  // ── Location ────────────────────────────────────────────────────────────
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),

  // ── Experience ──────────────────────────────────────────────────────────
  experienceMin: optionalNumber,
  experienceMax: optionalNumber,

  // ── Compensation ────────────────────────────────────────────────────────
  salaryMin: optionalNumber,
  salaryMax: optionalNumber,
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  salaryCurrency: z.string().max(10).default("INR"),
  bonusAmount: z.coerce.number().min(0).optional().nullable(),
  hideSalaryFromCandidate: z.boolean().default(false),
  showMedianSalary: z.boolean().default(false),

  // ── Skills ──────────────────────────────────────────────────────────────
  primarySkills: z.array(z.string().trim()).default([]),
  keySkills: z.array(z.string().trim()).default([]),

  // ── Employment details ──────────────────────────────────────────────────
  education: z.string().max(300).optional().nullable(),
  functionalArea: z.string().max(200).optional().nullable(),
  shift: z.string().max(100).optional().nullable(),

  // ── Sourcing strategy ───────────────────────────────────────────────────
  targetCompanies: z.array(z.string().trim()).default([]),
  noPoachCompanies: z.array(z.string().trim()).default([]),

  // ── Timeline ────────────────────────────────────────────────────────────
  startDate: z.string().datetime().optional().nullable(),
  targetDate: z.string().datetime().optional().nullable(),
  respondBy: z.string().datetime().optional().nullable(),
  turnaroundDays: z.number().min(1).optional().nullable(),

  // ── JD file ─────────────────────────────────────────────────────────────
  // jdFileKey: z.string().optional().nullable(),
  // jdFileName: z.string().optional().nullable(),
  // jdFileType: z.string().optional().nullable(),

  parsedJDId: z.string().optional().nullable(),

  // ── JD parse metadata ───────────────────────────────────────────────────
  jdParsedAt: z.string().datetime().optional().nullable(),
  jdParseStatus: z
    .enum(["PARSED", "FAILED", "MANUALLY_OVERRIDDEN"])
    .optional()
    .nullable(),
  jdParsedFields: z.array(z.string()).default([]),

  // ── Band & Sale Value ────────────────────────────────────────────────────
  // bandId is validated against the client at controller level
  bandId: z.string().optional().nullable(),
  saleValue: z.coerce.number().min(0).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE SCHEMA
//
// Identical shape to createRequirementSchema but:
//   • Every field is optional (PATCH semantics — only send what changed)
//   • clientSpocId is INCLUDED (not omitted) so the SPOC/client can be
//     changed from the edit form. The controller derives clientId,
//     serviceLineId, and businessUnitId from the new SPOC automatically.
//   • bandId / saleValue included so compensation context is editable.
//
// The controller guards against null clientSpocId — the field must either
// be omitted (no change) or a valid non-empty string.
// ─────────────────────────────────────────────────────────────────────────────

export const updateRequirementSchema = z.object({
  title: z.string().min(1).max(300).trim().optional(),
  description: z.string().max(5000).optional().nullable(),

  // Optional SPOC change — when present it must be a non-empty UUID.
  // The controller will re-derive clientId / serviceLineId / businessUnitId.
  clientSpocId: z.string().min(1, "SPOC must be a valid ID").optional(),

  jobType: z
    .enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"])
    .optional(),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  jobOpenFor: z.enum(["EXTERNAL", "INTERNAL", "BOTH"]).optional(),
  totalOpenings: z.number().min(1).optional(),

  // ── Location ────────────────────────────────────────────────────────────
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),

  // ── Experience ──────────────────────────────────────────────────────────
  experienceMin: optionalNumber,
  experienceMax: optionalNumber,

  // ── Compensation ────────────────────────────────────────────────────────
  salaryMin: optionalNumber,
  salaryMax: optionalNumber,
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  salaryCurrency: z.string().max(10).optional(),
  bonusAmount: z.coerce.number().min(0).optional().nullable(),
  hideSalaryFromCandidate: z.boolean().optional(),
  showMedianSalary: z.boolean().optional(),

  // ── Skills ──────────────────────────────────────────────────────────────
  primarySkills: z.array(z.string().trim()).optional(),
  keySkills: z.array(z.string().trim()).optional(),

  // ── Employment details ──────────────────────────────────────────────────
  education: z.string().max(300).optional().nullable(),
  functionalArea: z.string().max(200).optional().nullable(),
  shift: z.string().max(100).optional().nullable(),

  // ── Sourcing strategy ───────────────────────────────────────────────────
  targetCompanies: z.array(z.string().trim()).optional(),
  noPoachCompanies: z.array(z.string().trim()).optional(),

  // ── Timeline ────────────────────────────────────────────────────────────
  startDate: z.string().datetime().optional().nullable(),
  targetDate: z.string().datetime().optional().nullable(),
  respondBy: z.string().datetime().optional().nullable(),
  turnaroundDays: z.number().min(1).optional().nullable(),

  // ── JD file ─────────────────────────────────────────────────────────────
  // jdFileKey: z.string().optional().nullable(),
  // jdFileName: z.string().optional().nullable(),
  // jdFileType: z.string().optional().nullable(),
  parsedJDId: z.string().optional().nullable(),

  jdParsedAt: z.string().datetime().optional().nullable(),
  jdParseStatus: z
    .enum(["PARSED", "FAILED", "MANUALLY_OVERRIDDEN"])
    .optional()
    .nullable(),
  jdParsedFields: z.array(z.string()).optional(),

  // ── Band & Sale Value ────────────────────────────────────────────────────
  // Pass null explicitly to clear. Pass a UUID to set.
  bandId: z.string().optional().nullable(),
  saleValue: z.coerce.number().min(0).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

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
