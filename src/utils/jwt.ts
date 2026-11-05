import { config } from "dotenv";
import jwt from "jsonwebtoken";

config();

// Only the id goes in the token — role, permissions, isActive are read fresh
// from the DB on every request.
export interface JWTPayLoad {
  id: string;
  /** "platform" = enterprise console session; the CRM refuses these */
  scope?: "platform";
}

// enterprise console: one token, no refresh — sign in again after 12h
export const generatePlatformToken = (id: string) =>
  jwt.sign({ id, scope: "platform" }, process.env.JWT_SECRET as string, { expiresIn: "12h" });

export const generateAccessToken = (payload: JWTPayLoad) => {
  return jwt.sign({ id: payload.id }, process.env.JWT_SECRET as string, {
    expiresIn: "8h",
  });
};

export const generateRefreshToken = (payload: JWTPayLoad) => {
  return jwt.sign({ id: payload.id }, process.env.JWT_SECRET as string, {
    expiresIn: "9h",
  });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayLoad;
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayLoad;
};
