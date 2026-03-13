import { getUserCredentialsSchema, loginSchema, refreshSchema, registerSchema, resetPasswordBodySchema, resetPasswordParamsSchema } from "@/validators/auth.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";
import { getUserCredentials, login, logout, refresh, register, resetPassword } from "../controller/auth.controller";
import { authorize } from "@/middleware/role";
import { get } from "node:http";

const router = Router();

router.post(
    '/register',
    validate.body(registerSchema),
    authorize('SUPER_ADMIN'),
    register
)

router.post(
    '/login',
    validate.body(loginSchema),
    login
)

router.post(
    '/refresh',
    validate.body(refreshSchema),
    refresh
)

router.delete(
    '/logout',
    validate.body(refreshSchema),
    logout
)

router.patch(
    '/reset-password/:userId',
    authorize('SUPER_ADMIN'),
    validate.params(resetPasswordParamsSchema),
    validate.body(resetPasswordBodySchema),
    resetPassword
)

router.get(
    '/user-credentials',
    authorize('SUPER_ADMIN'),
    validate.params(getUserCredentialsSchema),
    getUserCredentials
)

export default router;