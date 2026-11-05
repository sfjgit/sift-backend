// File: csrAgency.routes.ts
// Path: src/routes/csrAgency.routes.ts
//
// The tenant's implementing agencies (NGOs, trusts) — the programme form's picker.
// New agencies are added through the programme form, not here.

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate } from "@/validators/validator";
import { csrAgencyQuery } from "@/validators/client.validators";
import { listCsrAgencies } from "@/controller/csrProgram.controller";

const router = Router();

router.use(authenticateUser);
router.get("/", authorize("client_programs.read"), validate.query(csrAgencyQuery), listCsrAgencies);

export default router;
