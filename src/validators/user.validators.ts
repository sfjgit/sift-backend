import { z } from "zod";

// ─────────────────────────────────────────
// BODY SCHEMAS — used with validate.body()
// ─────────────────────────────────────────

export const createUserBody = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleId: z.string().min(1, "Role is required"),
  businessUnitId: z.string().optional().nullable(),
  employeeId: z.string().max(50).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  reportingToId: z.string().optional().nullable(),
  dateOfJoin: z.string().datetime().optional().nullable(),
  workingLocation: z.string().max(200).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
});

export const updateUserBody = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email("Invalid email").optional(),
  roleId: z.string().optional(),
  businessUnitId: z.string().optional().nullable(),
  employeeId: z.string().max(50).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  reportingToId: z.string().optional().nullable(),
  dateOfJoin: z.string().datetime().optional().nullable(),
  workingLocation: z.string().max(200).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  displayName: z.string().max(200).optional().nullable(),
  nickName: z.string().max(100).optional().nullable(),
});

export const deactivateUserBody = z.object({
  reason: z.string().max(500).optional(),
});

// ─────────────────────────────────────────
// PARAM SCHEMAS — used with validate.params()
// ─────────────────────────────────────────

export const userIdParams = z.object({
  id: z.string().min(1, "User ID is required"),
});

// ─────────────────────────────────────────
// QUERY SCHEMAS — used with validate.query()
// ─────────────────────────────────────────

export const listUsersQuery = z.object({
  search: z.string().optional(),
  buId: z.string().optional(),
  roleId: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  teamId: z.string().optional(),
  teamRole: z.enum(["LEAD", "CO_LEAD", "MEMBER"]).optional(),
  isClientHandler: z.enum(["true", "false"]).optional(),
  isContactOwner: z.enum(["true", "false"]).optional(),
  page: z.string().regex(/^\d+$/).optional().default("1"),
  limit: z.string().regex(/^\d+$/).optional().default("20"),
});

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type DeactivateInput = z.infer<typeof deactivateUserBody>;
