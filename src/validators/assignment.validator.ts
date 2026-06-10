// File: assignment.validator.ts
// Path: src/validators/assignment.validator.ts

import { z } from "zod";

// ── Create assignment (depth 0 — sales/CSM assigns to DM) ────────────────────
export const createAssignmentSchema = z.object({
  requirementId: z.string().uuid("Invalid requirement ID"),
  assignedToId: z.string().uuid("Invalid user ID"),
  allocatedOpenings: z.number().int().min(1).optional().nullable(),
  deadline: z.string().datetime({ offset: true }).optional().nullable(),
});

// ── Sub-assign (depth 1/2 — DM assigns to TL/Recruiter) ──────────────────────
export const subAssignSchema = z.object({
  assignedToId: z.string().uuid("Invalid user ID"),
  allocatedOpenings: z.number().int().min(1).optional().nullable(),
  deadline: z.string().datetime({ offset: true }).optional().nullable(),
});

// ── Update assignment ─────────────────────────────────────────────────────────
export const updateAssignmentSchema = z.object({
  allocatedOpenings: z.number().int().min(1).optional().nullable(),
  deadline: z.string().datetime({ offset: true }).optional().nullable(),
  status: z
    .enum(["ACTIVE", "REMOVED", "REPLACED", "FILLED", "EXPIRED"])
    .optional(),
  removedReason: z.string().max(500).optional().nullable(),
});

// ── List query params ─────────────────────────────────────────────────────────
export const listAssignmentsQuerySchema = z.object({
  requirementId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  status: z
    .enum(["ACTIVE", "REMOVED", "REPLACED", "FILLED", "EXPIRED"])
    .optional(),
  depth: z.coerce.number().int().min(0).max(2).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z
    .enum(["assignedAt", "deadline", "filledOpenings", "submissionsCount"])
    .default("assignedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type SubAssignInput = z.infer<typeof subAssignSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;
