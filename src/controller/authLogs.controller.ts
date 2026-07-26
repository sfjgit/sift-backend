// File: authLogs.controller.ts
// Path: src/controller/authLogs.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { authLogScopeWhere } from "@/middleware/scopeFilter.middleware";

export const listAuthLogs = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      userId,
      departmentId,
      type,
      startDate,
      endDate,
    } = req.validatedQuery as any;

    const where: any = { ...authLogScopeWhere(req.scopeFilter!) };

    if (userId) where.userId = userId;
    if (departmentId) where.user = { departmentId };
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      prisma.authLogs.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.authLogs.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error listing auth logs:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching auth logs" });
  }
};
