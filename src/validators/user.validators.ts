// File: user.validators.ts
// Path: src/validators/user.validators.ts

import { z } from "zod";
import { optionalId, optionalText, paginationQuery } from "@/validators/validator";

// accepts "2024-05-01" as well as full ISO; "" clears
const optionalDate = z
  .string()
  .refine((v) => v === "" || !isNaN(Date.parse(v)), { message: "Invalid date" })
  .transform((v) => (v === "" ? null : new Date(v)))
  .nullable()
  .optional();

// No password here — the user sets it from the welcome email link
export const createUserBody = z.object({
  email: z.string().email("Invalid email").trim().toLowerCase(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  middleName: optionalText(100),
  displayName: optionalText(100),
  employeeId: optionalText(50),
  phone: optionalText(20),
  workingLocation: optionalText(200),
  timezone: optionalText(100),
  dateOfBirth: optionalDate,
  dateOfJoin: optionalDate,
  roleId: z.string().uuid("roleId must be a valid UUID"),
  departmentId: optionalId,
  designationId: optionalId,
  reportingToId: optionalId,
  teamLeadId: optionalId,
  businessUnitIds: z.array(z.string().uuid()).default([]),
  serviceLineIds: z.array(z.string().uuid()).default([]),
  isSuperAdmin: z.boolean().default(false), // only a super admin may set this
});

// email not editable; BU / SL lists are full replace when sent
export const updateUserBody = createUserBody
  .omit({ email: true })
  .extend({
    businessUnitIds: z.array(z.string().uuid()).optional(),
    serviceLineIds: z.array(z.string().uuid()).optional(),
    isSuperAdmin: z.boolean().optional(),
  })
  .partial();

export const adminResetPasswordBody = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const listUsersQuery = z.object({
  search: z.string().trim().optional(),
  roleId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  reportingToId: z.string().uuid().optional(),
  teamLeadId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  serviceLineId: z.string().uuid().optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  ...paginationQuery,
  sortBy: z.enum(["firstName", "lastName", "createdAt", "dateOfJoin"]).default("firstName"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type ListUsersQuery = z.infer<typeof listUsersQuery>;

// lightweight picker — see GET /users/options
export const userOptionsQuery = z.object({
  search: z.string().trim().optional(),
  for: z.enum(["assign", "filter"]).default("filter"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UserOptionsQuery = z.infer<typeof userOptionsQuery>;
