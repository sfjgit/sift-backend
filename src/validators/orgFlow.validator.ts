import { FlowNodeType } from "@prisma/client";
import { string, z } from "zod";

export const idParamSchema = z.object({
  id: string(),
});
export type TIdSchema = z.infer<typeof idParamSchema>;

export const orgFlowSchema = z.object({
  fromType: z.enum(FlowNodeType),
  fromId: z.string().uuid(),
});
export type TOrgFlowSchema = z.infer<typeof orgFlowSchema>;

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

export const updateOrgFlowSchema = z.object({
  fromLabel: z.string().min(1),
  toLabel: z.string().min(1),
  relation: z.string().min(1),
});
export type TUpdateOrgFlow = z.infer<typeof updateOrgFlowSchema>;
