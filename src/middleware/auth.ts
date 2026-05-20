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

// middleware/auth.ts

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

    const decoded = verifyAccessToken(accessToken);

    if (!decoded) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
        code: "INVALID_TOKEN",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        role: {
          include: { permissions: true },
        },
      },
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
    console.error("Authentication error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during authentication",
    });
  }
};

export const setTokenCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string
) => {
  const isProduction = process.env.NODE_ENV === "production";

  const base = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    path: "/",
  };

  res.cookie("accessToken", accessToken, {
    ...base,
    httpOnly: false,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    ...base,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

// export const setTokenCookies = (
//   res: Response,
//   accessToken: string,
//   refreshToken: string
// ) => {
//   const isProduction = process.env.NODE_ENV === "production";

//   const base = {
//     httpOnly: true,
//     secure: isProduction,
//     sameSite: "lax" as const, // ✅ lax works now — requests are same-origin via proxy
//     path: "/",
//   };

//   res.cookie("accessToken", accessToken, {
//     ...base,
//     httpOnly: false,
//     maxAge: 15 * 60 * 1000,
//   });

//   res.cookie("refreshToken", refreshToken, {
//     ...base,
//     httpOnly: true,
//     maxAge: 7 * 24 * 60 * 60 * 1000,
//   });
// };

// export const setTokenCookies = (
//   res: Response,
//   accessToken: string,
//   refreshToken: string,
//   req: Request // pass req in so we can inspect the origin
// ) => {
//   const origin = req.headers.origin || req.headers.referer || "";

//   // Cross-origin = request came from a different host than the API
//   // "none" + secure is ONLY safe when the client is actually on HTTPS
//   const isCrossOrigin = origin !== "" && !origin.startsWith("http://localhost");
//   const isOriginSecure = origin.startsWith("https://");

//   const useSameNone = isCrossOrigin && isOriginSecure;

//   const base = {
//     httpOnly: true,
//     secure: useSameNone, // true only when the client is on https
//     sameSite: (useSameNone ? "none" : "lax") as "none" | "lax",
//     path: "/",
//   };

//   res.cookie("accessToken", accessToken, {
//     ...base,
//     httpOnly: false,
//     maxAge: 15 * 60 * 1000,
//   });

//   res.cookie("refreshToken", refreshToken, {
//     ...base,
//     httpOnly: true,
//     maxAge: 7 * 24 * 60 * 60 * 1000,
//   });
// };

// export const setTokenCookies = (
//   res: Response,
//   accessToken: string,
//   refreshToken: string,
// ) => {
//   const isProduction = process.env.NODE_ENV === "production";

//   const base = {
//     httpOnly: true,
//     secure: isProduction,
//     // "none" REQUIRES secure:true — browsers silently drop the cookie otherwise.
//     // In dev (same machine, localhost) "lax" works fine and doesn't need https.
//     sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
//     path: "/",
//   };

//   res.cookie("accessToken", accessToken, {
//     ...base,
//     httpOnly: false, // needs to be readable by JS for axios interceptors
//     // maxAge: 15 * 60 * 1000,
//     maxAge: 1 * 60 * 1000, // 1 min
//   });

//   res.cookie("refreshToken", refreshToken, {
//     ...base,
//     httpOnly: true, // never readable by JS
//     maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
//   });
// };
