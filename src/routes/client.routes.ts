import {
  approveClients,
  assignContactHandler,
  createClient,
  getAllClients,
  getSingleClientDetails,
  spocContact,
  // spocHandler,
} from "@/controller/client.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import {
  assignContactHandlerSchema,
  // approveClientsSchema,
  // clientsApprovalSchema,
  clientsIdSchema,
  contactHandlerParamsSchema,
  createClientSchema,
  getAllClientsSchema,
  // handlersIdSchema,
  spocContactSchema,
  // spocHandlerSchema,
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
router.post(
  "/:id/contacts",
  authenticateUser,
  validate.params(clientsIdSchema),
  validate.body(spocContactSchema),
  spocContact,
);

/**
 * @route   POST /api/clients
 * @desc    Add a SPOC handler.
 * @access  Super Admin,admin,Based on roles
 */
router.post(
  "/:id/contacts/:contactId/handlers",
  authenticateUser,
  validate.params(assignContactHandlerSchema),
  validate.params(contactHandlerParamsSchema),
  // validate.body(spocHandlerSchema),
  assignContactHandler,
);
export default router;
