import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
// import { validate } from "@/middleware/validate";
import {
  createRoleBody,
  updateRoleBody,
  roleIdParams,
} from "@/validators/role.validator";
import {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getModules,
  getScopes,
} from "@/controller/role.controller";
import { validate } from "@/validators/validator";

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("roles")); // roles live under settings module

// ── Utility — before /:id ────────────────────────────────────────────────────
router.get("/modules", getModules);
router.get("/scopes", getScopes); // ← NEW: returns all PermissionScope enum values
// ── List ─────────────────────────────────────────────────────────────────────
router.get("/", listRoles);

// ── Create ───────────────────────────────────────────────────────────────────
router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createRoleBody),
  createRole
);

// ── Get by ID ────────────────────────────────────────────────────────────────
router.get("/:id", validate.params(roleIdParams), getRoleById);

// ── Update ───────────────────────────────────────────────────────────────────
router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: roleIdParams, body: updateRoleBody }),
  updateRole
);

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  checkPermission("canDelete"),
  validate.params(roleIdParams),
  deleteRole
);

export default router;
