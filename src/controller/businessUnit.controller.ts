import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { createAuditLog } from "@/services/auditLogs.service";

export const createBusinessUnit = async (req: Request, res: Response) => {
  try {
    const { name, isActive, parentBUId } = req.validatedBody;
    const existingBusinessUnit = await prisma.businessUnit.findUnique({
      where: { name },
    });
    if (existingBusinessUnit) {
      return res.status(400).json({ message: "Business unit already exists" });
    }
    const businessUnit = await prisma.businessUnit.create({
      data: { name, isActive, parentBUId },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "BUSINESS_UNIT",
      recordId: businessUnit.id,
      oldData: null,
      newData: businessUnit,
      req,
    });
    return res.status(201).json({
      success: true,
      message: "Business unit created successfully",
      data: businessUnit,
    });
  } catch (error) {
    console.error("Error creating business unit:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error creating business unit" });
  }
};

export const getAllBusinessUnits = async (req: Request, res: Response) => {
  try {
    console.log("Fetching all business units with hierarchy...");
    const businessUnits = await prisma.businessUnit.findMany({
      include: {
        parentBU: true,
        childBUs: {
          include: {
            childBUs: {
              include: {
                childBUs: true, // ⚠️ manually go deeper
              },
            },
          },
        },
        teams: true,
        users: true,
        clients: true,
        requirements: true,
      },
    });
    return res.status(200).json({
      success: true,
      message: "Business units fetched successfully",
      data: businessUnits,
    });
  } catch (error) {
    console.error("Error getting business units:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting business units" });
  }
};

export const getSingleBusinessUnit = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
      include: {
        childBUs: true,
        teams: true,
        users: true,
        clients: {
          include: {
            requirements: true,
          },
        },
      },
    });
    return res.status(200).json({
      success: true,
      message: "Business unit fetched successfully",
      data: businessUnit,
    });
  } catch (error) {
    console.error("Error getting business unit:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting business unit" });
  }
};

export const updateBusinessUnit = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { name, isActive, parentBUId } = req.validatedBody;
    const businessUnit = await prisma.businessUnit.findUnique({
      where: { id },
    });
    if (!businessUnit) {
      return res.status(404).json({ message: "Business unit not found" });
    }
    const updatedBusinessUnit = await prisma.businessUnit.update({
      where: { id },
      data: { name, isActive, parentBUId },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "BUSINESS_UNIT",
      recordId: id,
      oldData: businessUnit,
      newData: updatedBusinessUnit,
      req,
    });
    return res.status(200).json({
      success: true,
      message: "Business unit updated successfully",
      data: updatedBusinessUnit,
    });
  } catch (error) {
    console.error("Error updating business unit:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating business unit" });
  }
};

export const getBusinessUnitTree = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const businessUnits = await prisma.businessUnit.findUnique({
      where: { id },
      include: {
        childBUs: true,
        teams: true,
        users: true,
      },
    });
    // await createAuditLog({ actorId: req.user.id, action: "GET", module: "BUSINESS_UNIT", recordId: null, oldData: null, newData: businessUnits, req });
    return res.status(200).json({
      success: true,
      message: "Business units fetched successfully",
      data: businessUnits,
    });
  } catch (error) {
    console.error("Error getting business units:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting business units" });
  }
};
