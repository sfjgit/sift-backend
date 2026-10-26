// File: grant.service.ts
// Path: src/services/grant.service.ts
//
// For endpoints that need "any one of" several permissions (reports, search,
// user pickers). authorize() checks a single key, so these resolve grants
// themselves from the map.

import { PermissionScope } from "@prisma/client";
import type { PermissionKey } from "@/config/permissions.registry";
import type { PermissionMap } from "@/services/permission.service";
import { ApiError } from "@/utils/httpError";

// scope of the grant, null = not granted. Unscoped actions count as ALL.
export const grantScope = (map: PermissionMap, key: PermissionKey): PermissionScope | null => {
  const grant = map[key];
  if (!grant) return null;
  return grant === true ? "ALL" : grant;
};

// same 403 shape as authorize()
export const forbidden = (keys: PermissionKey[]) =>
  ApiError(403, `Missing permission: ${keys.join(" or ")}`, "FORBIDDEN");
