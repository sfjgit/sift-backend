// routes/user.routes.ts
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
} from "@/controller/user.controller";
import prisma from "@/utils/prisma/client";
import { decrypt, encrypt } from "@/utils/crypto";

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("users"));

router.get("/", validate.query(listUsersQuery), listUsers);

// GET /core/api/user/app-credentials/:appName
// Extension calls: /core/api/user/app-credentials/NAUKRI
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

// POST /core/api/user/app-credentials
// { appName: 'NAUKRI', email: '...', password: '...', metadata: {} }
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
router.get("/subordinates", authenticateUser, getMySubordinates);
router.get("/:id", validate.params(userIdParams), getUserById);
router.get("/:id/tree", validate.params(userIdParams), getUserTree);
router.get("/:id/card", authenticateUser, getUserCard);

router.post(
  "/",
  checkPermission("canAdd"),
  validate.body(createUserBody),
  createUser
);
router.put(
  "/:id",
  checkPermission("canEdit"),
  validate.request({ params: userIdParams, body: updateUserBody }),
  updateUser
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
