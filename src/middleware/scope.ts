// import { Request, Response, NextFunction } from "express";

// export const applyScope = (module: string) => {
//   return async (req: Request, res: Response, next: NextFunction) => {
//     const user = req.user!;
//     const scope = req.permissionScope;

//     let whereCondition: any = {};

//     if (scope === "OWN") {
//       whereCondition.id = user.id;
//     }

//     if (scope === "BU") {
//       whereCondition.businessUnitId = user.businessUnitId;
//     }

//     if (scope === "TEAM") {
//       whereCondition.reportingToId = user.id;
//     }

//     req.scopeFilter = whereCondition;

//     next();
//   };
// };
