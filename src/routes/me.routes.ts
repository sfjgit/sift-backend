// File: me.routes.ts
// Path: src/routes/me.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { getMyPermissions } from "@/controller/permission.controller";

const router = Router();

router.use(authenticateUser);

// logged-in user's map — frontend uses it to show/hide UI
router.get("/permissions", getMyPermissions);

export default router;
