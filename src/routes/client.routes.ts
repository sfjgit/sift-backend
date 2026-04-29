import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import {
  scopeFilter,
  checkPermission,
} from "@/middleware/scopeFilter.middleware";
import { validate } from "@/validators/validator";
import {
  createClientSchema,
  updateClientSchema,
  updateClientStatusSchema,
  addHandlerSchema,
  updateHandlerRoleSchema,
  removeHandlerSchema,
  addContactSchema,
  updateContactSchema,
  addClientNoteSchema,
  assignTeamSchema,
} from "@/validators/client.validators";
import {
  getClients,
  getMyClients,
  getClientById,
  createClient,
  updateClient,
  updateClientStatus,
  deleteClient,
  addHandler,
  removeHandler,
  updateHandlerRole,
  getContacts,
  addContact,
  updateContact,
  removeContact,
  addClientNote,
  deleteClientNote,
  assignTeam,
  removeTeamAssignment,
} from "@/controller/client.controller";

const router = Router();
const scope = scopeFilter("clients");

// ─────────────────────────────────────────────────────────────────────────────
// Aggregates — BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────

router.get("/mine", authenticateUser, getMyClients);

// ─────────────────────────────────────────────────────────────────────────────
// Collection
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", authenticateUser, scope, getClients);

router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createClientSchema),
  createClient
);

// ─────────────────────────────────────────────────────────────────────────────
// Single client
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id", authenticateUser, scope, getClientById);

router.put(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateClientSchema),
  updateClient
);

router.patch(
  "/:id/status",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateClientStatusSchema),
  updateClientStatus
);

router.delete(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canDelete"),
  deleteClient
);

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/:id/handlers",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(addHandlerSchema),
  addHandler
);

router.patch(
  "/:id/handlers/:handlerId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateHandlerRoleSchema),
  updateHandlerRole
);

router.delete(
  "/:id/handlers/:handlerId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(removeHandlerSchema),
  removeHandler
);

// ─────────────────────────────────────────────────────────────────────────────
// Contacts
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id/contacts", authenticateUser, scope, getContacts);

router.post(
  "/:id/contacts",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(addContactSchema),
  addContact
);

router.put(
  "/:id/contacts/:contactId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateContactSchema),
  updateContact
);

router.delete(
  "/:id/contacts/:contactId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  removeContact
);

// ─────────────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/:id/notes",
  authenticateUser,
  scope,
  validate.body(addClientNoteSchema),
  addClientNote
);

router.delete("/:id/notes/:noteId", authenticateUser, scope, deleteClientNote);

// ─────────────────────────────────────────────────────────────────────────────
// Team assignments
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/:id/teams",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(assignTeamSchema),
  assignTeam
);

router.delete(
  "/:id/teams/:assignmentId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  removeTeamAssignment
);

export default router;
