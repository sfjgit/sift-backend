// File: svc.validators.ts
// Path: src/validators/svc.validators.ts
//
// Bodies the CSR pipeline engine sends to /api/svc/* (docs/PIPELINE_INTEGRATION.md §4-5).
// Strings are trimmed and "" becomes undefined, so a blank never overwrites data.

import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .nullish()
    .transform((v) => v ?? undefined);

const money = z.coerce.number().finite().nonnegative().max(1e14).nullish().transform((v) => v ?? undefined);
const years = z.coerce.number().finite().min(0).max(99.9).nullish().transform((v) => v ?? undefined);
const fy = z.string().trim().min(4).max(20);

export const svcEventBody = z.object({
  status: z.literal("RUNNING").optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  note: text(300),
  message: text(1000),
});

const resultSpoc = z.object({
  id: z.string().uuid().nullish().transform((v) => v ?? undefined),
  firstName: z.string().trim().min(1).max(120),
  lastName: text(120),
  designation: text(300),
  department: text(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .transform((v) => (v === "" ? undefined : v))
    .pipe(z.string().email().optional())
    .nullish()
    .transform((v) => v ?? undefined),
  emailSource: text(50),
  phone: text(50),
  linkedinUrl: text(500),
  seniority: text(100),
  totalExpYears: years,
  currentOrgExpYears: years,
  source: text(50),
  sourceUrl: text(1000),
  fieldSources: z.record(z.string(), z.string().max(100)).optional(),
  validation: z
    .object({
      score: z.coerce.number().int().min(0).max(100).optional(),
      band: z.enum(["READY", "REVIEW", "NOT_USABLE"]).optional(),
      emailStatus: z.enum(["UNVERIFIED", "GOOD", "RISKY", "BAD"]).optional(),
      checks: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  reviewFlag: z.boolean().optional(),
  reviewReason: text(1000),
});

const resultFinancial = z.object({
  fy,
  obligationRs: money,
  budgetRs: money,
  spentRs: money,
  unspentRs: money,
  evidence: text(4000),
  confidence: z.coerce.number().min(0).max(1).nullish(),
  flagged: z.boolean().optional(),
  reviewReason: text(1000),
});

const resultProgram = z.object({
  fy,
  name: z.string().trim().min(1).max(500),
  sector: text(200),
  budgetRs: money,
  locations: text(2000),
  beneficiaries: text(500),
  implementor: text(500),
  sourceUrl: text(1000),
});

const resultDocument = z.object({
  type: z.string().trim().min(1).max(60),
  fy,
  fileKey: z.string().trim().min(1).max(1000),
  fileName: text(300),
  sourceUrl: text(1000),
  sha256: text(64),
});

const resultOutreach = z.object({
  spocId: z.string().uuid(),
  fileKey: text(1000),
  model: text(100),
  messages: z
    .array(
      z.object({
        sequenceNo: z.coerce.number().int().min(0).max(20),
        subject: z.string().trim().min(1).max(500),
        body: z.string().trim().min(1).max(20000),
      }),
    )
    .min(1)
    .max(10),
});

export const svcResultsBody = z.object({
  status: z.enum(["DONE", "EMPTY", "FAILED", "STOPPED"]),
  summary: z.record(z.string(), z.unknown()).optional(),
  viewData: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({ code: text(60), message: text(1000), howToContinue: text(1000) })
    .optional(),
  costUsd: z.coerce.number().min(0).max(100000).nullish(),
  credits: z.record(z.string(), z.number()).optional(),
  data: z
    .object({
      documents: z.array(resultDocument).max(500).optional(),
      spocs: z.array(resultSpoc).max(2000).optional(),
      financials: z.array(resultFinancial).max(100).optional(),
      programs: z.array(resultProgram).max(2000).optional(),
      outreach: z.array(resultOutreach).max(1000).optional(),
    })
    .optional(),
});

export type SvcEventInput = z.infer<typeof svcEventBody>;
export type ResultsBody = z.infer<typeof svcResultsBody>;
export type ResultSpoc = z.infer<typeof resultSpoc>;
