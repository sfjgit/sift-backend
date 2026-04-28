import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import {
  createUserBody,
  updateUserBody,
  deactivateUserBody,
  userIdParams,
  listUsersQuery,
} from "@/validators/user.validators";
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  getUserFormData,
  searchUsers,
} from "@/controller/user.controller";
import { validate } from "@/validators/validator";

const router = Router();

// All routes: auth → scope → permission check → validate → controller
router.use(authenticateUser);
router.use(scopeFilter("users"));

// ── Utility — before /:id ────────────────────────────────────────────────────
router.get("/form-data", getUserFormData);
router.get("/search", searchUsers);

// ── List ─────────────────────────────────────────────────────────────────────
router.get("/", validate.query(listUsersQuery), listUsers);

// ── Create ───────────────────────────────────────────────────────────────────
router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createUserBody),
  createUser
);

// ── Get by ID ────────────────────────────────────────────────────────────────
router.get("/:id", validate.params(userIdParams), getUserById);

// ── Update ───────────────────────────────────────────────────────────────────
router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: updateUserBody }),
  updateUser
);

// ── Deactivate ───────────────────────────────────────────────────────────────
router.put(
  "/:id/deactivate",
  checkPermission("canDelete"),
  validate.request({ params: userIdParams, body: deactivateUserBody }),
  deactivateUser
);

// ── Reactivate ───────────────────────────────────────────────────────────────
router.put(
  "/:id/reactivate",
  checkPermission("canDelete"),
  validate.params(userIdParams),
  reactivateUser
);

export default router;
