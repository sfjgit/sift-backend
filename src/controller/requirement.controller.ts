import { createAuditLog } from "@/services/auditLogs.service";
import { uploadToS3 } from "@/services/s3.service";
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

export const addNotes = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { notes } = req.validatedBody;
    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }
    const addedNotes = await prisma.requirementNote.create({
      data: {
        requirementId: id,
        authorId: req.user.id,
        content: notes,
      },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "REQUIREMENT_NOTE",
      recordId: addedNotes.id,
      oldData: null,
      newData: addedNotes,
      req,
    });
    return res.status(201).json({
      success: true,
      message: "Notes added successfully",
      data: addedNotes,
    });
  } catch (error) {
    console.error("Error adding notes:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add notes",
    });
  }
};

export const getRequirementStatusHistory = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.validatedParams;
    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }
    const requirementStatusHistory =
      await prisma.requirementStatusHistory.findMany({
        where: { requirementId: id },
      });
    return res.status(200).json({
      success: true,
      message: "Requirement status history fetched successfully",
      data: requirementStatusHistory,
    });
  } catch (error) {
    console.error("Error fetching requirement status history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch requirement status history",
    });
  }
};

export const fillAssignment = async (req: Request, res: Response) => {
  try {
    const { id, assignmentId } = req.validatedParams;
    const { filledOpenings } = req.validatedBody;
    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    // Check if the assignment exists
    const assignment = await prisma.requirementAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
      });
    }

    // Update the assignment
    const filledAssignment = await prisma.requirementAssignment.update({
      where: { id: assignmentId },
      data: {
        filledOpenings: filledOpenings,
      },
    });

    // Update the overall openings
    const totalOpenings = await prisma.requirement.findUnique({
      where: { id },
      select: {
        totalOpenings: true,
        filledOpenings: true,
      },
    });

    await prisma.requirement.update({
      where: { id },
      data: {
        filledOpenings: totalOpenings?.filledOpenings + filledOpenings,
      },
    });

    // Close the requirement if all openings are filled
    if (totalOpenings?.totalOpenings === totalOpenings?.filledOpenings) {
      await prisma.requirement.update({
        where: { id },
        data: {
          status: "CLOSED",
        },
      });
    }
    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "REQUIREMENT_ASSIGNMENT",
      recordId: filledAssignment.id,
      oldData: assignment,
      newData: filledAssignment,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Assignment filled successfully",
      data: filledAssignment,
    });
  } catch (error) {
    console.error("Error filling assignment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fill assignment",
    });
  }
};

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Type is required",
      });
    }

    const allowedTypes = [
      "FILE_UPLOAD",
      "STATUS_CHANGE",
      "ISSUE_RAISED",
      "NOTE",
      "POSITION_FILLED",
      "REQUIREMENT_CLOSED",
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid document type",
      });
    }

    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const allowedMimeTypes = ["application/pdf", "image/png", "image/jpeg"];

    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type",
      });
    }

    const { fileUrl } = await uploadToS3(req.file);

    const document = await prisma.requirementDocument.create({
      data: {
        requirementId: id,
        fileName: req.file.originalname,
        fileUrl,
        fileType: req.file.mimetype,
        type,
        raisedById: req.user.id,
      },
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "REQUIREMENT_DOCUMENT",
      recordId: document.id,
      oldData: null,
      newData: document,
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully",
      data: document,
    });
  } catch (error) {
    console.error("Error uploading document:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload document",
    });
  }
};

export const resolveIssue = async (req: Request, res: Response) => {
  try {
    const { id, documentId } = req.validatedParams;

    const requirement = await prisma.requirement.findUnique({
      where: { id },
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: "Requirement not found",
      });
    }

    const document = await prisma.requirementDocument.findUnique({
      where: { id: documentId },
    });

    if (!document || document.requirementId !== id) {
      return res.status(404).json({
        success: false,
        message: "Document not found for this requirement",
      });
    }

    if (document.issueResolved) {
      return res.status(400).json({
        success: false,
        message: "Issue already resolved",
      });
    }

    const resolvedDocument = await prisma.requirementDocument.update({
      where: { id: documentId },
      data: {
        issueResolved: true,
        resolvedById: req.user.id,
        resolvedAt: new Date(),
      },
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "REQUIREMENT_DOCUMENT",
      recordId: documentId,
      oldData: document,
      newData: resolvedDocument,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Issue resolved successfully",
      data: resolvedDocument,
    });
  } catch (error) {
    console.error("Error resolving issue:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resolve issue",
    });
  }
};
