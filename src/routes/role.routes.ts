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

router.use(authenticateUser);

router.get("/", listRoles);
router.post("/", authorize("roles.create"), validate.body(createRoleBody), createRole);

router.get("/:id", authorize("roles.read"), validate.params(idParams), getRoleById);
router.put("/:id", authorize("roles.update"), validate.request({ params: idParams, body: updateRoleBody }), updateRole);
router.delete("/:id", authorize("roles.delete"), validate.params(idParams), deleteRole);

router.get("/:roleId/permissions", authorize("roles.read"), validate.params(roleIdParams), getRoleGrants);
router.put(
  "/:roleId/permissions",
  authorize("roles.assign_permissions"),
  validate.request({ params: roleIdParams, body: saveGrantsBody }),
  saveRoleGrants,
);

export default router;
