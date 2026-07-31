import {
  getUserCredentialsSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordBodySchema,
  resetPasswordParamsSchema,
} from "@/validators/auth.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";
import {
  forgotPassword,
  getUserCredentials,
  login,
  logout,
  refresh,
  register,
  resetPassword,
  resetPasswordByToken,
  revealPassword,
} from "../controller/auth.controller";
import { authorize } from "@/middleware/role";
import { authenticateUser } from "@/middleware/auth";

const router = Router();

// File: auth.routes.ts
// Path: src/routes/auth.routes.ts

router.get(
  "/reveal-password/:userId",
  authenticateUser,
  validate.params(getUserCredentialsSchema),
  revealPassword
);
/**
 * @route   POST /api/auth/register
 * @desc    Create new new
 * @access  Super Admin
 */
router.post(
  "/register",
  authenticateUser,
  // authorize('SUPER_ADMIN'),
  validate.body(registerSchema),
  register
);
// router.use("/", (_req, res) => {
//   console.log("Root route accessed");
//   // res.json({
//   //   success: true,
//   //   message: "Auth server is running",
//   //   timestamp: new Date().toISOString(),
//   // });
// });

/**
 * @route   POST /api/auth/login
 * @desc    Login
 * @access  Public
 */
router.post("/login", validate.body(loginSchema), login);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh
 * @access  Public
 */
router.post("/refresh", refresh);

/**
 * @route   DELETE /api/auth/logout
 * @desc    Logout
 * @access  Public
 */
router.post("/logout", authenticateUser, logout);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Forgot password
 * @access
 */
router.post("/forgot-password", forgotPassword);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password
 * @access  Public
 */
router.post("/reset-password", resetPasswordByToken);

/**
 * @route   PATCH /api/auth/reset-password/:userId
 * @desc    Reset password
 * @access  Super Admin
 */
router.patch(
  "/reset-password/:userId",
  authenticateUser,
  // authorize("SUPER_ADMIN"),
  validate.params(resetPasswordParamsSchema),
  validate.body(resetPasswordBodySchema),
  resetPassword
);

/**
 * @route   POST /api/auth/user-credentials/:userId
 * @desc    Get user credentials
 * @access  Super Admin
 */
router.get(
  "/user-credentials/:userId",
  authenticateUser,
  // authorize("SUPER_ADMIN"),
  validate.params(getUserCredentialsSchema),
  getUserCredentials
);

export default router;
