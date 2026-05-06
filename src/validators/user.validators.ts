// validators/user.validator.ts
import { z } from "zod";

export const createUserBody = z.object({
  email: z.string().email("Invalid email").toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  middleName: z.string().max(100).trim().optional().nullable(),
  nickName: z.string().max(100).trim().optional().nullable(),
  displayName: z.string().max(100).trim().optional().nullable(),
  employeeId: z.string().max(50).trim().optional().nullable(),
  phone: z.string().max(20).trim().optional().nullable(),
  workingLocation: z.string().max(200).trim().optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  dateOfJoin: z.string().datetime().optional().nullable(),
  roleId: z.string().min(1, "Role is required"),
  departmentId: z.string().optional().nullable(),
  reportingToId: z.string().optional().nullable(),
  teamLeadId: z.string().optional().nullable(),
  isSuperAdmin: z.boolean().default(false),
});

export const updateUserBody = createUserBody
  .omit({ email: true, password: true })
  .partial();

export const assignReportingBody = z.object({
  reportingToId: z.string().nullable(),
});

export const assignTeamLeadBody = z.object({
  teamLeadId: z.string().nullable(),
});

export const assignDepartmentBody = z.object({
  departmentId: z.string().nullable(),
});

export const assignRoleBody = z.object({
  roleId: z.string().min(1, "Role is required"),
});

export const userIdParams = z.object({
  id: z.string().min(1, "User id is required"),
});

export const listUsersQuery = z.object({
  search: z.string().optional(),
  roleId: z.string().optional(),
  departmentId: z.string().optional(),
  reportingToId: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  page: z.string().default("1"),
  limit: z.string().default("25"),
  sortBy: z
    .enum(["firstName", "lastName", "createdAt", "dateOfJoin"])
    .default("firstName"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
