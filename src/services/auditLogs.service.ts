// File: auditLog.ts
// Path: src/utils/audit/auditLog.ts

import prisma from "@/utils/prisma/client";
import { Request } from "express";

interface AuditLogParams {
  actorId: string;
  action: string;
  module: string;
  recordId: string;
  oldData?: unknown;
  newData?: unknown;
  req?: Request;
}

const extractClientIp = (req?: Request): string | null => {
  if (!req) return null;
  // req.ip already respects `trust proxy`; fall back to raw XFF head if unset
  if (req.ip) return req.ip;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  return null;
};

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
        oldData: oldData as any,
        newData: newData as any,
        ip: extractClientIp(req),
        userAgent: (req?.headers["user-agent"] as string) ?? null,
      },
    });
  } catch (error) {
    console.error("Audit log failed:", error);
  }
};
