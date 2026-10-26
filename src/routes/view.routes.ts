// File: view.routes.ts
// Path: src/routes/view.routes.ts
//
// Personal data — no permission key, ownership is checked in the controller.

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate, idParams } from "@/validators/validator";
import { createViewBody, listViewsQuery, updateViewBody } from "@/validators/view.validators";
import { listViews, createView, updateView, deleteView } from "@/controller/view.controller";

const router = Router();

router.use(authenticateUser);

router.get("/", validate.query(listViewsQuery), listViews);
router.post("/", validate.body(createViewBody), createView);
router.patch("/:id", validate.request({ params: idParams, body: updateViewBody }), updateView);
router.delete("/:id", validate.params(idParams), deleteView);

export default router;
