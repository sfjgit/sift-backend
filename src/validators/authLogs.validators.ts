// File: authLogs.validators.ts
// Path: src/validators/authLogs.validators.ts

import { z } from "zod";
import { AuthLogType } from "@prisma/client";
import { paginationQuery } from "@/validators/validator";

const isoDateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date string" })
  .optional();

export const listAuthLogsQuery = z.object({
  userId: z.string().uuid("userId must be a valid UUID").optional(),
  departmentId: z.string().uuid("departmentId must be a valid UUID").optional(),
  type: z.nativeEnum(AuthLogType).optional(),
  startDate: isoDateString,
  endDate: isoDateString,
  ...paginationQuery,
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type ListAuthLogsQuery = z.infer<typeof listAuthLogsQuery>;
