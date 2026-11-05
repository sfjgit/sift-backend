// File: platformAuth.ts
// Path: src/middleware/platformAuth.ts
//
// Enterprise console sessions — separate from CRM sessions. Its own httpOnly
// cookie (platformToken) carrying a "platform" token; only active users with
// isPlatformAdmin get one. Requests then run across every tenant (no tenant
// filter), so platform handlers name tenants themselves.

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "@/utils/prisma/client";
import { runAsPlatform } from "@/utils/prisma/tenant";
import type { JWTPayLoad } from "@/utils/jwt";

export const PLATFORM_COOKIE = "platformToken";

export const platformCookie = () => {
  const isProd = process.env.NODE_ENV === "production";
  return { httpOnly: true, secure: isProd, sameSite: isProd ? ("none" as const) : ("lax" as const), path: "/" };
};

const deny = (res: Response, status: number, code: string, message: string) => {
  res.status(status).json({ success: false, code, message });
};

export const authenticatePlatform = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.[PLATFORM_COOKIE] || req.headers.authorization?.replace("Bearer ", "").trim();
  if (!token) return deny(res, 401, "NO_TOKEN", "Sign in to the enterprise console");

  let decoded: JWTPayLoad;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayLoad;
  } catch {
    return deny(res, 401, "INVALID_TOKEN", "Session expired — sign in again");
  }
  if (decoded.scope !== "platform") return deny(res, 401, "INVALID_TOKEN", "Not an enterprise console session");

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      roleId: true,
      isSuperAdmin: true,
      departmentId: true,
      tenantId: true,
      isActive: true,
      isPlatformAdmin: true,
    },
  });
  if (!user?.isActive || !user.isPlatformAdmin) return deny(res, 403, "FORBIDDEN", "Enterprise console access only");

  const { isActive, isPlatformAdmin, ...authUser } = user;
  req.user = authUser;
  runAsPlatform(next);
};
