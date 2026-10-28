// File: alert.validators.ts
// Path: src/validators/alert.validators.ts

import { z } from "zod";
import { NotificationSeverity } from "@prisma/client";
import { paginationQuery } from "@/validators/validator";

export const listAlertsQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  severity: z.nativeEnum(NotificationSeverity).optional(),
  source: z.enum(["pipeline", "engine", "api"]).optional(),
  ...paginationQuery,
});

export const resolveAlertsBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuery>;
