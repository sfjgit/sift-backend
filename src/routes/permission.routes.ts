// File: permission.routes.ts
// Path: src/routes/permission.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { getRegistry, getScopes } from "@/controller/permission.controller";

const router = Router();

router.use(authenticateUser);

router.get("/registry", authorize("admin.manage_roles"), getRegistry);
router.get("/scopes", authorize("admin.manage_roles"), getScopes);

export default router;
