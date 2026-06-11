// File: candidate.validator.ts
// Path: src/validators/candidate.validator.ts

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// ADD CANDIDATE TO PIPELINE
// Creates CandidateSnapshot (immutable, point-in-time) +
// RequirementCandidatePipeline row in one atomic transaction.
// candidateServiceId = UUID from Candidate microservice — no FK.
// ─────────────────────────────────────────────────────────────────────────────

export const addCandidateSchema = z.object({
  requirementId: z.string().uuid("Invalid requirement ID"),
  assignmentId: z.string().uuid().optional().nullable(),

  // Candidate Service reference
  candidateServiceId: z.string().uuid("Invalid candidate ID"),

  // Snapshot — point-in-time copy from Candidate Service response
  fullName: z.string().min(1, "Full name required"),
  email: z.string().email("Invalid email"),
  phone: z.string().optional().nullable(),
  currentTitle: z.string().optional().nullable(),
  currentCompany: z.string().optional().nullable(),
  totalExpYears: z.number().min(0).optional().nullable(),
  topSkills: z.array(z.string()).default([]),
  resumeUrl: z.string().url().optional().nullable(),

  // Full raw blob from Candidate Service — stored as-is
  rawSnapshot: z.record(z.any()),

  // Which stage to start at — defaults to first active stage if omitted
  initialStageId: z.string().uuid().optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// LIST CANDIDATES — query params for GET /candidates
// ─────────────────────────────────────────────────────────────────────────────

export const listCandidatesQuerySchema = z.object({
  requirementId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  canonicalStage: z
    .enum([
      "SOURCED",
      "SCREENING",
      "SUBMMITED",
      "SHORTLISTED",
      "REJECTED",
      "DECLINED",
      "INTERVIEW",
      "OFFER_IN_PROGRESS",
      "OFFERED",
      "HIRED",
      "JOINED",
      "DROPPED",
    ])
    .optional(),
  disposition: z
    .enum(["ACTIVE", "PLACED", "DROPPED", "ON_HOLD", "DUPLICATE"])
    .optional(),
  recruiterId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z
    .enum(["stageUpdatedAt", "createdAt", "submittedAt", "offeredAt"])
    .default("stageUpdatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

// ─────────────────────────────────────────────────────────────────────────────
// MOVE STAGE
// ─────────────────────────────────────────────────────────────────────────────

export const moveStageSchema = z.object({
  stageId: z.string().uuid("Invalid stage ID"),
  note: z.string().max(1000).optional().nullable(),
  wasSkipped: z.boolean().default(false),
  skipReason: z.string().max(500).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT TO CLIENT
// ─────────────────────────────────────────────────────────────────────────────

export const submitCandidateSchema = z.object({
  submissionNote: z.string().max(2000).optional().nullable(),
  stageId: z.string().uuid().optional().nullable(), // optionally move stage too
});

// ─────────────────────────────────────────────────────────────────────────────
// RECORD OFFER
// ─────────────────────────────────────────────────────────────────────────────

export const recordOfferSchema = z.object({
  offeredCtc: z.number().positive("Offered CTC must be positive"),
  salaryCurrency: z.string().default("INR"),
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  expectedJoiningDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable(),
  offerStatus: z
    .enum(["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"])
    .default("PENDING"),
  stageId: z.string().uuid().optional().nullable(), // optionally move stage too
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE OFFER STATUS
// ─────────────────────────────────────────────────────────────────────────────

export const updateOfferStatusSchema = z.object({
  offerStatus: z.enum([
    "PENDING",
    "ACCEPTED",
    "DECLINED",
    "REVOKED",
    "EXPIRED",
  ]),
  actualJoiningDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECT
// ─────────────────────────────────────────────────────────────────────────────

export const rejectCandidateSchema = z.object({
  rejectionReason: z.string().max(1000).optional().nullable(),
  dropDisposition: z.boolean().default(false),
  dropReason: z.string().max(500).optional().nullable(),
  dropNote: z.string().max(1000).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAW
// ─────────────────────────────────────────────────────────────────────────────

export const withdrawCandidateSchema = z.object({
  withdrawnReason: z.string().max(1000).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// HOLD (toggle)
// ─────────────────────────────────────────────────────────────────────────────

export const holdCandidateSchema = z.object({
  onHoldReason: z.string().max(1000).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// SET DISPOSITION — generic
// ─────────────────────────────────────────────────────────────────────────────

export const setDispositionSchema = z.object({
  disposition: z.enum(["ACTIVE", "PLACED", "DROPPED", "ON_HOLD", "DUPLICATE"]),
  dropReason: z.string().max(500).optional().nullable(),
  dropNote: z.string().max(1000).optional().nullable(),
  actualJoiningDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AddCandidateInput = z.infer<typeof addCandidateSchema>;
export type ListCandidatesQuery = z.infer<typeof listCandidatesQuerySchema>;
export type MoveStageInput = z.infer<typeof moveStageSchema>;
export type SubmitCandidateInput = z.infer<typeof submitCandidateSchema>;
export type RecordOfferInput = z.infer<typeof recordOfferSchema>;
export type UpdateOfferStatusInput = z.infer<typeof updateOfferStatusSchema>;
export type RejectCandidateInput = z.infer<typeof rejectCandidateSchema>;
export type WithdrawCandidateInput = z.infer<typeof withdrawCandidateSchema>;
export type HoldCandidateInput = z.infer<typeof holdCandidateSchema>;
export type SetDispositionInput = z.infer<typeof setDispositionSchema>;
