// File: svc.validators.ts
// Path: src/validators/svc.validators.ts
//
// Bodies the CSR pipeline engine sends to /api/svc/* (docs/PIPELINE_INTEGRATION.md §4-5).
// Strings are trimmed and "" becomes undefined, so a blank never overwrites data.
// Over-long text is cut to the limit: one wordy field must not reject a whole result.

import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v.slice(0, max).trim()))
    .nullish()
    .transform((v) => v ?? undefined);

// required text: must not be blank; over-long is cut, not rejected
const req = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((v) => v.slice(0, max).trim());

const money = z.coerce.number().finite().nonnegative().max(1e14).nullish().transform((v) => v ?? undefined);
const years = z.coerce.number().finite().min(0).max(99.9).nullish().transform((v) => v ?? undefined);
// FY is stored as "2025-2026" (the CASPA format); the engine may send "2025-26" or "FY 2025-26"
const toFy = (v: string) => {
  const m = /^(?:FY\s*)?(\d{4})\s*[-/–]\s*(\d{2}|\d{4})$/i.exec(v);
  if (!m) return v;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const next = m[2]!.length === 2 ? (start + 1) % 100 : start + 1;
  return end === next ? `${start}-${start + 1}` : v;
};
const fy = z.string().trim().min(4).max(20).transform(toFy);

export const svcEventBody = z.object({
  status: z.literal("RUNNING").optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  note: text(300),
  message: text(1000),
});

const resultSpoc = z.object({
  id: z.string().uuid().nullish().transform((v) => v ?? undefined),
  firstName: req(120),
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

const coord = (max: number) => z.number().min(-max).max(max).nullable().optional();

const resultProgram = z.object({
  fy,
  name: req(500),
  // free text ("Education & healthcare") — matched to Schedule VII; kept as written
  sector: text(200),
  // or Schedule VII codes when the engine already knows them (HEALTH, EDUCATION…)
  sectors: z.array(z.string().trim().max(40)).max(13).optional(),
  budgetRs: money,
  spentRs: money,
  unspentTransferredRs: money,
  isOngoing: z.boolean().nullable().optional(),
  duration: text(100),
  isLocalArea: z.boolean().nullable().optional(),
  locations: text(2000),
  // structured places, when the report lists them
  locationList: z
    .array(
      z
        .object({
          state: req(100),
          district: text(100),
          city: text(100),
          latitude: coord(90),
          longitude: coord(180),
        })
        // half a point can't be placed — drop both halves
        .transform((l) =>
          l.latitude == null || l.longitude == null ? { ...l, latitude: null, longitude: null } : l,
        ),
    )
    .max(100)
    .optional(),
  beneficiaries: text(500),
  mode: z.enum(["DIRECT", "AGENCY"]).nullable().optional(),
  implementor: text(500),
  agencyRegistrationNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^CSR\d{8}$/)
    .nullable()
    .optional()
    .catch(null), // a malformed number is dropped, not the whole result
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
        subject: req(500),
        body: req(20000),
      }),
    )
    .min(1)
    .max(10),
});

// an office the branch finder read on the client's own website (saved as a ClientLocation)
const coordText = (max: number) =>
  z.coerce.number().finite().min(-max).max(max).nullish().catch(null).transform((v) => v ?? null);
const resultLocation = z
  .object({
    address: req(1000),
    label: text(200),
    type: text(40),
    state: text(100),
    district: text(100),
    pincode: z
      .string()
      .trim()
      .regex(/^[1-9]\d{5}$/)
      .nullish()
      .catch(null)
      .transform((v) => v ?? undefined),
    latitude: coordText(90),
    longitude: coordText(180),
    evidence: text(1000),
    pageUrl: text(1000),
    checks: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? undefined),
  })
  .transform((l) => (l.latitude == null || l.longitude == null ? { ...l, latitude: null, longitude: null } : l));

// the "website" step: is the stored website dead (it does not open), and which one is theirs now
const resultWebsite = z.object({
  oldUrl: text(500),
  dead: z.boolean(),
  opensAt: text(500),
  tried: z
    .array(z.object({ url: text(500), why: text(200), status: z.number().int().nullish() }))
    .max(20)
    .default([]),
  candidates: z
    .array(
      z.object({
        url: req(500),
        opened: text(500),
        title: text(200),
        how: text(300),
        evidence: z.array(z.string().max(300)).max(10).default([]),
        confidence: z.coerce.number().min(0).max(1),
      }),
    )
    .max(5)
    .default([]),
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
      locations: z.array(resultLocation).max(1000).optional(),
      website: resultWebsite.optional(),
    })
    .optional(),
});

export type SvcEventInput = z.infer<typeof svcEventBody>;
export type ResultsBody = z.infer<typeof svcResultsBody>;
export type ResultSpoc = z.infer<typeof resultSpoc>;
export type ResultLocation = z.infer<typeof resultLocation>;
export type ResultWebsite = z.infer<typeof resultWebsite>;
