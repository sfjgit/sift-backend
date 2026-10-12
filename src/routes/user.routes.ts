// File: user.routes.ts
// Path: src/routes/user.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createUserBody,
  updateUserBody,
  userIdParams,
  listUsersQuery,
  assignReportingBody,
  assignTeamLeadBody,
  assignDepartmentBody,
  assignRoleBody,
} from "@/validators/user.validators";
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUser,
  assignReporting,
  assignTeamLead,
  assignDepartment,
  assignRole,
  getUserTree,
  getUserCard,
  getMySubordinates,
  adminResetPassword,
  getHierarchyFilters,
  getUserFilterOptions,
} from "@/controller/user.controller";
import {
  getAssignableTo,
  addAssignableTo,
  removeAssignableTo,
  getAssignableToCandidates,
} from "@/controller/userAssignable.controller";
import prisma from "@/utils/prisma/client";
import { decrypt, encrypt } from "@/utils/crypto";

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("users"));

// ─────────────────────────────────────────────────────────────────────────────
// STATIC ROUTES — must come before /:id to avoid param shadowing
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", validate.query(listUsersQuery), listUsers);

router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createUserBody),
  createUser,
);

router.get("/filter-options", getUserFilterOptions);

// GET /users/subordinates dsdsdsdsdsd
router.get("/subordinates", getMySubordinates);

// ── App credentials ──────────────────────────────────────────────────────────

router.get("/app-credentials", async (req, res) => {
  const records = await prisma.userAppCredential.findMany({
    where: { userId: req.user!.id },
    select: {
      id: true,
      appName: true,
      email: true,
      metadata: true,
      updatedAt: true,
    },
  });
  return res.json({ success: true, data: records });
});

router.get("/app-credentials/:appName", async (req, res) => {
  const record = await prisma.userAppCredential.findUnique({
    where: {
      userId_appName: {
        userId: req.user!.id,
        appName: req.params.appName.toUpperCase(),
      },
    },
  });
  if (!record) {
    return res.status(404).json({
      success: false,
      code: "CREDS_NOT_FOUND",
      message: `${req.params.appName} credentials not configured`,
    });
  }
  return res.json({
    success: true,
    data: {
      email: record.email,
      password: decrypt(record.password),
      metadata: record.metadata,
    },
  });
});

router.post("/app-credentials", async (req, res) => {
  const { appName, email, password, metadata } = req.body;
  await prisma.userAppCredential.upsert({
    where: {
      userId_appName: { userId: req.user!.id, appName: appName.toUpperCase() },
    },
    update: { email, password: encrypt(password), metadata },
    create: {
      userId: req.user!.id,
      appName: appName.toUpperCase(),
      email,
      password: encrypt(password),
      metadata,
    },
  });
  return res.json({ success: true, message: `${appName} credentials saved` });
});

router.get("/hierarchy-filters", getHierarchyFilters);

// ─────────────────────────────────────────────────────────────────────────────
// /:id ROUTES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id", validate.params(userIdParams), getUserById);
router.get("/:id/tree", validate.params(userIdParams), getUserTree);
router.get("/:id/card", validate.params(userIdParams), getUserCard);

router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: updateUserBody }),
  updateUser,
);

router.patch(
  "/:id/reset-password",
  checkPermission("canEdit"),
  adminResetPassword,
);
router.patch(
  "/:id/toggle",
  checkPermission("canEdit"),
  validate.params(userIdParams),
  toggleUser,
);
router.patch(
  "/:id/reporting",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignReportingBody }),
  assignReporting,
);
router.patch(
  "/:id/teamlead",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignTeamLeadBody }),
  assignTeamLead,
);
router.patch(
  "/:id/department",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignDepartmentBody }),
  assignDepartment,
);
router.patch(
  "/:id/role",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignRoleBody }),
  assignRole,
);

// ── Assignable-to (extended DM tagging) ─────────────────────────────────────
// GET    /users/:id/assignable-to                → list current tags
// GET    /users/:id/assignable-to/candidates     → search users to add
// POST   /users/:id/assignable-to                → add tags { targetIds: string[] }
// DELETE /users/:id/assignable-to/:targetId      → remove one tag

router.get("/:id/assignable-to/candidates", getAssignableToCandidates);
router.get("/:id/assignable-to", getAssignableTo);
router.post("/:id/assignable-to", checkPermission("canEdit"), addAssignableTo);
router.delete(
  "/:id/assignable-to/:targetId",
  checkPermission("canEdit"),
  removeAssignableTo,
);

export default router;
