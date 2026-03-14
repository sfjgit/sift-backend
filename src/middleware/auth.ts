import { Request, Response, NextFunction } from "express";

export const authenticateUser=(req: Request, res: Response, next: NextFunction)=>{
   const userId = req.headers['x-user-id'] as string;
   const email = req.headers['x-user-email'] as string;
   const role = req.headers['x-user-role'] as string;
   if(userId && email && role) {
    const user={
        id:userId,
        email:email,
        role:role
    }
    req.user=user;
    next();
    } else {
        console.log("Unauthorized");
        return res.status(401).json({ message: "Unauthorized" });
    }
}
