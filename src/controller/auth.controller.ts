import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import {
  generateAccessToken,
  generateRefreshToken,
  JWTPayLoad,
  verifyAccessToken,
  verifyRefreshToken,
} from "@/utils/jwt";
import { createAuditLog } from "@/services/auditLogs.service";
import { setTokenCookies } from "@/middleware/auth";
import { loggers } from "@/utils/logger";

export const register = async (req: Request, res: Response) => {
  try {
    const {
      email,
      passwordHash: password,
      roleId,
      firstName,
      lastName,
      ...rest
    } = req.validatedBody;
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    const roleData = await prisma.role.findUnique({
      where: { id: roleId },
    });
    if (!roleData) {
      return res.status(400).json({ message: "Role not found" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        ...rest,
        email,
        passwordHash: hashedPassword,
        roleId: roleId,
        firstName,
        lastName,
      },
    });
    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module: "USER",
      recordId: user.id,
      oldData: null,
      newData: user,
      req,
    });
    console.log("Audit log created successfully");
    const { passwordHash, passwordPlain, ...safeUser } = user;
    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: safeUser,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error creating user" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.validatedBody;
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });
    console.log(user);
    if (!user) {
      return res.status(401).json({ message: "Email not found" });
    }
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid password" });
    }
    // @ts-expect-error err
    const payload: JWTPayLoad = {
      ...user,
      role: {
        name: user.role.name,
        permissions: user.role.permissions,
      },
    };

    console.log("JWT Payload:", JSON.stringify(payload, null, 2));
    loggers.info("JWT Payload:", JSON.stringify(payload, null, 2));

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    setTokenCookies(res, accessToken, refreshToken, req);
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await createAuditLog({
      actorId: user.id,
      action: "LOGIN",
      module: "Auth",
      recordId: user.id,
      req,
    });
    console.log("Audit log created successfully");
    const { passwordHash, passwordPlain, ...safeUser } = user;
    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: safeUser,
      // accessToken: accessToken,
      // refreshToken: refreshToken,
    });
  } catch (error) {
    console.error("Error logging in:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error logging in" });
  }
};

export const refresh = async (req: Request, res: Response) => {
  try {
    // Token comes from httpOnly cookie, not body
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    // Verify with the REFRESH secret, not access secret
    const decoded = verifyRefreshToken(refreshToken) as JWTPayLoad;

    // Check token exists in DB and is not expired/revoked
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    // Fetch full user with role + permissions — same as login
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User not found or inactive",
      });
    }

    const payload: JWTPayLoad = {
      userId: user.id,
      email: user.email,
      roleId: user.roleId,
      role: {
        name: user.role.name,
        permissions: user.role.permissions,
      },
    };

    // Rotate — delete old refresh token, issue new pair
    await prisma.refreshToken.delete({ where: { token: refreshToken } });

    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    setTokenCookies(res, newAccessToken, newRefreshToken, req);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Return same user shape as login
    const { passwordHash, passwordPlain, ...safeUser } = user;

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: safeUser,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.validatedBody;
    const userId = req.headers["x-user-id"] as string;
    await prisma.refreshToken.delete({
      where: {
        token: refreshToken,
        userId: userId,
      },
    });
    await createAuditLog({
      actorId: userId,
      action: "LOGOUT",
      module: "Auth",
      recordId: userId,
      req,
    });
    console.log("Audit log created successfully");
    return res
      .status(200)
      .json({ success: true, message: "Logout successful" });
  } catch (error) {
    console.error("Error logging out:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error logging out" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { userId } = req.validatedParams;
    const { password } = req.validatedBody;
    const oldUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!oldUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashedPassword,
      },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "UPDATE",
      module: "User",
      recordId: userId,
      oldData: { passwordHash: oldUser?.passwordHash },
      newData: { passwordHash: updatedUser.passwordHash },
      req,
    });
    console.log("Audit log created successfully");
    return res
      .status(200)
      .json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Error resetting password:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error resetting password" });
  }
};

export const getUserCredentials = async (req: Request, res: Response) => {
  try {
    const { userId } = req.validatedParams;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "GET",
      module: "User",
      recordId: userId,
      req,
    });
    console.log("Audit log created successfully");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({
      success: true,
      message: "User credentials fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error getting user credentials:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error getting user credentials" });
  }
};
