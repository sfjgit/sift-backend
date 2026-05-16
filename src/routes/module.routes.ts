// File: module.routes.ts
// Path: src/routes/module.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createModuleBody,
  updateModuleBody,
  moduleIdParams,
} from "@/validators/module.validator";
import {
  listModules,
  listAllModules,
  getModuleById,
  createModule,
  updateModule,
  toggleModule,
  deleteModule,
} from "@/controller/module.controller";

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("settings")); // modules live under settings

// ── Public read (active only) — used by role permissions matrix ──────────────
router.get("/", listModules);

// ── Admin management — all modules including inactive ────────────────────────
router.get("/all", listAllModules);

// ── Get by ID ────────────────────────────────────────────────────────────────
router.get("/:id", validate.params(moduleIdParams), getModuleById);

// ── Create ───────────────────────────────────────────────────────────────────
router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createModuleBody),
  createModule
);

// ── Update ───────────────────────────────────────────────────────────────────
router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: moduleIdParams, body: updateModuleBody }),
  updateModule
);

// ── Toggle active ─────────────────────────────────────────────────────────────
router.patch(
  "/:id/toggle",
  checkPermission("canEdit"),
  validate.params(moduleIdParams),
  toggleModule
);

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  checkPermission("canDelete"),
  validate.params(moduleIdParams),
  deleteModule
);

export default router;
