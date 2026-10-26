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
  userOptionsQuery,
} from "@/validators/user.validators";
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUser,
  adminResetPassword,
  listUserOptions,
} from "@/controller/user.controller";

const router = Router();
const read = authorize("users.read");

router.use(authenticateUser);

router.get("/", read, validate.query(listUsersQuery), listUsers);
router.post("/", authorize("users.create"), validate.body(createUserBody), createUser);

// picker — any logged-in user; scope resolved in the controller. Before /:id.
router.get("/options", validate.query(userOptionsQuery), listUserOptions);

router.get("/:id", read, validate.params(idParams), getUserById);
router.put("/:id", authorize("users.update"), validate.request({ params: idParams, body: updateUserBody }), updateUser);
router.patch("/:id/toggle", authorize("users.deactivate"), validate.params(idParams), toggleUser);
router.patch(
  "/:id/reset-password",
  authorize("users.reset_password"),
  validate.request({ params: idParams, body: adminResetPasswordBody }),
  adminResetPassword,
);

export default router;
