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
import crypto from "crypto";
import nodemailer from "nodemailer";
import env from "@/config/env";

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
    const { passwordHash, ...safeUser } = user;
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
    console.log("🔵 [LOGIN] Request received");
    console.log("🔵 [LOGIN] Body:", req.validatedBody);

    const { email, password } = req.validatedBody;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: true } } },
    });

    if (!user) {
      console.log("🔴 [LOGIN] User not found:", email);
      return res.status(401).json({ message: "Email not found" });
    }
    console.log("🟢 [LOGIN] User found:", user.id, user.email);

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      console.log("🔴 [LOGIN] Invalid password for:", email);
      return res.status(401).json({ message: "Invalid password" });
    }
    console.log("🟢 [LOGIN] Password valid");

    const payload: any = {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      isSuperAdmin: user.isSuperAdmin,
      isActive: user.isActive,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    console.log("🟢 [LOGIN] Tokens generated");
    console.log("🟢 [LOGIN] accessToken:", accessToken?.slice(0, 20) + "...");

    console.log("🔵 [LOGIN] Calling setTokenCookies...");
    setTokenCookies(res, accessToken, refreshToken);
    console.log("🟢 [LOGIN] setTokenCookies called");
    console.log(
      "🟢 [LOGIN] Response headers after setTokenCookies:",
      res.getHeaders(),
    );

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    console.log("🟢 [LOGIN] Refresh token saved to DB");

    await createAuditLog({
      actorId: user.id,
      action: "LOGIN",
      module: "Auth",
      recordId: user.id,
      req,
    });
    console.log("🟢 [LOGIN] Audit log created");

    const { passwordHash, ...safeUser } = user;

    console.log("🟢 [LOGIN] Sending 200 response");
    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: safeUser,
    });
  } catch (error) {
    console.error("🔴 [LOGIN] Error:", error);
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
      where: { id: decoded.id },
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

    // const payload: JWTPayLoad = {
    //   id: user.id,
    //   email: user.email,
    //   roleId: user.roleId,
    //   role: {
    //     name: user.role.name,
    //     permissions: user.role.permissions,
    //   },
    // };

    // const payload: JWTPayLoad = {
    //   ...user,
    //   role: {
    //     name: user.role.name,
    //     permissions: user.role.permissions,
    //   },
    // };

    // Rotate — delete old refresh token, issue new pair
    await prisma.refreshToken.delete({ where: { token: refreshToken } });

    const payload: any = {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      isSuperAdmin: user.isSuperAdmin,
      isActive: user.isActive,
    };

    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    setTokenCookies(res, newAccessToken, newRefreshToken);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Return same user shape as login
    const { passwordHash, ...safeUser } = user;

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
    const userId = req.user.id;

    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    await createAuditLog({
      actorId: userId,
      action: "LOGOUT",
      module: "Auth",
      recordId: userId,
      req,
    });

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

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

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Prevent email enumeration
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists, a password reset link has been sent.",
      });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        resetPasswordToken: token,
        resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false, // use true if port is 465
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: "Reset Password",
      html: `
        <h2>Password Reset</h2>

        <p>You requested a password reset.</p>

        <p>
          Click below to reset your password:
        </p>

        <a href="${resetUrl}">
          Reset Password
        </a>

        <p>
          This link expires in 15 minutes.
        </p>
      `,
    });

    return res.status(200).json({
      success: true,
      message: "If an account exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
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
