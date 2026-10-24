// File: auth.ts
// Path: src/middleware/auth.ts

import { verifyAccessToken } from "@/utils/jwt";
import prisma from "@/utils/prisma/client";
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
  isActive: true,
} as const;

// ─── Authenticate User ────────────────────────────────────────────────────────
// JWT contains only { id } — everything else fetched fresh from DB every request
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
  let decoded: { id: string } | null = null;
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

  if (!decoded?.id) {
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

  const { isActive, ...authUser } = user;
  req.user = authUser;
  next();
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
