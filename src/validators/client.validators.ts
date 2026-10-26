// File: client.validators.ts
// Path: src/validators/client.validators.ts

import { z } from "zod";
import { ClientStatus, EmailStatus, SpocApprovalStatus, ValidationBand } from "@prisma/client";
import { optionalId, optionalText, paginationQuery } from "@/validators/validator";

const optionalUrl = z
  .string()
  .trim()
  .url("Invalid URL")
  .or(z.literal("").transform(() => null))
  .nullable()
  .optional();

const optionalYears = z.number().min(0).max(99.9).nullable().optional();

// ── clients ──────────────────────────────────────────────────────────────────

export const createClientBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  shortName: optionalText(100),
  cin: optionalText(21).transform((v) => v?.toUpperCase() ?? v),
  website: optionalUrl,
  linkedinUrl: optionalUrl,
  industryId: optionalId,
  categoryId: optionalId,
});

export const updateClientBody = createClientBody.partial();

export const clientStatusBody = z.object({
  status: z.nativeEnum(ClientStatus),
});

export const listClientsQuery = z.object({
  search: z.string().trim().optional(),
  status: z.nativeEnum(ClientStatus).optional(),
  industryId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  // matched through the client's active SPOCs
  handlerId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  serviceLineId: z.string().uuid().optional(),
  // matched through the client's active locations
  state: z.string().trim().optional(),
  district: z.string().trim().optional(),
  city: z.string().trim().optional(),
  ...paginationQuery,
  sortBy: z.enum(["name", "createdAt", "updatedAt", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const clientActivitiesQuery = z.object(paginationQuery);

export const clientNoteBody = z.object({
  content: z.string().trim().min(1, "Content is required").max(5000),
});

export const noteParams = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
});

// ── locations ────────────────────────────────────────────────────────────────

const optionalCoord = (max: number) => z.number().min(-max).max(max).nullable().optional();

export const createLocationBody = z.object({
  typeId: optionalId,
  name: optionalText(200),
  addressLine: optionalText(500),
  city: optionalText(100),
  district: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  pincode: optionalText(10),
  latitude: optionalCoord(90),
  longitude: optionalCoord(180),
  isPrimary: z.boolean().optional(),
  dmEvidence: optionalText(2000),
});

export const updateLocationBody = createLocationBody.partial();

export const locationParams = z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
});

// ── technologies — one row per client per category ───────────────────────────

export const saveTechnologyBody = z.object({
  categoryId: z.string().uuid("Category is required"),
  details: z.string().trim().min(1, "Details are required").max(2000),
});

export const technologyParams = z.object({
  id: z.string().uuid(),
  technologyId: z.string().uuid(),
});

// ── spocs ────────────────────────────────────────────────────────────────────

const spocFields = {
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: optionalText(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email")
    .or(z.literal("").transform(() => null))
    .nullable()
    .optional(),
  phone: optionalText(30),
  designation: optionalText(200),
  department: optionalText(200),
  linkedinUrl: optionalUrl,
  seniority: optionalText(50),
  totalExpYears: optionalYears,
  currentOrgExpYears: optionalYears,
  businessUnitId: z.string().uuid("Business unit is required"),
  serviceLineId: z.string().uuid("Service line is required"),
  locationId: optionalId, // must belong to the same client
  sourceId: optionalId,
  emailSourceId: optionalId,
  salesStatusId: optionalId,
  isPrimary: z.boolean().optional(),
  notes: optionalText(2000),
};

export const createSpocBody = z.object({
  clientId: z.string().uuid("Client is required"),
  handlerId: z.string().uuid("Handler is required"),
  ...spocFields,
});

// handler changes go through /spocs/:id/assign
export const updateSpocBody = z.object(spocFields).partial();

export const assignSpocBody = z.object({
  assignToId: z.string().uuid("assignToId is required"),
  reason: optionalText(500),
});

export const listSpocsQuery = z.object({
  search: z.string().trim().optional(),
  clientId: z.string().uuid().optional(),
  handlerId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  serviceLineId: z.string().uuid().optional(),
  salesStatusId: z.string().uuid().optional(),
  emailStatus: z.nativeEnum(EmailStatus).optional(),
  validationBand: z.nativeEnum(ValidationBand).optional(),
  approvalStatus: z.nativeEnum(SpocApprovalStatus).optional(),
  reviewFlag: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
  ...paginationQuery,
  sortBy: z.enum(["firstName", "createdAt", "updatedAt", "validationScore"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateClientInput = z.infer<typeof createClientBody>;
export type UpdateClientInput = z.infer<typeof updateClientBody>;
export type CreateLocationInput = z.infer<typeof createLocationBody>;
export type UpdateLocationInput = z.infer<typeof updateLocationBody>;
export type ListClientsQuery = z.infer<typeof listClientsQuery>;
export type CreateSpocInput = z.infer<typeof createSpocBody>;
export type UpdateSpocInput = z.infer<typeof updateSpocBody>;
export type ListSpocsQuery = z.infer<typeof listSpocsQuery>;

// ── bulk actions ─────────────────────────────────────────────────────────────

const bulkIds = (what: string) =>
  z
    .array(z.string().uuid(`Invalid ${what} id`))
    .min(1, `Select at least one ${what}`)
    .max(200, "At most 200 at a time")
    .transform((ids) => [...new Set(ids)]);

export const spocApprovalBody = z.object({
  spocIds: bulkIds("SPOC"),
  decision: z.nativeEnum(SpocApprovalStatus),
  note: optionalText(500),
});

export type SpocApprovalInput = z.infer<typeof spocApprovalBody>;

export const bulkAssignSpocsBody = z.object({
  spocIds: bulkIds("SPOC"),
  assignToId: z.string().uuid("assignToId is required"),
  reason: optionalText(500),
});

export const bulkClientStatusBody = z.object({
  clientIds: bulkIds("client"),
  status: z.nativeEnum(ClientStatus),
});

export const documentParams = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
});

export type BulkAssignSpocsInput = z.infer<typeof bulkAssignSpocsBody>;
export type BulkClientStatusInput = z.infer<typeof bulkClientStatusBody>;
