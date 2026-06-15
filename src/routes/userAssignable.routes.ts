// File: userAssignable.routes.ts
// Path: src/routes/userAssignable.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  checkPermission,
  scopeFilter,
} from "@/middleware/scopeFilter.middleware";
import {
  getAssignableTo,
  addAssignableTo,
  removeAssignableTo,
  getAssignableToCandidates,
} from "@/controller/userAssignable.controller";

const router = Router({ mergeParams: true }); // mergeParams so :id from parent is available

const auth = authenticateUser;
const scope = scopeFilter("users");

// GET  /users/:id/assignable-to              → list current tags
router.get("/", auth, scope, getAssignableTo);

// GET  /users/:id/assignable-to/candidates   → search users to add
router.get("/candidates", auth, scope, getAssignableToCandidates);

// POST /users/:id/assignable-to              → add tags { targetIds: string[] }
router.post("/", auth, scope, checkPermission("canEdit"), addAssignableTo);

// DELETE /users/:id/assignable-to/:targetId  → remove one tag
router.delete(
  "/:targetId",
  auth,
  scope,
  checkPermission("canEdit"),
  removeAssignableTo
);

export default router;

// ─── Mount in your main router like this: ────────────────────────────────────
// import userAssignableRoutes from "./userAssignable.routes";
// router.use("/users/:id/assignable-to", userAssignableRoutes);
