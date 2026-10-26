// File: search.routes.ts
// Path: src/routes/search.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate } from "@/validators/validator";
import { searchQuery } from "@/validators/search.validators";
import { globalSearch } from "@/controller/search.controller";

const router = Router();

router.use(authenticateUser);

// permission checks per section happen in the controller
router.get("/", validate.query(searchQuery), globalSearch);

export default router;
