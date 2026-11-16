// File: auth.ts
// Path: src/middleware/auth.ts

import { verifyAccessToken, type JWTPayLoad } from "@/utils/jwt";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { runInTenant } from "@/utils/prisma/tenant";
import { runWithChanges } from "@/utils/prisma/changes";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Request, Response, NextFunction } from "express";
import {
  JsonWebTokenError,
  NotBeforeError,
  TokenExpiredError,
} from "jsonwebtoken";

config();

export const AUTH_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  roleId: true,
  isSuperAdmin: true,
  departmentId: true,
  tenantId: true,
  isActive: true,
  tenant: { select: { status: true } },
} as const satisfies Prisma.UserSelect;

// ─── Authenticate User ────────────────────────────────────────────────────────
// JWT contains only { id } — everything else fetched fresh from DB every request.
// The user lookup runs before any tenant is known (ids are unique everywhere).
export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const accessToken =
    req.cookies?.accessToken ||
    req.headers.authorization?.replace("Bearer ", "").trim();

  if (!accessToken) {
    res.status(401).json({
      success: false,
      message: "Access token not provided",
      code: "NO_TOKEN",
    });
    return;
  }

  // JWT failures are 401s, never 500s
  let decoded: JWTPayLoad | null = null;
  try {
    decoded = verifyAccessToken(accessToken);
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      res.status(401).json({
        success: false,
        message: "Access token expired",
        code: "TOKEN_EXPIRED", // interceptor hook → call /auth/refresh
        expiredAt: err.expiredAt,
      });
      return;
    }
    if (err instanceof JsonWebTokenError || err instanceof NotBeforeError) {
      res.status(401).json({
        success: false,
        message: "Invalid access token",
        code: "INVALID_TOKEN",
      });
      return;
    }
    throw err;
  }

  // an enterprise-console token is not a CRM session
  if (!decoded?.id || decoded.scope === "platform") {
    res.status(401).json({
      success: false,
      message: "Invalid access token payload",
      code: "INVALID_TOKEN",
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: AUTH_USER_SELECT,
  });

  if (!user) {
    res.status(401).json({
      success: false,
      message: "User not found",
      code: "USER_NOT_FOUND",
    });
    return;
  }

  if (!user.isActive) {
    res.status(403).json({
      success: false,
      message: "Account is deactivated",
      code: "ACCOUNT_DEACTIVATED",
    });
    return;
  }

  // a suspended company is locked out as a whole
  if (user.tenant.status !== "ACTIVE") {
    res.status(403).json({
      success: false,
      message: "Your company's CRM access is suspended. Contact your administrator.",
      code: "TENANT_SUSPENDED",
    });
    return;
  }

  const { isActive, tenant, ...authUser } = user;
  req.user = authUser;
  // everything after this runs as the user's tenant (every Prisma query is scoped)
  // …and every write it makes is one undoable batch (recycle bin)
  const batchId = randomUUID();
  res.setHeader("X-Change-Batch", batchId);
  runInTenant(user.tenantId, () => runWithChanges({ actorId: user.id, batchId, source: req.get("x-ai-action") ? "ai" : "web" }, next));
};

// ─── Set Token Cookies ────────────────────────────────────────────────────────
// prod: secure + sameSite none — required for cross-origin (frontend ≠ backend domain)
export const cookieBase = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    secure: isProd,
    sameSite: isProd ? ("none" as const) : ("lax" as const),
    path: "/",
  };
};

export const setTokenCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
) => {
  const base = cookieBase();

  res.cookie("accessToken", accessToken, {
    ...base,
    httpOnly: false,
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    ...base,
    httpOnly: true,
    maxAge: 9 * 60 * 60 * 1000,
  });
};
