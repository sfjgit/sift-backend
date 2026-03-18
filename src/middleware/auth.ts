import { verifyAccessToken } from "@/utils/jwt";
import prisma from "@/utils/prisma/client";
import { Request, Response, NextFunction } from "express";

// export const authenticateUser=(req: Request, res: Response, next: NextFunction)=>{
//    const userId = req.headers['x-user-id'] as string;
//    const email = req.headers['x-user-email'] as string;
//    const role = req.headers['x-user-role'] as string;
//    if(userId && email && role) {
//     const user={
//         id:userId,
//         email:email,
//         role:role
//     }
//     req.user=user;
//     next();
//     } else {
//         console.log("Unauthorized");
//         return res.status(401).json({ message: "Unauthorized" });
//     }
// }

export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Get access token from cookies or Authorization header
    let accessToken = req.cookies?.accessToken;

    if (!accessToken) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        accessToken = authHeader.substring(7);
      }
    }

    if (!accessToken) {
      res.status(401).json({
        success: false,
        message: "Access token not provided",
        code: "NO_TOKEN",
      });
      return;
    }

    // Verify access token
    const decoded = verifyAccessToken(accessToken);
    console.log(decoded);

    if (!decoded) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
        code: "INVALID_TOKEN",
      });
      return;
    }

    // Check if user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
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

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during authentication",
    });
    return;
  }
};

export const setTokenCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
) => {
  const isProduction = process.env.NODE_ENV === "production";

  // Set access token cookie (shorter expiry)
  res.cookie("accessToken", accessToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: "none",
    maxAge: 2 * 60 * 1000, // 15 minutes
    path: "/",
  });

  // Set refresh token cookie (longer expiry)
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
};
