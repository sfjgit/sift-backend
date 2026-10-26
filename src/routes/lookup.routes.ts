// File: lookup.routes.ts
// Path: src/routes/lookup.routes.ts

import { Router } from "express";
import { z } from "zod";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import { LOOKUP_TYPES } from "@/config/lookups";
import {
  listLookupTypes,
  listLookups,
  createLookup,
  updateLookup,
  toggleLookup,
} from "@/controller/lookup.controller";

const listLookupsQuery = z.object({
  type: z.enum(LOOKUP_TYPES).optional(),
  includeInactive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

const createLookupBody = z.object({
  type: z.enum(LOOKUP_TYPES),
  code: z.string().trim().min(1).max(100).toUpperCase(),
  label: z.string().trim().min(1).max(200),
  order: z.number().int().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateLookupBody = createLookupBody.omit({ type: true }).partial();

const router = Router();
const manage = authorize("lookups.manage");

router.use(authenticateUser);

router.get("/types", listLookupTypes);
router.get("/", validate.query(listLookupsQuery), listLookups);
router.post("/", manage, validate.body(createLookupBody), createLookup);
router.put(
  "/:id",
  manage,
  validate.request({ params: idParams, body: updateLookupBody }),
  updateLookup,
);
router.patch("/:id/toggle", manage, validate.params(idParams), toggleLookup);

export default router;
