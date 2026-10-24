// File: impersonationAudit.middleware.ts
// Path: src/middleware/impersonationAudit.middleware.ts
//
// While a super admin is logged in as someone else, every write request is
// recorded in AuditLog (module "impersonation", actor = the real admin).

import { Request, Response, NextFunction } from "express";
import prisma from "@/utils/prisma/client";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REDACT_KEYS = (
  process.env.AUDIT_REDACT_KEYS ??
  "password,newPassword,oldPassword,confirmPassword,token,accessToken,refreshToken"
)
  .split(",")
  .map((k) => k.trim().toLowerCase());

function redact(value: any, depth = 0): any {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.includes(k.toLowerCase())
      ? "[REDACTED]"
      : redact(v, depth + 1);
  }
  return out;
}

export const impersonationAudit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const logId = req.cookies?.impersonationLogId;

  // Normal users: no cookie → untouched
  if (!logId || SAFE_METHODS.has(req.method)) return next();

  try {
    const log = await prisma.impersonationLog.findUnique({
      where: { id: logId },
      select: { id: true, impersonatorId: true, targetUserId: true, endedAt: true },
    });

    if (!log || log.endedAt) return next();

    const path = req.originalUrl.split("?")[0];
    const body = req.body ? redact(req.body) : null;

    res.on("finish", () => {
      // req.user is set by authenticateUser inside the route
      if (req.user?.id !== log.targetUserId) return;

      prisma.auditLog
        .create({
          data: {
            actorId: log.impersonatorId,
            action: `IMPERSONATED_${req.method}`,
            module: "impersonation",
            recordId: log.id,
            newData: {
              targetUserId: log.targetUserId,
              path,
              statusCode: res.statusCode,
              body,
            },
            ip: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          },
        })
        .catch((err) => console.error("impersonationAudit write failed:", err));
    });

    next();
  } catch (err) {
    console.error("impersonationAudit error:", err);
    next(); // never break the app
  }
};
