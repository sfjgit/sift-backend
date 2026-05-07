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

const router = Router();

router.use(authenticateUser);
router.use(scopeFilter("users"));

router.get("/", validate.query(listUsersQuery), listUsers);
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
