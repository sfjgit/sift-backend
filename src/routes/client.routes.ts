import { createClient, getAllClients } from "@/controller/client.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import {
  createClientSchema,
  getAllClientsSchema,
} from "@/validators/client.validators";

import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();
/**
 * @route   POST /api/clients
 * @desc    create clients
 * @access  Super Admin,admin
 */
router.post(
  "/",
  authenticateUser,
  authorize("SUPER_ADMIN", "ADMIN"),
  validate.body(createClientSchema),
  createClient,
);

/**
 * @route   GET /api/clients
 * @desc    Get all clients
 * @access  Super Admin,admin
 */
router.get(
  "/",
  authenticateUser,
  authorize("SUPER_ADMIN", "ADMIN"),
  validate.query(getAllClientsSchema),
  getAllClients,
);
export default router;
