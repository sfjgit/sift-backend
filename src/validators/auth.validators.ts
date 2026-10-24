import { z } from "zod";

const password = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" });

export const loginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
});

export const resetPasswordByTokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: password,
});

export type LoginSchema = z.infer<typeof loginSchema>;
