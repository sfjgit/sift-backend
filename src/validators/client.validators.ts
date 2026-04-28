import { z } from "zod";

/**
 * ─────────────────────────────────────────────
 * COMMON
 * ─────────────────────────────────────────────
 */

export const uuidSchema = z.string();

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

/**
 * ─────────────────────────────────────────────
 * CLIENT CORE
 * ─────────────────────────────────────────────
 */

export const clientIdSchema = z.object({
  id: uuidSchema,
});

export const createClientSchema = z.object({
  name: z.string().min(2),
  vmsName: z.string().optional(),

  category: z
    .enum([
      "PRODUCT",
      "SERVICE",
      "CONSULTING",
      "STAFFING",
      "GOVERNMENT",
      "NGO",
      "OTHER",
    ])
    .optional(),

  industry: z.string().optional(),
  website: z.string().url().optional(),

  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),

  businessUnitId: uuidSchema.optional(), // 🔥 important for BU scoping

  parentClientId: uuidSchema.optional(),
});

export const updateClientSchema = createClientSchema.partial();

/**
 * ─────────────────────────────────────────────
 * GET ALL CLIENTS (ADVANCED FILTERS)
 * ─────────────────────────────────────────────
 */

export const getAllClientsSchema = paginationSchema.extend({
  search: z.string().optional(),

  status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]).optional(),

  category: z
    .enum([
      "PRODUCT",
      "SERVICE",
      "CONSULTING",
      "STAFFING",
      "GOVERNMENT",
      "NGO",
      "OTHER",
    ])
    .optional(),

  businessUnitId: uuidSchema.optional(), // 🔥 override / admin filter

  handlerId: uuidSchema.optional(), // filter clients handled by user

  teamId: uuidSchema.optional(), // filter via ClientTeamAssignment

  hasActiveRequirements: z.coerce.boolean().optional(),

  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),

  sortBy: z.enum(["createdAt", "name", "status"]).default("createdAt"),

  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * ─────────────────────────────────────────────
 * CONTACT (SPOC)
 * ─────────────────────────────────────────────
 */

export const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),

  designation: z.string().optional(),

  email: z.string().email(),
  phone: z.string().optional(),

  linkedinUrl: z.string().url().optional(),

  isPrimary: z.boolean().optional(),

  ownerId: uuidSchema.optional(), // internal owner
});

export const contactIdSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
});

/**
 * ─────────────────────────────────────────────
 * CONTACT HANDLERS (User ↔ Contact)
 * ─────────────────────────────────────────────
 */

export const contactHandlerParamsSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
});

export const assignContactHandlerSchema = z.object({
  userId: uuidSchema,

  role: z.enum(["PRIMARY", "SECONDARY", "BACKUP"]).default("PRIMARY"),
});

/**
 * ─────────────────────────────────────────────
 * CLIENT HANDLERS (Direct)
 * ─────────────────────────────────────────────
 */

export const assignClientHandlerSchema = z.object({
  userId: uuidSchema,

  role: z.enum(["PRIMARY", "SECONDARY", "BACKUP"]).default("PRIMARY"),
});

/**
 * ─────────────────────────────────────────────
 * CLIENT ↔ TEAM ASSIGNMENT
 * ─────────────────────────────────────────────
 */

export const assignClientTeamSchema = z.object({
  teamId: uuidSchema,
});

/**
 * ─────────────────────────────────────────────
 * CLIENT NOTES
 * ─────────────────────────────────────────────
 */

export const clientNoteSchema = z.object({
  content: z.string().min(1).max(2000),
});
