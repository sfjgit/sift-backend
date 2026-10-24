import { config } from "dotenv";
import jwt from "jsonwebtoken";

config();

// Only the id goes in the token — role, permissions, isActive are read fresh
// from the DB on every request.
export interface JWTPayLoad {
  id: string;
}

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
