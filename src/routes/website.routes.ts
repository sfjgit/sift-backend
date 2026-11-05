// File: website.routes.ts
// Path: src/routes/website.routes.ts
//
// /website-suggestions — the website check's finds for the signed-in user.

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate, idParams } from "@/validators/validator";
import { dismissWebsiteSuggestion, getWebsiteSuggestion, listMySuggestions, requestAdminUpdate } from "@/controller/website.controller";

const router = Router();
router.use(authenticateUser);
router.get("/mine", listMySuggestions);
router.get("/:id", validate.params(idParams), getWebsiteSuggestion);
router.post("/:id/request-admin", validate.params(idParams), requestAdminUpdate);
router.post("/:id/dismiss", validate.params(idParams), dismissWebsiteSuggestion);

export default router;
