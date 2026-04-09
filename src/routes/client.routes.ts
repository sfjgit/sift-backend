import {
  approveClients,
  assignContactHandler,
  clientNote,
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
  clientNoteSchema,
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
  authorize("clients", "canAdd"),
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
  authorize("clients", "canView"),
  validate.query(getAllClientsSchema),
  getAllClients,
);

/**
 * @route   PATCH /api/clients
 * @desc    Approve the clients
 * @access  Super Admin,admin
 */
router.post(
  "/:id/approve",
  authenticateUser,
  authorize("clients", "canAdd"),
  validate.params(clientsIdSchema),
  approveClients,
);

/**
 * @route   GET /api/clients
 * @desc    GET the clients
 * @access  Super Admin,admin,Based on roles
 */
router.get(
  "/:id",
  authenticateUser,
  authorize("clients", "canView"),
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
  authorize("clients", "canAdd"),
  validate.params(clientsIdSchema),
  validate.body(spocContactSchema),
  spocContact,
);

/**
 * @route   POST /api/clients
 * @desc    Assign a user to handle a specific SPOC
 * @access  Super Admin,admin,Based on roles
 */
router.post(
  "/:id/contacts/:contactId/handlers",
  authenticateUser,
  authorize("clients", "canAdd"),
  validate.body(assignContactHandlerSchema),
  validate.params(contactHandlerParamsSchema),
  assignContactHandler,
);
/**
 * @route   POST /api/clients
 * @desc    Add a note to client .
 * @access  Super Admin,admin,CSM
 */
router.post(
  "/:id/notes",
  authenticateUser,
  authorize("clients", "canAdd"),
  validate.params(clientsIdSchema),
  validate.body(clientNoteSchema),
  clientNote,
);
export default router;
