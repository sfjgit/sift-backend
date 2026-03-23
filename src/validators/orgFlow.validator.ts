import { FlowNodeType } from "@prisma/client";
import { string, z } from "zod";

export const orgFlowSchema = z.object({});
export const createOrgFlowSchema = z.object({
  fromType: z.enum(FlowNodeType),
  fromId: z.string().uuid(),
  fromLabel: z.string().min(1),
  toType: z.enum(FlowNodeType),
  toId: z.string().uuid(),
  toLabel: z.string().min(1),
  relation: z.string().min(1),
});

export type TCreateOrgFlow = z.infer<typeof createOrgFlowSchema>;
export const updateOrgFlowSchema = z.object({});
export const deleteOrgFlowSchema = z.object({});
