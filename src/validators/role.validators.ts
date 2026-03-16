import { set, z } from "zod";

export const createRoleSchema = z.object({
    name: z.string().min(2, {message: "Name must be at least 2 characters long"}),
    description: z.string().min(2, {message: "Description must be at least 2 characters long"}),
    isSystem: z.boolean().default(false),
});

export const deleteRoleSchema = z.object({
    id: z.string().uuid(),
});

export const rolePermissionsParamsSchema = z.object({
    id: z.string().uuid(),
});

export const rolePermissionsBodySchema = z.array(
    z.object({
    module: z.string(),
    canView: z.boolean(),
    canAdd: z.boolean(),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    })
);
