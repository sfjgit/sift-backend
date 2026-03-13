import jwt from "jsonwebtoken";
export interface JWTPayLoad {
    userId: string;
    email: string;
    roleId: string;
}
export const generateAccessToken = (payload: JWTPayLoad) => {
    return jwt.sign(payload, process.env.JWT_SECRET as string, {
        expiresIn: "1h",
    });
};

export const generateRefreshToken = (payload: JWTPayLoad) => {
    return jwt.sign(payload, process.env.JWT_SECRET as string, {
        expiresIn: "7d",
    });
};

export const verifyAccessToken = (token: string) => {
    return jwt.verify(token, process.env.JWT_SECRET as string);
}