import {z} from "zod";

export const registerSchema = z.object({
    email: z.string().email().min(5),
    passwordHash: z.string().min(8),
    passwordPlain: z.string().optional(),
    roleId: z.string().uuid(),
    firstName: z.string().min(2, {message: "First name must be at least 2 characters long"}),
    lastName: z.string().min(1, {message: "Last name must be at least 1 characters long"}),
    middleName: z.string().optional(),
    nickName: z.string().optional(),
    displayName: z.string().trim().optional(),
    employeeId: z.string().optional(),
    phone: z.string().optional(),
    workingLocation: z.string().optional(),
    timezone: z.string().optional(),
    dateOfBirth: z.string().datetime().optional(),
    dateOfJoin: z.string().datetime().optional(),
    reportingToId: z.string().uuid().optional(),
    businessUnitId: z.string().uuid().optional(),
})

export const loginSchema = z.object({
    email: z.string().email().min(5),
    password: z.string().min(8),
})

export const refreshSchema = z.object({
    refreshToken: z.string().min(1,"Refresh token is required"),
})

export const resetPasswordParamsSchema = z.object({
    userId: z.string().uuid(),
})

export const resetPasswordBodySchema = z.object({
    password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
});

export const getUserCredentialsSchema = z.object({
    userId: z.string().uuid(),
})

export type RegisterSchema = z.infer<typeof registerSchema>
export type LoginSchema = z.infer<typeof loginSchema>
export type RefreshSchema = z.infer<typeof refreshSchema>