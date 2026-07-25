// File: authLog.service.ts
// Path: src/services/authLog.service.ts

import prisma from "@/utils/prisma/client";
import { Request } from "express";
import { AuthLogType } from "@prisma/client";

export const logAuthEvent = async (
  userId: string,
  type: AuthLogType,
  req: Request,
) => {
  try {
    await prisma.authLogs.create({
      data: {
        userId,
        type,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });
  } catch (error) {
    console.error(`Error creating auth log (${type}):`, error);
    // don't throw — a failed log write shouldn't block login/logout itself
  }
};
