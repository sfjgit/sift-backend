import prisma from "@/utils/prisma/client";
import { Request } from "express";

interface AuditLogParams {
  actorId: string;
  action: string;
  module: string;
  recordId: string;
  oldData?: any;
  newData?: any;
  req?: Request;
}

export const createAuditLog = async ({
  actorId,
  action,
  module,
  recordId,
  oldData,
  newData,
  req,
}: AuditLogParams) => {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        module,
        recordId,
        oldData,
        newData,
        ip: req?.ip,
        userAgent: req?.headers["user-agent"] as string,
      },
    });
  } catch (error) {
    console.error("Audit log failed:", error);
  }
};