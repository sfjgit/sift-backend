import { NextFunction, Request, Response } from "express";

// export const authorize = (module: string, action: string) => {
//   return (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const user = req.user;

//       const permissions = user.role?.permissions;

//       if (!permissions || permissions.length === 0) {
//         return res.status(403).json({
//           success: false,
//           message: "No permissions assigned",
//         });
//       }

//       // Find module permission
//       const modulePermission = permissions.find(
//         (perm: any) => perm.module === module,
//       );

//       if (!modulePermission) {
//         return res.status(403).json({
//           success: false,
//           message: `No access to ${module}`,
//         });
//       }

//       // Check action (canView / canAdd / canEdit / canDelete)
//       if (!modulePermission[action]) {
//         return res.status(403).json({
//           success: false,
//           message: `You don't have permission to ${action} on ${module}`,
//         });
//       }

//       next();
//     } catch (error) {
//       console.error("Authorization error:", error);
//       return res.status(500).json({
//         success: false,
//         message: "Internal server error",
//       });
//     }
//   };
// };

export const authorize = (module: string, action: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      const permissions = user.role?.permissions;

      if (!permissions || permissions.length === 0) {
        return res
          .status(403)
          .json({ success: false, message: "No permissions assigned" });
      }

      const modulePermission = permissions.find(
        (perm: any) => perm.module === module,
      );

      if (!modulePermission) {
        return res
          .status(403)
          .json({ success: false, message: `No access to ${module}` });
      }

      if (!modulePermission[action]) {
        return res.status(403).json({
          success: false,
          message: `You don't have permission to ${action} on ${module}`,
        });
      }

      // attach scope so controller can use it
      req.permissionScope = modulePermission.scope; // OWN | TEAM | MANAGER | BU | ALL

      next();
    } catch (error) {
      console.error("Authorization error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  };
};
