import { z } from "zod";
import {
  RequirementType,
  RemoteType,
  Priority,
  RequirementStatus,
} from "@prisma/client";

export const RequirementTypeEnum = z.enum(RequirementType);
export const RemoteTypeEnum = z.enum(RemoteType);
export const PriorityEnum = z.enum(Priority);
export const RequirementStatusEnum = z.enum(RequirementStatus);

export const createRequirementsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  clientId: z.string(),
  clientContactId: z.string().optional(),
  businessUnitId: z.string().optional(),
  jobType: RequirementTypeEnum,
  remoteType: RemoteTypeEnum,
  priority: PriorityEnum.optional(),
  totalOpenings: z.number().int().positive().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryType: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  respondBy: z.string().datetime().optional(),
  turnaroundDays: z.number().int().optional(),
  createdBy: z.string(),
  deliveryLeadId: z.string().uuid().optional(),
  teamLeadId: z.string().uuid().optional(),
});
