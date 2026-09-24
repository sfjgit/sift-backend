// File: portalRecruit.routes.ts
// Path: src/routes/portalRecruit.routes.ts

import { Router } from "express";
import {
  logPortalRecruit,
  getPortalRecruitStatus,
} from "@/controller/portalRecruit.controller";

const router = Router();

router.post("/log", logPortalRecruit);
router.get("/status", getPortalRecruitStatus);

export default router;
