// File: user.routes.ts
// Path: src/routes/user.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  adminResetPasswordBody,
  createUserBody,
  listUsersQuery,
  updateUserBody,
} from "@/validators/user.validators";
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUser,
  adminResetPassword,
} from "@/controller/user.controller";

const router = Router();
const read = authorize("users.read");
const manage = authorize("admin.manage_users");

router.use(authenticateUser);

router.get("/", read, validate.query(listUsersQuery), listUsers);
router.post("/", manage, validate.body(createUserBody), createUser);

router.get("/:id", read, validate.params(idParams), getUserById);
router.put("/:id", manage, validate.request({ params: idParams, body: updateUserBody }), updateUser);
router.patch("/:id/toggle", manage, validate.params(idParams), toggleUser);
router.patch(
  "/:id/reset-password",
  manage,
  validate.request({ params: idParams, body: adminResetPasswordBody }),
  adminResetPassword,
);

export default router;
