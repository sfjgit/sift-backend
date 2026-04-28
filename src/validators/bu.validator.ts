import { z } from "zod";

export const createBUBody = z.object({
  name: z.string().min(1, "Name is required").max(100),
  parentBUId: z.string().optional().nullable(),
});

export const updateBUBody = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  parentBUId: z.string().optional().nullable(),
});

export const buIdParams = z.object({
  id: z.string().min(1, "BU ID is required"),
});

export type CreateBUInput = z.infer<typeof createBUBody>;
export type UpdateBUInput = z.infer<typeof updateBUBody>;
