import { createRequirements } from "@/controller/requirement.controller";
import { authenticateUser } from "@/middleware/auth";
import { createRequirementsSchema } from "@/validators/requirement.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();

router.post(
  "/",
  authenticateUser,
  validate.body(createRequirementsSchema),
  createRequirements,
);

export default router;
