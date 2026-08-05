// File: ticket.validation.ts
// Path: src/modules/ticket/ticket.validation.ts

import { z } from "zod";
// import { TicketPriority, TicketStatus } from "@prisma/client";

export const createTicketSchema = z.object({
  title: z.string().min(3).max(180),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  categoryId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

export const updateTicketSchema = z.object({
  title: z.string().min(3).max(180).optional(),
  description: z.string().optional(),
  status: z
    .enum(["OPEN", "CLOSED", "ON_HOLD", "CANCELLED", "RESOLVED", "REOPENED"])
    .optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

export const listTicketQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(), // csv
  priority: z.string().optional(), // csv
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type ListTicketQuery = z.infer<typeof listTicketQuerySchema>;

// File: ticket.validation.ts
// Path: src/validators/ticket.validation.ts
// --- APPEND ---

export const createCategorySchema = z.object({
  name: z.string().min(2).max(60).trim(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(2).max(60).trim().optional(),
  isActive: z.boolean().optional(),
});
