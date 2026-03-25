import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import {
  TCreateOrgFlow,
  TOrgFlowSchema,
  TUpdateOrgFlow,
} from "@/validators/orgFlow.validator";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { success } from "zod";

export const orgFlows = async (req: Request, res: Response) => {
  try {
    const { fromId, fromType } = req.validatedQuery as TOrgFlowSchema;

    const flow = await prisma.orgFlow.findMany({
      where: {
        fromId,
        fromType,
      },
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
      },
    });
    return res.status(200).json({
      success: true,
      message: "Org flows fetched succesfully",
      data: flow,
    });
  } catch (error) {
    console.error("Error while getting organization flow", error);
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
        .json({ success: false, message: "Flow already exists" });
    }
    const newflow = await prisma.orgFlow.create({
      data: {
        fromType,
        fromId,
        fromLabel,
        toType,
        toId,
        toLabel,
        relation,
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
      message: "Successfully created org flow",
      data: newflow,
    });
  } catch (error) {
    console.error("Error while creating organization flow", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
export const updateOrgFlows = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams as { id: string };
    const { relation, fromLabel, toLabel } =
      req.validatedBody as TUpdateOrgFlow;

    const existing = await prisma.orgFlow.findUnique({ where: { id } });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Org flow not found" });
    }

    const updated = await prisma.orgFlow.update({
      where: { id },
      data: {
        ...(relation && { relation }),
        ...(fromLabel && { fromLabel }),
        ...(toLabel && { toLabel }),
        updatedById: req.user!.id,
      },
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
        updatedById: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: "UPDATE",
      module: "ORG_FLOW",
      recordId: updated.id,
    });

    return res.status(200).json({
      success: true,
      message: "Org flow updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error while updating organization flow", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
export const deleteOrgFlow = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams as { id: string };

    const existing = await prisma.orgFlow.findUnique({ where: { id } });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Org flow not found" });
    }

    await prisma.orgFlow.delete({ where: { id } });

    await createAuditLog({
      actorId: req.user!.id,
      action: "DELETE",
      module: "ORG_FLOW",
      recordId: id,
    });

    return res
      .status(200)
      .json({ success: true, message: "Org flow deleted successfully" });
  } catch (error) {
    console.error("Error while deleting organization flow", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
