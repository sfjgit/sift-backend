import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import { TCreateOrgFlow } from "@/validators/orgFlow.validator";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { success } from "zod";
import { tr } from "zod/v4/locales";

export const orgFlows = async (req: Request, res: Response) => {
  try {
  } catch (error) {
    console.error("Error while getting organization flow");
    return res
      .status(500)
      .json({ success: false, message: "Inernal server error" });
  }
};
export const createOrgFlows = async (req: Request, res: Response) => {
  try {
    const { fromType, fromId, fromLabel, toType, toId, toLabel, relation } =
      req.validatedBody as TCreateOrgFlow;
    const existing = await prisma.orgFlow.findFirst({
      where: { fromType, fromId, toType, toId, relation },
    });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Flow already exist" });
    }
    const newflow = await prisma.orgFlow.create({
      data: {
        fromType,
        fromId,
        fromLabel,
        toType,
        toId,
        toLabel,
        createdById: req.user!.id,
      } as Prisma.OrgFlowUncheckedCreateInput,
      select: {
        id: true,
        fromType: true,
        fromId: true,
        fromLabel: true,
        toType: true,
        toId: true,
        toLabel: true,
        relation: true,
        isActive: true,
        createdById: true,
        createdAt: true,
      },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "CREATE",
      module: "ORG_FLOW",
      recordId: newflow.id,
    });
    return res.status(201).json({
      success: true,
      message: "Successfully create org flow",
      data: newflow,
    });
  } catch (error) {
    console.error("Error while creating organization flow");
    return res
      .status(500)
      .json({ success: false, message: "Inernal server error" });
  }
};
export const updateOrgFlows = async (req: Request, res: Response) => {
  try {
  } catch (error) {
    console.error("Error while updating organization flow");
    return res
      .status(500)
      .json({ success: false, message: "Inernal server error" });
  }
};
export const deleteOrgFlows = async (req: Request, res: Response) => {
  try {
  } catch (error) {
    console.error("Error while deleting organization flow");
    return res
      .status(500)
      .json({ success: false, message: "Inernal server error" });
  }
};
