// File: express.d.ts
// Path: src/types/express.d.ts

import type { PermissionScope } from "@prisma/client";
import type { PermissionMap } from "../services/permission.service";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  isSuperAdmin: boolean;
  departmentId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser; // set by authenticateUser
      permissions?: PermissionMap; // set by authorize
      scope?: PermissionScope | null; // set by authorize; null = unscoped action
      validatedBody: any;
      validatedQuery: any;
      validatedParams: any;
    }
  }
}
