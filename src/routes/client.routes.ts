import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";

// Controllers
import {
  createClient,
  updateClient,
  approveClient,
  getAllClients,
  getClientById,
  deleteClient,
  addClientContact,
  updateClientContact,
  removeClientContact,
  assignContactHandler,
  removeContactHandler,
  assignClientHandler,
  removeClientHandler,
  assignClientToTeam,
  removeClientFromTeam,
  addClientNote,
} from "@/controller/client.controller";

// Validators
import {
  createClientSchema,
  updateClientSchema,
  clientIdSchema,
  getAllClientsSchema,
  contactSchema,
  contactIdSchema,
  assignContactHandlerSchema,
  contactHandlerParamsSchema,
  assignClientHandlerSchema,
  assignClientTeamSchema,
  clientNoteSchema,
} from "@/validators/client.validators";

const router = Router();

/**
 * CLIENT CORE
 */

router.post(
  "/",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.body(createClientSchema),
  createClient
);

router.get(
  "/",
  authenticateUser,
  scopeFilter("clients"),
  validate.query(getAllClientsSchema),
  getAllClients
);

router.get(
  "/:id",
  authenticateUser,
  scopeFilter("clients"),
  validate.params(clientIdSchema),
  getClientById
);

router.patch(
  "/:id",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canEdit"),
  validate.params(clientIdSchema),
  validate.body(updateClientSchema),
  updateClient
);

router.delete(
  "/:id",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canDelete"),
  validate.params(clientIdSchema),
  deleteClient
);

router.post(
  "/:id/approve",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.params(clientIdSchema),
  approveClient
);

/**
 * CONTACTS
 */

router.post(
  "/:id/contacts",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.params(clientIdSchema),
  validate.body(contactSchema),
  addClientContact
);

router.patch(
  "/:id/contacts/:contactId",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canEdit"),
  validate.params(contactIdSchema),
  validate.body(contactSchema),
  updateClientContact
);

router.delete(
  "/:id/contacts/:contactId",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canDelete"),
  validate.params(contactIdSchema),
  removeClientContact
);

/**
 * CONTACT HANDLERS
 */

router.post(
  "/:id/contacts/:contactId/handlers",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.params(contactHandlerParamsSchema),
  validate.body(assignContactHandlerSchema),
  assignContactHandler
);

router.delete(
  "/:id/contacts/:contactId/handlers/:handlerId",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canDelete"),
  validate.params(contactHandlerParamsSchema),
  removeContactHandler
);

/**
 * CLIENT HANDLERS
 */

router.post(
  "/:id/handlers",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.params(clientIdSchema),
  validate.body(assignClientHandlerSchema),
  assignClientHandler
);

router.delete(
  "/:id/handlers/:handlerId",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canDelete"),
  validate.params(clientIdSchema),
  removeClientHandler
);

/**
 * TEAM ASSIGNMENT
 */

router.post(
  "/:id/teams",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.params(clientIdSchema),
  validate.body(assignClientTeamSchema),
  assignClientToTeam
);

router.delete(
  "/:id/teams/:teamId",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canDelete"),
  validate.params(clientIdSchema),
  removeClientFromTeam
);

/**
 * NOTES
 */

router.post(
  "/:id/notes",
  authenticateUser,
  scopeFilter("clients"),
  checkPermission("canAdd"),
  validate.params(clientIdSchema),
  validate.body(clientNoteSchema),
  addClientNote
);

export default router;
