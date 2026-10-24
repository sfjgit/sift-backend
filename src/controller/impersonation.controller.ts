// File: impersonation.controller.ts
// Path: src/controller/impersonation.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { cookieBase, setTokenCookies } from "@/middleware/auth";
import { generateAccessToken, generateRefreshToken } from "@/utils/jwt";

const PARK_MAX_AGE = 9 * 60 * 60 * 1000; // same as refreshToken cookie
const REFRESH_DB_TTL = 7 * 24 * 60 * 60 * 1000; // same as login

// POST /api/admin/users/:id/impersonate
export const startImpersonation = async (req: Request, res: Response) => {
  try {
    const admin = req.user; // super admin — enforced on the route
    const { id: targetUserId } = req.validatedParams;
    const adminRefreshToken = req.cookies?.refreshToken;

    if (!adminRefreshToken) {
      return res
        .status(400)
        .json({ success: false, message: "Session missing, please re-login" });
    }
    if (admin.id === targetUserId) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot login as yourself" });
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        isActive: true,
        isSuperAdmin: true,
      },
    });

    if (!target)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    if (!target.isActive)
      return res
        .status(400)
        .json({ success: false, message: "User is inactive" });
    if (target.isSuperAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Cannot login as a super admin" });
    }

    const log = await prisma.impersonationLog.create({
      data: {
        impersonatorId: admin.id,
        targetUserId: target.id,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    const accessToken = generateAccessToken({ id: target.id });
    const refreshToken = generateRefreshToken({ id: target.id });

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: target.id,
        expiresAt: new Date(Date.now() + REFRESH_DB_TTL),
      },
    });

    const base = cookieBase();

    // Park admin session
    res.cookie("impersonatorRefreshToken", adminRefreshToken, {
      ...base,
      httpOnly: true,
      maxAge: PARK_MAX_AGE,
    });
    res.cookie("impersonationLogId", log.id, {
      ...base,
      httpOnly: true,
      maxAge: PARK_MAX_AGE,
    });

    // Login as target
    setTokenCookies(res, accessToken, refreshToken);

    // Banner info (readable by frontend)
    const name =
      target.displayName || `${target.firstName} ${target.lastName}`.trim();
    res.cookie(
      "impersonatingAs",
      JSON.stringify({
        id: target.id,
        name,
        email: target.email,
        logId: log.id,
      }),
      { ...base, httpOnly: false, maxAge: PARK_MAX_AGE },
    );

    return res
      .status(200)
      .json({ success: true, message: "Logged in as user" });
  } catch (error) {
    console.error("🔴 [IMPERSONATE START] Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to login as user" });
  }
};

// POST /api/admin/impersonation/stop  (no auth — works even if token expired)
export const stopImpersonation = async (req: Request, res: Response) => {
  try {
    const adminRefreshToken = req.cookies?.impersonatorRefreshToken;
    const targetRefreshToken = req.cookies?.refreshToken;
    const logId = req.cookies?.impersonationLogId;
    const base = cookieBase();

    if (logId) {
      await prisma.impersonationLog.updateMany({
        where: { id: logId, endedAt: null },
        data: { endedAt: new Date() },
      });
    }

    // Remove the target session token created during impersonation
    if (targetRefreshToken && targetRefreshToken !== adminRefreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { token: targetRefreshToken },
      });
    }

    res.clearCookie("accessToken", base);
    res.clearCookie("impersonatorRefreshToken", base);
    res.clearCookie("impersonationLogId", base);
    res.clearCookie("impersonatingAs", base);

    if (!adminRefreshToken) {
      res.clearCookie("refreshToken", base);
      return res
        .status(401)
        .json({ success: false, message: "Session lost, please re-login" });
    }

    // Restore admin → frontend calls /auth/refresh next
    res.cookie("refreshToken", adminRefreshToken, {
      ...base,
      httpOnly: true,
      maxAge: PARK_MAX_AGE,
    });

    return res
      .status(200)
      .json({ success: true, message: "Back to your account" });
  } catch (error) {
    console.error("🔴 [IMPERSONATE STOP] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to exit" });
  }
};
