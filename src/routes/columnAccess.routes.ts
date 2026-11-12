// File: columnAccess.routes.ts
// Path: src/routes/columnAccess.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { getColumnAccess, getMyHiddenColumns, saveColumnAccess } from "@/controller/columnAccess.controller";

const router = Router();

router.use(authenticateUser);

router.get("/:table/mine", getMyHiddenColumns);
router.get("/:table", authorize("roles.read"), getColumnAccess);
router.put("/:table/:roleId", authorize("roles.assign_permissions"), saveColumnAccess);

export default router;
