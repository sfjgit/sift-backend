import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

export const createTeam = async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      isActive,
      category,
      parentTeamId,
      businessUnitId,
    } = req.validatedBody;
    const existingTeam = await prisma.team.findFirst({
      where: { name },
    });
    if (existingTeam) {
      return res.status(400).json({ message: "Team already exists" });
    }
    const team = await prisma.team.create({
      data: {
        name,
        description,
        isActive,
        category,
        parentTeamId,
        businessUnitId,
      },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "TEAM",
      recordId: team.id,
      oldData: null,
      newData: team,
      req,
    });
    return res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: team,
    });
  } catch (error) {
    console.error("Error creating team:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error creating team" });
  }
};

export const getTeams = async (req: Request, res: Response) => {
  try {
    const { name, isActive, category, parentTeamId, businessUnitId, search } =
      req.validatedQuery;

    // 🔍 Build filters dynamically
    const where: any = {
      ...(name && {
        name: {
          contains: name,
          mode: "insensitive",
        },
      }),

      ...(typeof isActive === "boolean" && { isActive }),

      ...(category && {
        category: {
          contains: category,
          mode: "insensitive",
        },
      }),

      ...(parentTeamId && { parentTeamId }),

      ...(businessUnitId && { businessUnitId }),

      ...(search && {
        OR: [
          {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            category: {
              contains: search,
              mode: "insensitive",
            },
          },
        ],
      }),
    };

    const teams = await prisma.team.findMany({
      where,
      orderBy: { createdAt: "desc" }, // optional but recommended
    });

    return res.status(200).json({
      success: true,
      data: teams,
    });
  } catch (error: any) {
    console.error("Get Teams Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch teams",
      error: error.message,
    });
  }
};

export const updateTeams = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams;
    const {
      name,
      description,
      isActive,
      category,
      businessUnitId,
      parentTeamId,
    } = req.validatedBody;
    const team = await prisma.team.update({
      where: { id },
      data: {
        name,
        description,
        isActive,
        category,
        businessUnitId,
        parentTeamId,
      },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module: "TEAM",
      recordId: team.id,
      oldData: null,
      newData: team,
      req,
    });
    return res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: team,
    });
  } catch (error) {
    console.error("Error updating team:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating team" });
  }
};

export const addTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id: teamId } = req.validatedParams;
    const members = req.validatedBody;

    // 1. Check if team exists
    const team = await prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // 2. Prepare data (override teamId from params for safety)
    const data = members.map((member: any) => ({
      userId: member.userId,
      teamId: teamId, // enforce from params
      teamRole: member.teamRole ?? "MEMBER",
      isActive: member.isActive ?? true,
    }));

    // 3. Insert (skip duplicates)
    const result = await prisma.teamMember.createMany({
      data,
      skipDuplicates: true, // avoids unique constraint crash
    });

    return res.status(201).json({
      success: true,
      message: "Members added successfully",
      count: result.count,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to add members",
    });
  }
};

export const removeTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id: teamId, userId } = req.validatedParams;

    // 1. Check if membership exists
    const member = await prisma.teamMember.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    // 2. Delete member
    await prisma.teamMember.delete({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Member removed successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove member",
    });
  }
};

export const getAllTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id: teamId } = req.validatedParams;
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: { user: true },
    });
    return res
      .status(200)
      .json({
        success: true,
        message: "Team members fetched successfully",
        data: members,
      });
  } catch (error) {
    console.error("Error getting team members:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting team members" });
  }
};
