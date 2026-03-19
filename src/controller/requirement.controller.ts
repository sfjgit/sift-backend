import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

export const createRequirements = async (req: Request, res: Response) => {
  try {
    const data = req.validatedBody;
    const userId = req.user.id;

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
        createdBy: userId,
      },
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
