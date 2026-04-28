import { z } from "zod";

// ── GET /requirements ─────────────────────────────────────────────────────────

export const getRequirementsSchema = z.object({
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
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  clientId: z.string().optional(),
  buId: z.string().optional(),
  jobType: z
    .enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"])
    .optional(),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]).optional(),
  assignedToMe: z.enum(["true", "false"]).optional(),
  breached: z.enum(["true", "false"]).optional(),
  search: z.string().min(1).max(200).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  sortBy: z
    .enum(["createdAt", "updatedAt", "respondBy", "priority", "status"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

// ── GET /requirements/:id ─────────────────────────────────────────────────────

export const getReqByIdSchema = z.object({ id: z.string() });

// ── Base object (no refinements) ──────────────────────────────────────────────

const requirementBaseSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional().nullable(),
  clientId: z.string(),
  clientContactId: z.string().optional().nullable(),
  businessUnitId: z.string().optional().nullable(),
  jobType: z.enum(["CONTRACT", "PERMANENT", "CONTRACT_TO_HIRE", "FREELANCE"]),
  remoteType: z.enum(["ONSITE", "REMOTE", "HYBRID"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().default("MEDIUM"),
  totalOpenings: z.number().int().min(1).optional().default(1),
  location: z.string().max(200).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  salaryMin: z.number().positive().optional().nullable(),
  salaryMax: z.number().positive().optional().nullable(),
  salaryType: z
    .enum(["MONTHLY", "ANNUAL", "HOURLY", "DAILY"])
    .optional()
    .nullable(),
  experienceMin: z.number().min(0).optional().nullable(),
  experienceMax: z.number().min(0).optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  respondBy: z.string().datetime().optional().nullable(),
  turnaroundDays: z.number().int().min(1).optional().nullable(),
  skillIds: z
    .array(
      z.object({
        skillId: z.string(),
        isMandatory: z.boolean().optional().default(true),
        experience: z.number().min(0).optional().nullable(),
      })
    )
    .optional()
    .default([]),
});

const salaryRefinement = (d: {
  salaryMin?: number | null;
  salaryMax?: number | null;
}) => !d.salaryMin || !d.salaryMax || d.salaryMax >= d.salaryMin;

const salaryRefinementOpts = {
  message: "salaryMax must be >= salaryMin",
  path: ["salaryMax"],
};

// ── POST /requirements ────────────────────────────────────────────────────────

export const createRequirementSchema = requirementBaseSchema.refine(
  salaryRefinement,
  salaryRefinementOpts
);

// ── PUT /requirements/:id ─────────────────────────────────────────────────────

export const updateRequirementSchema = requirementBaseSchema
  .omit({ clientId: true })
  .partial()
  .refine(salaryRefinement, salaryRefinementOpts);

// ── PATCH /requirements/:id/status ───────────────────────────────────────────

export const updateStatusSchema = z.object({
  toStatus: z.enum([
    "DRAFT",
    "PENDING_APPROVAL",
    "ACTIVE",
    "ON_HOLD",
    "CLOSED",
    "CANCELLED",
  ]),
  reason: z.string().max(500).optional(),
});

// ── POST /requirements/:id/assign ─────────────────────────────────────────────

export const createAssignmentSchema = z
  .object({
    type: z.enum(["MANAGER", "TEAM", "INDIVIDUAL"]),
    recruiterId: z.string().optional().nullable(),
    teamId: z.string().optional().nullable(),
    teamMemberId: z.string().optional().nullable(),
    parentAssignmentId: z.string().optional().nullable(),
    allocatedOpenings: z.number().int().min(1).optional(),
    deadline: z.string().datetime().optional().nullable(),
  })
  .refine(
    (d) => {
      if (d.type === "MANAGER" && !d.recruiterId) return false;
      if (d.type === "TEAM" && !d.teamId) return false;
      if (d.type === "INDIVIDUAL" && !d.recruiterId) return false;
      return true;
    },
    {
      message:
        "recruiterId required for MANAGER/INDIVIDUAL; teamId required for TEAM",
    }
  );

// ── PATCH /requirements/:id/assignments/:assignmentId ─────────────────────────

export const updateAssignmentSchema = z.object({
  allocatedOpenings: z.number().int().min(1).optional(),
  deadline: z.string().datetime().optional().nullable(),
});

// ── PATCH /requirements/:id/assignments/:assignmentId/progress ────────────────

export const updateProgressSchema = z.object({
  submissionsCount: z.number().int().min(0).optional(),
  interviewsCount: z.number().int().min(0).optional(),
  filledOpenings: z.number().int().min(0).optional(),
});

// ── POST /requirements/:id/notes ──────────────────────────────────────────────

export const addNoteSchema = z.object({
  content: z.string().min(1).max(2000).trim(),
});

// ── GET /requirements/calendar ────────────────────────────────────────────────

export const calendarSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
