// File: report.validators.ts
// Path: src/validators/report.validators.ts

import { z } from "zod";
import { ClientActivityType, ClientStatus, EmailStatus, ValidationBand } from "@prisma/client";
import { paginationQuery } from "@/validators/validator";

// whitelists — dimension names never reach SQL unless they are in here
export const SPOC_DIMS = [
  "handler",
  "businessUnit",
  "serviceLine",
  "salesStatus",
  "source",
  "emailSource",
  "emailStatus",
  "validationBand",
  "client",
  "seniority",
  "department",
  "state",
  "isPrimary",
] as const;
export const CLIENT_DIMS = ["status", "industry", "category", "createdBy", "state", "city"] as const;
export const ACTIVITY_DIMS = ["type", "actor"] as const;

export type SpocDim = (typeof SPOC_DIMS)[number];
export type ClientDim = (typeof CLIENT_DIMS)[number];
export type ActivityDim = (typeof ACTIVITY_DIMS)[number];

const DIMS_BY_ENTITY: Record<string, readonly string[]> = {
  spocs: SPOC_DIMS,
  clients: CLIENT_DIMS,
  activities: ACTIVITY_DIMS,
  notes: [],
};

// "2026-10-01" or full ISO
const dateParam = z
  .string()
  .trim()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date" })
  .optional();

const uuid = z.string().uuid().optional();
const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");

export const overviewQuery = z.object({ from: dateParam, to: dateParam });

export const breakdownQuery = z
  .object({
    entity: z.enum(["spocs", "clients"]),
    groupBy: z.string().trim(),
    splitBy: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    from: dateParam,
    to: dateParam,
    // spocs filters
    clientId: uuid,
    handlerId: uuid,
    businessUnitId: uuid,
    serviceLineId: uuid,
    salesStatusId: uuid,
    emailStatus: z.nativeEnum(EmailStatus).optional(),
    validationBand: z.nativeEnum(ValidationBand).optional(),
    isActive: boolParam.default(true),
    // clients filters
    status: z.nativeEnum(ClientStatus).optional(),
    industryId: uuid,
    categoryId: uuid,
    state: z.string().trim().optional(),
    city: z.string().trim().optional(),
  })
  .superRefine((q, ctx) => {
    const dims = DIMS_BY_ENTITY[q.entity] ?? [];
    for (const field of ["groupBy", "splitBy"] as const) {
      const v = q[field];
      if (v !== undefined && !dims.includes(v)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must be one of: ${dims.join(", ")}`,
        });
      }
    }
    if (q.splitBy && q.splitBy === q.groupBy) {
      ctx.addIssue({ code: "custom", path: ["splitBy"], message: "splitBy must differ from groupBy" });
    }
  });

export const trendQuery = z
  .object({
    entity: z.enum(["clients", "spocs", "activities", "notes"]),
    interval: z.enum(["day", "week", "month"]).default("week"),
    from: dateParam,
    to: dateParam,
    groupBy: z.string().trim().optional(),
    top: z.coerce.number().int().min(1).max(20).default(5),
  })
  .superRefine((q, ctx) => {
    const dims = DIMS_BY_ENTITY[q.entity] ?? [];
    if (q.groupBy !== undefined && !dims.includes(q.groupBy)) {
      ctx.addIssue({
        code: "custom",
        path: ["groupBy"],
        message: dims.length
          ? `groupBy must be one of: ${dims.join(", ")}`
          : `groupBy is not supported for ${q.entity}`,
      });
    }
  });

export const reportActivitiesQuery = z.object({
  type: z.nativeEnum(ClientActivityType).optional(),
  actorId: uuid,
  clientId: uuid,
  spocId: uuid,
  from: dateParam,
  to: dateParam,
  ...paginationQuery,
});

export type OverviewQuery = z.infer<typeof overviewQuery>;
export type BreakdownQuery = z.infer<typeof breakdownQuery>;
export type TrendQuery = z.infer<typeof trendQuery>;
export type ReportActivitiesQuery = z.infer<typeof reportActivitiesQuery>;
