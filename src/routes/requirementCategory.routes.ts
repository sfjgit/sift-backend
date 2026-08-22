// File: requirementCategory.routes.ts
// Path: src/routes/requirementCategory.routes.ts

import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "@/controller/requiremenCategory.controller";
import { authenticateUser } from "@/middleware/auth";
import { Router } from "express";

const router = Router();

router.post("/", authenticateUser, createCategory);
router.get("/", authenticateUser, listCategories);
router.patch("/:id", authenticateUser, updateCategory);
router.delete("/:id", authenticateUser, deleteCategory);

export default router;
