// File: auth.routes.ts
// Path: src/routes/auth.routes.ts

import { Router } from "express";
import { validate } from "@/validators/validator";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordByTokenSchema,
} from "@/validators/auth.validators";
import {
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  resetPasswordByToken,
} from "@/controller/auth.controller";
import { authenticateUser } from "@/middleware/auth";

const router = Router();

// public
router.post("/login", validate.body(loginSchema), login);
router.post("/refresh", refresh);
router.post("/forgot-password", validate.body(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate.body(resetPasswordByTokenSchema), resetPasswordByToken);

// logged in
router.get("/me", authenticateUser, me);
router.post("/logout", authenticateUser, logout);
router.post(
  "/change-password",
  authenticateUser,
  validate.body(changePasswordSchema),
  changePassword,
);

export default router;
