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
  status: z.enum(ClientStatus).optional(),
  category: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  buId: z.string().optional(),
});
export type TGetAllClientsSchema = z.infer<typeof getAllClientsSchema>;

export const clientsIdSchema = z.object({
  id: z.string(),
});
export type TClientsIdSchema = z.infer<typeof clientsIdSchema>;

export const spocContactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1).optional(),
  designation: z.string().min(1).optional(),
  email: z.string().email("Invalid Email"),
  phone: z.string().min(1).optional(),
  linkedinUrl: z.string().url().optional(),
  isPrimary: z.boolean().default(false),
});
export type TspocContactSchema = z.infer<typeof spocContactSchema>;

export const assignContactHandlerSchema = z.object({
  userId: z.string().uuid("Invalid user id"),
});

export type TAssignContactHandlerSchema = z.infer<
  typeof assignContactHandlerSchema
>;
export const contactHandlerParamsSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
});

export type TContactHandlerParamsSchema = z.infer<
  typeof contactHandlerParamsSchema
>;
