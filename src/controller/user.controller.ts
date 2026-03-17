import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { success } from "zod";
import { tr } from "zod/v4/locales";

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { roleId, buId, teamId, page, limit, isActive } = req.validatedQuery;
    const skip = (page - 1) * limit;

    //filters
    const where: any = { isActive, roleId, buId, teamId };

    console.log(where);
    const users = await prisma.user.findMany({
      where,
      skip,
      take: limit,
      include: { role: true, teamMemberships: true },
      orderBy: { createdAt: "desc" },
    });
    const total = await prisma.user.count({
      where,
    });
    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPage: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Error Fetching users :", error);
    return res
      .status(500)
      .json({ success: false, message: error.message, debug: error });
  }
};

export const getSingleUsers = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const where: any = { id };
    const singleUser = await prisma.user.findUnique({
      where,
      include: {
        role: true,
        teamMemberships: true,
        businessUnit: true,
      },
    });
    if (!singleUser) {
      return res.status(404).json({
        success: false,
        message: "user not found",
      });
    }
    return res.status(200).json({
      success: true,
      data: singleUser,
    });
  } catch (error: any) {
    console.error("Error fetching user", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      debug: error,
    });
  }
};

export const updateUsers = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { firstName, lastName, phone, workingLocation, timezone } =
      req.validatedBody;
    const updateUser = await prisma.user.update({
      where: { id: id },
      data: {
        firstName,
        lastName,
        phone,
        workingLocation,
        timezone,
      },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "UPDATE",
      module: "User",
      recordId: id,
      newData: { firstName, lastName, phone, workingLocation, timezone },
      req,
    });
    console.log(createAuditLog);
    return res.status(200).json({
      success: true,
      message: "User credentials got updated",
      updateUser,
    });
  } catch (error: any) {
    console.error("Error Updating user", error);
    return res
      .status(500)
      .json({ success: false, message: error.message, debug: error });
  }
};

export const deactivateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const user = await prisma.user.findUnique({ where: { id: id } });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "user not found" });
    }
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "User account deactivated",
        deactivateUser,
      });
    }
    //deactivate
    const deactivate = await prisma.user.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "DEACTIVATE",
      module: "User",
      recordId: id,
    });
    return res.json({ success: true });
  } catch (error: any) {
    console.error("Error deactivating user", error);
    return res
      .status(500)
      .json({ success: false, message: error.message, debug: error });
  }
};

export const reportingManager = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { reportingToId } = req.validatedBody;
    if (id === reportingToId) {
      return res
        .status(400)
        .json({ success: false, message: "User cannot report to themselves" });
    }
    const manager = await prisma.user.findUnique({
      where: { id: reportingToId },
    });
    if (!manager) {
      return res
        .status(404)
        .json({ success: false, message: "Reporting Manager not found" });
    }
    const updatedReportingManager = await prisma.user.update({
      where: { id },
      data: { reportingToId },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "SET_REPORTING_MANAGER",
      module: "user",
      recordId: id,
    });
    return res.json({
      success: true,
      message: "added reporting manager",
      data: updatedReportingManager,
    });
  } catch (error: any) {
    console.error("Error creating reporting manager");
    return res
      .status(500)
      .json({ success: true, message: error.message, dubug: error });
  }
};

export const subordinates = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const user = await prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: `No Subordinates for this particular user ${id}`,
      });
    }
    const subordinateUsers = await prisma.user.findMany({
      where: { reportingToId: id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });
    return res.json({
      success: true,
      message: "Subordinates fetched",
      data: subordinateUsers,
    });
  } catch (error: any) {
    console.error("Error fetching subordinates", error);
    return res
      .status(500)
      .json({ success: false, message: error.message, debug: error });
  }
};
