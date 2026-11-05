// File: platform.validators.ts
// Path: src/validators/platform.validators.ts

import { z } from "zod";
import { optionalText } from "@/validators/validator";

const PLANS = ["TRIAL", "STANDARD", "ENTERPRISE"] as const;

export const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Lower-case letters, digits and dashes (max 40)");

const maxUsers = z.number().int().min(1).max(100_000).nullable().optional();

export const createTenantBody = z.object({
  name: z.string().trim().min(2).max(120),
  slug: tenantSlug,
  legalName: optionalText(200),
  plan: z.enum(PLANS).default("STANDARD"),
  maxUsers,
  admin: z.object({
    email: z.string().email("Invalid email").trim().toLowerCase(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
  }),
  // copy pick-lists + help from this tenant; null = start from the defaults only
  templateTenantId: z.string().uuid().nullable().optional(),
});

export const updateTenantBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    legalName: optionalText(200),
    plan: z.enum(PLANS),
    maxUsers,
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  })
  .partial();

export type CreateTenantInput = z.infer<typeof createTenantBody>;
export type UpdateTenantInput = z.infer<typeof updateTenantBody>;
