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
} from "@/controller/user.controller";
import prisma from "@/utils/prisma/client";
import { decrypt, encrypt } from "@/utils/crypto";

const router = Router();

// authenticateUser + scopeFilter applied to all routes in this router
router.use(authenticateUser);
router.use(scopeFilter("users"));

// ── Static routes MUST come before /:id to avoid param shadowing ──────────

router.get("/", validate.query(listUsersQuery), listUsers);

router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createUserBody),
  createUser
);

// GET /users/subordinates — returns direct reports + team members of the caller
// Must be declared before /:id or Express will match "subordinates" as the id param
router.get("/subordinates", getMySubordinates);

// ── App credentials (no :id prefix — static segment) ────────────────────────

// GET /users/app-credentials — list all saved credentials for the caller (no passwords)
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

// GET /users/app-credentials/:appName — fetch decrypted credential for one app
// e.g. GET /users/app-credentials/NAUKRI
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

// POST /users/app-credentials — upsert credential for an app
router.post("/app-credentials", async (req, res) => {
  const { appName, email, password, metadata } = req.body;

  await prisma.userAppCredential.upsert({
    where: {
      userId_appName: {
        userId: req.user!.id,
        appName: appName.toUpperCase(),
      },
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

// ── Param routes (:id) ───────────────────────────────────────────────────────

router.get("/:id", validate.params(userIdParams), getUserById);
router.get("/:id/tree", validate.params(userIdParams), getUserTree);
router.get("/:id/card", validate.params(userIdParams), getUserCard);

router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: updateUserBody }),
  updateUser
);

// PATCH /users/:id/reset-password

router.patch(
  "/:id/reset-password",
  checkPermission("canEdit"),
  // validate.request({ params: userIdParams, body: resetPasswordBody }),
  adminResetPassword
);

router.patch(
  "/:id/toggle",
  checkPermission("canEdit"),
  validate.params(userIdParams),
  toggleUser
);

router.patch(
  "/:id/reporting",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignReportingBody }),
  assignReporting
);

router.patch(
  "/:id/teamlead",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignTeamLeadBody }),
  assignTeamLead
);

router.patch(
  "/:id/department",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignDepartmentBody }),
  assignDepartment
);

router.patch(
  "/:id/role",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: assignRoleBody }),
  assignRole
);

export default router;
