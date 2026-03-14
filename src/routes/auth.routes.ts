import { getUserCredentialsSchema, loginSchema, refreshSchema, registerSchema, resetPasswordBodySchema, resetPasswordParamsSchema } from "@/validators/auth.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";
import { getUserCredentials, login, logout, refresh, register, resetPassword } from "../controller/auth.controller";
import { authorize } from "@/middleware/role";
import { authenticateUser } from "@/middleware/auth";

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Create new new
 * @access  Super Admin
 */
router.post(
    '/register',
    authenticateUser,
    authorize('SUPER_ADMIN'),
    validate.body(registerSchema),
    register
)


/**
 * @route   POST /api/auth/login
 * @desc    Login
 * @access  Public
 */
router.post(
    '/login',
    validate.body(loginSchema),
    login
)


/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh
 * @access  Public
 */
router.post(
    '/refresh',
    validate.body(refreshSchema),
    refresh
)


/**
 * @route   DELETE /api/auth/logout
 * @desc    Logout
 * @access  Public
 */
router.delete(
    '/logout',
    validate.body(refreshSchema),
    logout
)

/**
 * @route   PATCH /api/auth/reset-password/:userId
 * @desc    Reset password
 * @access  Super Admin
 */
router.patch(
    '/reset-password/:userId',
    authenticateUser,
    authorize('SUPER_ADMIN'),
    validate.params(resetPasswordParamsSchema),
    validate.body(resetPasswordBodySchema),
    resetPassword
)


/**
 * @route   POST /api/auth/user-credentials/:userId
 * @desc    Get user credentials
 * @access  Super Admin
 */
router.get(
    '/user-credentials/:userId',
    authenticateUser,
    authorize('SUPER_ADMIN'),
    validate.params(getUserCredentialsSchema),
    getUserCredentials
)

export default router;