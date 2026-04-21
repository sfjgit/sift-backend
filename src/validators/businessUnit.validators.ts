import { z } from "zod";

export const createBusinessUnitSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" }),
  isActive: z.boolean().default(true),
  parentBUId: z.string().uuid().optional(),
});

export const updateBusinessUnitBodySchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" })
    .optional(),
  isActive: z.boolean().default(true).optional(),
  parentBUId: z.string().uuid().optional(),
});

export const getSingleBusinessUnitParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateBusinessUnitParamsSchema = z.object({
  id: z.string().uuid(),
});

export const getBusinessUnitTreeSchema = z.object({
  id: z.string().uuid(),
});
