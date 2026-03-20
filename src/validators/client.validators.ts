import { ClientStatus } from "@prisma/client";
import { z } from "zod";

export const createClientSchema = z.object({
  name: z.string().min(1, "Client name is required"),
  vmsName: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
  website: z.string().optional(),
  country: z.string().min(1),
  state: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  businessUnitId: z.string().min(1).optional(),
  status: z.enum(ClientStatus).default("PENDING"),
  createdById: z.string(),
});
export type TCreateClientSchema = z.infer<typeof createClientSchema>;

export const getAllClientsSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Name is required").optional(),
  status: z.enum(ClientStatus),
  category: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  buId: z.string().optional(),
});
export type TGetAllClientsSchema = z.infer<typeof getAllClientsSchema>;

export const clientsIdSchema = z.object({
  id: z.string(),
});
// export const clientsApprovalSchema = z.object({
//   id: z.string(),
//   name: z.string().min(1, "Name is required").optional(),
//   status: z.enum(ClientStatus),
//   category: z.string().min(1).optional(),
//   approvedBy: z.string(),
//   approvedAt: z.number(),
// });
export type TClientsIdSchema = z.infer<typeof clientsIdSchema>;
