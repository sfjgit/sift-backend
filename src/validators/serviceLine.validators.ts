// validators/serviceLine.validators.ts
import { z } from "zod";

export const createServiceLineSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).trim(),
  code: z.string().max(50).optional().nullable(),
});

export const updateServiceLineSchema = createServiceLineSchema.partial();

export type CreateServiceLineInput = z.infer<typeof createServiceLineSchema>;
export type UpdateServiceLineInput = z.infer<typeof updateServiceLineSchema>;
