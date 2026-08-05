// File: public.routes.ts
// Path: src/routes/public.routes.ts

import {
  getPublicCategories,
  getPublicRequirementDetail,
  getPublicRequirements,
} from "@/controller/public/publicRequirement.controller";
import { Router } from "express";

const router = Router();

// ⚠️ Intentionally NO authenticateUser, NO scopeFilter — this is public.
router.get("/requirements", getPublicRequirements);
router.get("/requirements/:reqCode", getPublicRequirementDetail);
router.get("/categories", getPublicCategories);

export default router;
