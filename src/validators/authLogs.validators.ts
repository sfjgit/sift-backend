// File: authLogs.validators.ts
// Path: src/validators/authLogs.validators.ts

import { z } from "zod";

const isoDateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date string" })
  .optional();

const authLogTypeEnum = z.enum([
  "LOGIN",
  "LOGOUT",
  "REFRESH",
  "PASSWORD_RESET",
  "PASSWORD_CHANGE",
  "EMAIL_VERIFICATION",
  "EMAIL_CHANGE",
  "PHONE_VERIFICATION",
  "ACCOUNT_CREATED",
  "ACCOUNT_DEACTIVATED",
  "ACCOUNT_REACTIVATED",
  "FAILED_LOGIN",
]);

export const listAuthLogsQuery = z.object({
  userId: z.string().uuid("userId must be a valid UUID").optional(),
  departmentId: z.string().uuid("departmentId must be a valid UUID").optional(),
  type: authLogTypeEnum.optional(),
  startDate: isoDateString,
  endDate: isoDateString,
  page: z.string().default("1"),
  limit: z.string().default("20"),
  sortBy: z.enum(["createdAt"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type ListAuthLogsQuery = z.infer<typeof listAuthLogsQuery>;
