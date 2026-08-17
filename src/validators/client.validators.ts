// validators/client.validators.ts
import { z } from "zod";

export const createClientSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).trim(),
  vmsName: z.string().max(200).optional().nullable(),
  industry: z.string().max(100).optional().nullable(),
  website: z.string().url("Invalid URL").optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  businessUnitId: z.string().optional().nullable(),
  parentClientId: z.string().optional().nullable(),
  agreementType: z.enum(["BAND", "FIXED"]),
  notes: z.string().max(500).optional().nullable(),
  percentage: z.number().min(0).max(100).optional().nullable(),
  status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]).default("PENDING"),
  bands: z
    .array(
      z.object({
        name: z.string().min(1, "Name is required").max(100).trim().optional(),
        experience: z.number().min(0).optional().nullable(),
        rangeFrom: z.number().min(0).optional().nullable(),
        rangeTo: z.number().min(0).optional().nullable(),
        code: z.string().min(1, "Code is required").max(100).trim(),
        value: z.number().min(0).optional().nullable(),
      })
    )
    .optional()
    .nullable(),
});

export const updateClientSchema = createClientSchema.partial();

export const updateClientStatusSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]),
});

export const addClientNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(2000).trim(),
});

export const addSpocSchema = z.object({
  // client-side person
  firstName: z.string().min(1, "First name is required").max(100).trim(),
  lastName: z.string().min(1, "Last name is required").max(100).trim(),
  email: z.string().email("Invalid email").optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  designation: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  // our side
  handlerId: z.string().min(1, "Handler is required"),
  serviceLineId: z.string().min(1, "Service line is required"),
  businessUnitId: z.string().min(1, "Business unit is required"),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(500).optional().nullable(),
});

export const updateSpocSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  designation: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  handlerId: z.string().optional(),
  serviceLineId: z.string().optional(), // ← added
  businessUnitId: z.string().optional(), // ← added
  isPrimary: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type AddSpocInput = z.infer<typeof addSpocSchema>;
export type UpdateSpocInput = z.infer<typeof updateSpocSchema>;

// File: client.validators.ts  (append to existing file)
// Path: src/validators/client.validators.ts

// import { z } from "zod";

// ── Add to client.validators.ts ───────────────────────────────────────────────

export const addSpocDMSchema = z
  .object({
    // Accept either a single ID or a bulk array — at least one must be present
    dmId: z.string().uuid("Invalid user ID").optional(),
    dmIds: z.array(z.string().uuid("Invalid user ID")).min(1).optional(),
  })
  .refine((d) => d.dmId || (d.dmIds && d.dmIds.length > 0), {
    message: "Provide dmId (single) or dmIds (array)",
  });

export type AddSpocDMInput = z.infer<typeof addSpocDMSchema>;
