// File: recycle.routes.ts
// Path: src/routes/recycle.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { binCategories, listBin, restoreOneEntry, undoBatch } from "@/controller/recycle.controller";

const router = Router();
router.use(authenticateUser);

router.get("/", authorize("recycle_bin.read"), listBin);
router.get("/categories", authorize("recycle_bin.read"), binCategories);
router.post("/batches/:id/undo", authorize("recycle_bin.restore"), undoBatch);
router.post("/:id/restore", authorize("recycle_bin.restore"), restoreOneEntry);

export default router;
