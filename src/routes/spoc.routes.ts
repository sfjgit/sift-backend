// File: spoc.routes.ts
// Path: src/routes/spoc.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  assignSpocBody,
  createSpocBody,
  listSpocsQuery,
  updateSpocBody,
} from "@/validators/client.validators";
import {
  listSpocs,
  getSpocById,
  createSpoc,
  updateSpoc,
  assignSpoc,
  deleteSpoc,
} from "@/controller/spoc.controller";

const router = Router();
const read = authorize("spocs.read");

router.use(authenticateUser);

router.get("/", read, validate.query(listSpocsQuery), listSpocs);
router.post("/", authorize("spocs.create"), validate.body(createSpocBody), createSpoc);

// out of scope = 404, never 403
router.get("/:id", read, validate.params(idParams), getSpocById);
router.patch(
  "/:id",
  authorize("spocs.update"),
  validate.request({ params: idParams, body: updateSpocBody }),
  updateSpoc,
);
router.patch(
  "/:id/assign",
  authorize("spocs.assign"),
  validate.request({ params: idParams, body: assignSpocBody }),
  assignSpoc,
);
router.delete("/:id", authorize("spocs.delete"), validate.params(idParams), deleteSpoc);

export default router;
