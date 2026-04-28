import { z } from "zod";

// ─────────────────────────────────────────
// PERMISSION ROW — one per module
// ─────────────────────────────────────────

export const permissionRowSchema = z.object({
  module: z.string().min(1, "Module is required"),
  canView: z.boolean().default(false),
  canAdd: z.boolean().default(false),
  canEdit: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  scope: z.enum(["OWN", "TEAM", "MANAGER", "BU", "ALL"]).default("OWN"),
});

// ─────────────────────────────────────────
// CREATE ROLE
// ─────────────────────────────────────────

export const createRoleBody = z.object({
  name: z.string().min(1, "Role name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  permissions: z
    .array(permissionRowSchema)
    .min(1, "At least one permission is required"),
});

// ─────────────────────────────────────────
// UPDATE ROLE
// ─────────────────────────────────────────

export const updateRoleBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  permissions: z.array(permissionRowSchema).optional(),
});

// ─────────────────────────────────────────
// PARAMS
// ─────────────────────────────────────────

export const roleIdParams = z.object({
  id: z.string().min(1, "Role ID is required"),
});

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

export type CreateRoleInput = z.infer<typeof createRoleBody>;
export type UpdateRoleInput = z.infer<typeof updateRoleBody>;
export type PermissionRowInput = z.infer<typeof permissionRowSchema>;
