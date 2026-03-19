import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

export const createRequirements = async (req: Request, res: Response) => {
  try {
    const data = req.validatedBody;

    const lastRequirement = await prisma.requirement.findFirst({
      orderBy: { createdAt: "desc" },
      select: { reqCode: true },
    });

    let nextNumber = 10001;

    if (lastRequirement?.reqCode) {
      const lastNumber = parseInt(lastRequirement.reqCode.split("-")[2]);
      nextNumber = lastNumber + 1;
    }

    const reqCode = `SFJ-R-${nextNumber}`;

    const requirement = await prisma.requirement.create({
      data: {
        ...data,
        reqCode,
      },
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "REQUIREMENT",
      recordId: requirement.id,
      oldData: null,
      newData: requirement,
      req,
    });

    return res.status(201).json({
      success: true,
      data: requirement,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to create requirement",
    });
  }
};

export const getAllRequirements = async (req: Request, res: Response) => {
  try {
    const { status, clientId, priority, jobType, search } = req.validatedQuery;

    const where: any = {};

    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (priority) where.priority = priority;
    if (jobType) where.jobType = jobType;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { reqCode: { contains: search, mode: "insensitive" } },
      ];
    }

    const requirements = await prisma.requirement.findMany({
      where,
      include: {
        client: true,
        clientContact: true,
        businessUnit: true,

        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        deliveryLead: {
          select: {
            id: true,
            firstName: true,
          },
        },

        teamLead: {
          select: {
            id: true,
            firstName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      count: requirements.length,
      data: requirements,
    });
  } catch (error) {
    console.error("Error fetching requirements:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch requirements",
    });
  }
};

export const getRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const requirement = await prisma.requirement.findUnique({
      where: { id },
      include: {
        client: true,
        clientContact: true,
        businessUnit: true,
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        deliveryLead: {
          select: {
            id: true,
            firstName: true,
          },
        },

        teamLead: {
          select: {
            id: true,
            firstName: true,
          },
        },
        assignments: true,
        documents: true,
        notes: true,
        statusHistory: true,
      },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: requirement,
    });
  } catch (error) {
    console.error("Error fetching requirement:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch requirement",
    });
  }
};

export const approveRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { deliveryLeadId, teamLeadId } = req.validatedBody || {};

    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    const updatedRequirement = await prisma.requirement.update({
      where: { id },
      data: {
        status: "ACTIVE",
        ...(deliveryLeadId && { deliveryLeadId }),
        ...(teamLeadId && { teamLeadId }),
      },
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "REQUIREMENT",
      recordId: id,
      oldData: requirement,
      newData: updatedRequirement,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Requirement approved successfully",
      data: updatedRequirement,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve requirement",
    });
  }
};

export const changeRequirementStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { status, reason } = req.validatedBody;

    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    const updatedRequirement = await prisma.requirement.update({
      where: { id },
      data: {
        status,
      },
    });

    await prisma.requirementStatusHistory.create({
      data: {
        requirementId: id,
        fromStatus: requirement.status,
        toStatus: status,
        changedById: req.user.id,
        reason: reason,
      },
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "REQUIREMENT",
      recordId: id,
      oldData: requirement,
      newData: updatedRequirement,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Requirement status changed successfully",
      data: updatedRequirement,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to change requirement status",
    });
  }
};

export const assignRequirement = async (req: Request, res: Response) => {
  try {
    const { id: requirementId } = req.validatedParams;
    const {
      assignmentType,
      recruiterId,
      teamId,
      allocatedOpenings,
      isAutoRouted,
      isSystemAssigned,
    } = req.validatedBody;

    const userId = req.user?.id;

    const requirement = await prisma.requirement.findUnique({
      where: { id: requirementId },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    const assignment = await prisma.requirementAssignment.create({
      data: {
        requirementId,
        assignmentType,
        recruiterId,
        teamId,
        allocatedOpenings,
        isAutoRouted,
        isSystemAssigned,
        assignedById: userId,
      },
    });

    await createAuditLog({
      actorId: userId,
      action: "CREATE",
      module: "REQUIREMENT_ASSIGNMENT",
      recordId: assignment.id,
      oldData: null,
      newData: assignment,
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Assignment created successfully",
      data: assignment,
    });
  } catch (error) {
    console.error("Error creating assignment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create assignment",
    });
  }
};
