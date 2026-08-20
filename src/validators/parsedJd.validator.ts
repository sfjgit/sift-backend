import { z } from "zod";

const coerceNum = z.preprocess(
  (v) => (v === "" || v === undefined ? null : Number(v)),
  z.number().min(0).nullable().optional(),
);

export const parsedJDSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  description: z.string().max(15000).optional().nullable(),
  jobType: z
    .enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"])
    .optional()
    .nullable(),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]).optional().nullable(),
  experienceMin: coerceNum,
  experienceMax: coerceNum,
  salaryMin: coerceNum,
  salaryMax: coerceNum,
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  education: z.string().max(300).optional().nullable(),
  functionalArea: z.string().max(200).optional().nullable(),
  shift: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  bonusAmount: coerceNum,
  primarySkills: z.array(z.string().trim()).default([]),
  keySkills: z.array(z.string().trim()).default([]),
  targetCompanies: z.array(z.string().trim()).default([]),
  noPoachCompanies: z.array(z.string().trim()).default([]),
});

export type ParsedJD = z.infer<typeof parsedJDSchema>;
