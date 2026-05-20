// File: user.validators.ts
// Path: src/validators/user.validators.ts

import { z } from "zod";

// ── Reusable date coercion ────────────────────────────────────────────────────
// Prisma DateTime fields accept ISO strings. z.string().datetime() is too strict
// (requires time component). Accept any non-empty string and let Prisma/JS Date
// handle validation at the DB boundary.
const isoDateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date string" })
  .optional()
  .nullable();

// ── Create ────────────────────────────────────────────────────────────────────

export const createUserBody = z.object({
  email: z.string().email("Invalid email").toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  middleName: z.string().max(100).trim().optional().nullable(),
  // schema field is nickName (camelCase) — matches User.nickName
  nickName: z.string().max(100).trim().optional().nullable(),
  displayName: z.string().max(100).trim().optional().nullable(),
  employeeId: z.string().max(50).trim().optional().nullable(),
  phone: z.string().max(20).trim().optional().nullable(),
  workingLocation: z.string().max(200).trim().optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  // Use lenient date parsing — schema stores these as DateTime? (not timestamptz with time required)
  dateOfBirth: isoDateString,
  dateOfJoin: isoDateString,
  roleId: z.string().uuid("roleId must be a valid UUID"),
  departmentId: z
    .string()
    .uuid("departmentId must be a valid UUID")
    .optional()
    .nullable(),
  reportingToId: z
    .string()
    .uuid("reportingToId must be a valid UUID")
    .optional()
    .nullable(),
  teamLeadId: z
    .string()
    .uuid("teamLeadId must be a valid UUID")
    .optional()
    .nullable(),
  // Only a superAdmin can set this — controller should gate it separately if needed
  isSuperAdmin: z.boolean().default(false),
});

// ── Update — all fields optional, email + password not editable via this endpoint ──

export const updateUserBody = createUserBody
  .omit({ email: true, password: true })
  .partial();

// ── Targeted patch endpoints ──────────────────────────────────────────────────

export const assignReportingBody = z.object({
  // nullable = clear the reporting line
  reportingToId: z.string().uuid().nullable(),
});

export const assignTeamLeadBody = z.object({
  // nullable = remove from team
  teamLeadId: z.string().uuid().nullable(),
});

export const assignDepartmentBody = z.object({
  // nullable = unassign department
  departmentId: z.string().uuid().nullable(),
});

export const assignRoleBody = z.object({
  roleId: z.string().uuid("roleId must be a valid UUID"),
});

// ── Params ────────────────────────────────────────────────────────────────────

export const userIdParams = z.object({
  id: z.string().uuid("User id must be a valid UUID"),
});

// ── List / search query ───────────────────────────────────────────────────────

export const listUsersQuery = z.object({
  search: z.string().optional(),

  // direct field filters
  roleId: z.string().optional(),
  departmentId: z.string().optional(),
  reportingToId: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),

  // buId — users who have ACTIVE assignments in this BU (or any descendant)
  // OR whose handled client spocs belong to this BU.
  // Filtering uses BusinessUnit.ancestorIds GIN index.
  buId: z.string().optional(),

  // teamId is the UUID of the team lead user (teams have no separate model —
  // a "team" is defined by User.teamLeadId pointing at its lead)
  teamId: z.string().optional(),

  // LEAD   → user has at least one active teamMember (they are someone's teamLeadId)
  // MEMBER → user has teamLeadId set (they belong to a team)
  // Note: CO_LEAD is not modelled separately in the schema — the enum value is
  // accepted for forward-compat but resolves to the same branch as LEAD.
  teamRole: z.enum(["LEAD", "CO_LEAD", "MEMBER"]).optional(),

  // true  = user handles at least one active ClientSpoc
  // false = user handles no active ClientSpoc
  isClientHandler: z.enum(["true", "false"]).optional(),

  // pagination + sort
  page: z.string().default("1"),
  limit: z.string().default("25"),
  sortBy: z
    .enum(["firstName", "lastName", "createdAt", "dateOfJoin"])
    .default("firstName"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
