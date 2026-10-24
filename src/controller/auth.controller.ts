// File: auth.controller.ts
// Path: src/controller/auth.controller.ts

import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "@/utils/jwt";
import { createAuditLog } from "@/services/auditLogs.service";
import { cookieBase, setTokenCookies } from "@/middleware/auth";
import { logAuthEvent } from "@/services/authLog.service";
import { getUserPermissionMap } from "@/services/permission.service";
import { sendMail } from "@/utils/mailer";
import { ApiError } from "@/utils/httpError";

const REFRESH_DB_TTL = 7 * 24 * 60 * 60 * 1000;

// what the frontend gets after login / refresh / me
const SESSION_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  employeeId: true,
  isSuperAdmin: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
} as const;

const sessionPayload = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: SESSION_USER_SELECT,
  });
  const permissions = await getUserPermissionMap(user);
  return { ...user, permissions };
};

const issueTokens = async (res: Response, userId: string) => {
  const accessToken = generateAccessToken({ id: userId });
  const refreshToken = generateRefreshToken({ id: userId });

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_DB_TTL),
    },
  });

  setTokenCookies(res, accessToken, refreshToken);
};

// ── POST /auth/login
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.validatedBody;

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, passwordHash: true },
  });

  if (!user) throw ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    await logAuthEvent(user.id, "FAILED_LOGIN", req);
    throw ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  await issueTokens(res, user.id);
  await logAuthEvent(user.id, "LOGIN", req);

  res.json({
    success: true,
    message: "Login successful",
    data: await sessionPayload(user.id),
  });
};

// ── POST /auth/refresh — token comes from httpOnly cookie
export const refresh = async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) throw ApiError(401, "Refresh token required", "NO_TOKEN");

  try {
    verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    select: { userId: true, expiresAt: true, user: { select: { isActive: true } } },
  });

  if (!stored || stored.expiresAt < new Date() || !stored.user.isActive) {
    throw ApiError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
  }

  // rotate — delete old, issue new pair
  await prisma.refreshToken.delete({ where: { token: refreshToken } });
  await issueTokens(res, stored.userId);
  await logAuthEvent(stored.userId, "REFRESH", req);

  res.json({
    success: true,
    message: "Token refreshed successfully",
    data: await sessionPayload(stored.userId),
  });
};

// ── GET /auth/me
export const me = async (req: Request, res: Response) => {
  res.json({ success: true, data: await sessionPayload(req.user.id) });
};

// ── POST /auth/logout
export const logout = async (req: Request, res: Response) => {
  const userId = req.user.id;

  await prisma.refreshToken.deleteMany({ where: { userId } });
  await logAuthEvent(userId, "LOGOUT", req);

  const base = cookieBase();
  res.clearCookie("accessToken", base);
  res.clearCookie("refreshToken", base);

  res.json({ success: true, message: "Logout successful" });
};

// ── POST /auth/change-password — logged-in user changes own password
export const changePassword = async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.validatedBody;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user.id },
    select: { passwordHash: true },
  });

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError(400, "Current password is incorrect", "WRONG_PASSWORD");
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  await logAuthEvent(req.user.id, "PASSWORD_CHANGE", req);

  res.json({ success: true, message: "Password changed" });
};

// ── POST /auth/forgot-password
export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.validatedBody;
  const genericReply = {
    success: true,
    message: "If an account exists, a password reset link has been sent.",
  };

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true },
  });
  // prevent email enumeration
  if (!user) return res.json(genericReply);

  const token = crypto.randomBytes(32).toString("hex");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordToken: token,
      resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  const resetUrl = `${process.env.FRONTEND_URL}/sign-in?token=${token}`;

  await sendMail({
    to: email,
    subject: "Reset Password",
    html: `
      <h2>Password Reset</h2>
      <p>You requested a password reset.</p>
      <p>Click below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>This link expires in 15 minutes.</p>
    `,
  });

  res.json(genericReply);
};

// ── POST /auth/reset-password — token from forgot-password or welcome mail
export const resetPasswordByToken = async (req: Request, res: Response) => {
  const { token, password } = req.validatedBody;

  const user = await prisma.user.findFirst({
    where: { resetPasswordToken: token, resetPasswordExpires: { gt: new Date() } },
    select: { id: true },
  });

  if (!user) throw ApiError(400, "Invalid or expired reset link", "INVALID_TOKEN");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);

  await logAuthEvent(user.id, "PASSWORD_RESET", req);
  await createAuditLog({
    actorId: user.id,
    action: "PASSWORD_RESET",
    module: "auth",
    recordId: user.id,
    req,
  });

  res.json({ success: true, message: "Password reset successfully" });
};
