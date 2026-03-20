import {
  approveClients,
  createClient,
  getAllClients,
  getSingleClientDetails,
} from "@/controller/client.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import {
  // approveClientsSchema,
  // clientsApprovalSchema,
  clientsIdSchema,
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
  // authorize("SUPER_ADMIN", "ADMIN"),
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
  // authorize("SUPER_ADMIN", "ADMIN"),
  validate.query(getAllClientsSchema),
  getAllClients,
);

/**
 * @route   PATCH /api/clients
 * @desc    Approve the clients
 * @access  Super Admin,admin
 */
router.use(
  "/:id/approve",
  authenticateUser,
  // authorize("SUPER_ADMIN", "ADMIN"),
  validate.params(clientsIdSchema),
  approveClients,
);

/**
 * @route   GET /api/clients
 * @desc    GET the clients
 * @access  Super Admin,admin,Based on roles
 */
router.use(
  "/:id",
  authenticateUser,
  validate.params(clientsIdSchema),
  getSingleClientDetails,
);

/**
 * @route   POST /api/clients
 * @desc    Add a SPOC to the client.
 * @access  Super Admin,admin,Based on roles
 */
export default router;
