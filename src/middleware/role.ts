import { NextFunction, Request, Response } from "express";

export const authorize=(...allowedRoles:string[])=>{
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.user?.role !== allowedRoles) {
          return res.status(403).json({ message: "Unauthorized" });
        }
        next();
      };
}