import { config } from "dotenv";
import jwt from "jsonwebtoken";
// export interface JWTPayLoad {
//   userId: string;
//   email: string;
//   roleId: string;
//   role: {
//     name: string;
//     permissions: string[];
//   };
// }

config();
export interface JWTPayLoad {
  id: string;
  email: string;
  roleId: string;
  role: {
    name: string;
    permissions: {
      module: string;
      canView: boolean;
      canAdd: boolean;
      canEdit: boolean;
      canDelete: boolean;
      scope: string;
    }[];
  };
}

export const generateAccessToken = (payload: JWTPayLoad) => {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "30m",
  });
};

export const generateRefreshToken = (payload: JWTPayLoad) => {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "8h",
  });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayLoad;
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayLoad;
};
