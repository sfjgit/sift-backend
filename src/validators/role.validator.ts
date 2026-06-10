// File: role.validator.ts
// Path: src/validators/role.validator.ts

import { z } from "zod";
import { PermissionScope } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE — pulled directly from Prisma enum so it's always in sync with schema
// Adding a new scope to schema.prisma + running prisma generate is all needed
// ─────────────────────────────────────────────────────────────────────────────

const permissionScopeValues = Object.values(PermissionScope) as [
  string,
  ...string[]
];
const permissionScope = z.enum(permissionScopeValues);

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION ROW — one per module, each action has its own scope
// ─────────────────────────────────────────────────────────────────────────────

export const permissionRowSchema = z.object({
  module: z.string().min(1, "Module is required"),
  canView: z.boolean().default(false),
  canAdd: z.boolean().default(false),
  canEdit: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  canViewScope: permissionScope.default("OWN"),
  canAddScope: permissionScope.default("OWN"),
  canEditScope: permissionScope.default("OWN"),
  canDeleteScope: permissionScope.default("OWN"),
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE ROLE
// ─────────────────────────────────────────────────────────────────────────────

export const createRoleBody = z.object({
  name: z.string().min(1, "Role name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  permissions: z
    .array(permissionRowSchema)
    .min(1, "At least one permission is required"),
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE ROLE
// ─────────────────────────────────────────────────────────────────────────────

export const updateRoleBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  permissions: z.array(permissionRowSchema).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// PARAMS
// ─────────────────────────────────────────────────────────────────────────────

export const roleIdParams = z.object({
  id: z.string().min(1, "Role ID is required"),
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CreateRoleInput = z.infer<typeof createRoleBody>;
export type UpdateRoleInput = z.infer<typeof updateRoleBody>;
export type PermissionRowInput = z.infer<typeof permissionRowSchema>;
