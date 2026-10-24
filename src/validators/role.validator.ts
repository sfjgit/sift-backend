// File: role.validator.ts
// Path: src/validators/role.validator.ts

import { z } from "zod";
import { PermissionScope } from "@prisma/client";
import { isPermissionKey } from "@/config/permissions.registry";

// one ticked box in the grid; scope is ignored for unscoped actions
export const grantSchema = z.object({
  permissionKey: z
    .string()
    .refine(isPermissionKey, { message: "Unknown permission" }),
  scope: z.nativeEnum(PermissionScope).optional(),
});

export const saveGrantsBody = z.object({
  grants: z.array(grantSchema),
});

export const createRoleBody = z.object({
  name: z.string().trim().min(1, "Role name is required").max(100),
  description: z.string().trim().max(500).nullable().optional(),
  grants: z.array(grantSchema).default([]),
});

export const updateRoleBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const roleIdParams = z.object({
  roleId: z.string().uuid("Invalid role id"),
});

export type GrantInput = z.infer<typeof grantSchema>;
