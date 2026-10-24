// File: role.routes.ts
// Path: src/routes/role.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  createRoleBody,
  updateRoleBody,
  roleIdParams,
  saveGrantsBody,
} from "@/validators/role.validator";
import {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from "@/controller/role.controller";
import { getRoleGrants, saveRoleGrants } from "@/controller/permission.controller";

const router = Router();
const manage = authorize("admin.manage_roles");

router.use(authenticateUser);

router.get("/", listRoles);
router.post("/", manage, validate.body(createRoleBody), createRole);

router.get("/:id", manage, validate.params(idParams), getRoleById);
router.put("/:id", manage, validate.request({ params: idParams, body: updateRoleBody }), updateRole);
router.delete("/:id", manage, validate.params(idParams), deleteRole);

router.get("/:roleId/permissions", manage, validate.params(roleIdParams), getRoleGrants);
router.put(
  "/:roleId/permissions",
  manage,
  validate.request({ params: roleIdParams, body: saveGrantsBody }),
  saveRoleGrants,
);

export default router;
