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
});
export type TCreateClientSchema = z.infer<typeof createClientSchema>;

export const getAllClientsSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Name is required").optional(),
  status: z.nativeEnum(ClientStatus).optional(),
  category: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  buId: z.string(),
});
export type TGetAllClientsSchema = z.infer<typeof getAllClientsSchema>;
