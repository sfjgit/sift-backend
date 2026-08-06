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

// ─── Authenticate User ────────────────────────────────────────────────────────
// JWT contains only { id } — everything else fetched fresh from DB every request
// This guarantees permissions, role, isActive are always current
export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
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

    // ─── JWT verification is isolated: its failures are 401s, never 500s ───
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
      throw err; // anything else is genuinely unexpected → 500 below
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
      include: { role: { include: { permissions: true } } },
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

    req.user = user as any;
    next();
  } catch (error) {
    console.error("authenticateUser:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during authentication",
      code: "AUTH_INTERNAL_ERROR",
    });
  }
};
// export const authenticateUser = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     const accessToken =
//       req.cookies?.accessToken ||
//       req.headers.authorization?.replace("Bearer ", "").trim();

//     if (!accessToken) {
//       res.status(401).json({
//         success: false,
//         message: "Access token not provided",
//         code: "NO_TOKEN",
//       });
//       return;
//     }

//     const decoded = verifyAccessToken(accessToken);
//     if (!decoded?.id) {
//       res.status(401).json({
//         success: false,
//         message: "Invalid or expired access token",
//         code: "INVALID_TOKEN",
//       });
//       return;
//     }

//     // ✅ always fetch from DB — decoded only used for id lookup
//     const user = await prisma.user.findUnique({
//       where: { id: decoded.id },
//       include: {
//         role: { include: { permissions: true } },
//       },
//     });

//     if (!user) {
//       res.status(401).json({
//         success: false,
//         message: "User not found",
//         code: "USER_NOT_FOUND",
//       });
//       return;
//     }

//     if (!user.isActive) {
//       res.status(403).json({
//         success: false,
//         message: "Account is deactivated",
//         code: "ACCOUNT_DEACTIVATED",
//       });
//       return;
//     }

//     req.user = user as any;
//     next();
//   } catch (error) {
//     console.error("Authentication error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error during authentication",
//     });
//   }
// };

// ─── Set Token Cookies ────────────────────────────────────────────────────────
// secure: true + sameSite: none — required for cross-origin (frontend ≠ backend domain)

export const setTokenCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string
) => {
  const isProd = process.env.NODE_ENV === "production"; // ← add this
  const base = {
    secure: isProd, // ← was: true
    sameSite: isProd ? ("none" as const) : ("lax" as const), // ← was: "none"
    path: "/",
  };

  res.cookie("accessToken", accessToken, {
    ...base,
    httpOnly: false,
    maxAge: 8 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    ...base,
    httpOnly: true,
    maxAge: 18 * 60 * 60 * 1000,
  });
};

// export const setTokenCookies = (
//   res: Response,
//   accessToken: string,
//   refreshToken: string
// ) => {
//   // const base = {
//   //   secure: true,
//   //   sameSite: "none" as const,
//   //   path: "/",
//   // };

//   // auth.ts
//   const isProd = process.env.NODE_ENV === "production";
//   const base = {
//     secure: isProd,
//     sameSite: isProd ? ("none" as const) : ("lax" as const),
//     path: "/",
//   };

//   res.cookie("accessToken", accessToken, {
//     ...base,
//     httpOnly: false, // readable by JS for axios interceptors
//     maxAge: 15 * 60 * 1000, // 15 mins
//   });

//   res.cookie("refreshToken", refreshToken, {
//     ...base,
//     httpOnly: true, // never readable by JS
//     maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
//   });
// };
