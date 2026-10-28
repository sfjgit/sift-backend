// File: me.routes.ts
// Path: src/routes/me.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { getMyPermissions } from "@/controller/permission.controller";
import { getMyRunSlots } from "@/controller/runQuota.controller";
import { validate } from "@/validators/validator";
import { mySlotsQuery } from "@/validators/runQuota.validators";

const router = Router();

router.use(authenticateUser);

// logged-in user's map — frontend uses it to show/hide UI
router.get("/permissions", getMyPermissions);
// pipeline run slots left this day / week / month
router.get("/run-slots", validate.query(mySlotsQuery), getMyRunSlots);

export default router;
