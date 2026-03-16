import { NextFunction, Request, Response } from "express";

// export const authorize=(...allowedRoles:string[])=>{
//     return (req: Request, res: Response, next: NextFunction) => {
//        if (!req.user || !allowedRoles.includes(req.user.role)) {
//           return res.status(403).json({
//             success: false,
//             message: "Insufficient permissions",
//       });
//     }
//         next();
//       };
// }

export const authorize=(...allowedRoles:any)=>{
    return (req: Request, res: Response, next: NextFunction) => {

       console.log("User role:", req.user?.role);
       console.log("Allowed roles:", allowedRoles);

       if (!req.user || !allowedRoles.includes(req.user.role)) {
          return res.status(403).json({
            success: false,
            message: "Insufficient permissions",
          });
       }

       next();
    };
}