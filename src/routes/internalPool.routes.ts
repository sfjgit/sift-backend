// File: internalPool.routes.ts
// Path: src/routes/internalPool.routes.ts

import { Router } from "express";
// import { authenticateUser } from "@/middlewares/auth";
import {
  listSavedSearchesController,
  createSavedSearchController,
  updateSavedSearchController,
  deleteSavedSearchController,
  runSavedSearchController,
  logSearchController,
  sourceCandidateController,
  getActivitySummaryController,
} from "@/controller/internalPool.controller";
import { authenticateUser } from "@/middleware/auth";

const router = Router();

// ── Saved Searches ────────────────────────────────────────────────────────────
router.get("/saved-searches", authenticateUser, listSavedSearchesController);
router.post("/saved-searches", authenticateUser, createSavedSearchController);
router.patch(
  "/saved-searches/:id",
  authenticateUser,
  updateSavedSearchController
);
router.delete(
  "/saved-searches/:id",
  authenticateUser,
  deleteSavedSearchController
);
router.post(
  "/saved-searches/:id/run",
  authenticateUser,
  runSavedSearchController
);

// ── Activity Logging (fire and forget from frontend) ─────────────────────────
router.post("/log/search", authenticateUser, logSearchController);

// ── Source a candidate into a requirement ────────────────────────────────────
router.post("/source", authenticateUser, sourceCandidateController);

// ── Monitoring (manager view) ─────────────────────────────────────────────────
router.get("/activity", authenticateUser, getActivitySummaryController);

export default router;
