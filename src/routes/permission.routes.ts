// File: permission.routes.ts
// Path: src/routes/permission.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { getRegistry, getScopes } from "@/controller/permission.controller";

const router = Router();

router.use(authenticateUser);

router.get("/registry", authorize("roles.read"), getRegistry);
router.get("/scopes", authorize("roles.read"), getScopes);

export default router;
