// File: authLogs.validators.ts
// Path: src/validators/authLogs.validators.ts

import { z } from "zod";
import { AuthLogType } from "@prisma/client";
import { csv, csvIds, paginationQuery } from "@/validators/validator";

const isoDateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date string" })
  .optional();

export const listAuthLogsQuery = z.object({
  userId: csvIds,
  departmentId: csvIds,
  type: csv(z.nativeEnum(AuthLogType)),
  startDate: isoDateString,
  endDate: isoDateString,
  ...paginationQuery,
  sortDir: z.enum(["asc", "desc"]).catch("desc"),
});

export type ListAuthLogsQuery = z.infer<typeof listAuthLogsQuery>;

export const listAuditLogsQuery = z.object({
  actorId: z.string().uuid("actorId must be a valid UUID").optional(),
  module: z.string().trim().optional(),
  action: z.string().trim().optional(),
  recordId: z.string().trim().optional(),
  startDate: isoDateString,
  endDate: isoDateString,
  ...paginationQuery,
  sortDir: z.enum(["asc", "desc"]).catch("desc"),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuery>;
