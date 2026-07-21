// routes/client.routes.ts
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
  addClientNoteSchema,
  addSpocSchema,
  updateSpocSchema,
  addSpocDMSchema,
} from "@/validators/client.validators";
import {
  getClients,
  getMyClients,
  getClientById,
  createClient,
  updateClient,
  updateClientStatus,
  deleteClient,
  addClientNote,
  deleteClientNote,
  addSpoc,
  updateSpoc,
  removeSpoc,
  getClientSpocs,
  addSpocDMs,
  getSpocDMs,
  removeSpocDM,
  updateClient1,
} from "@/controller/client.controller";

const router = Router();
const scope = scopeFilter("clients");

// collection
router.get("/mine", authenticateUser, getMyClients);
router.get("/", authenticateUser, scope, getClients);
router.post(
  "/",
  authenticateUser,
  scope,
  checkPermission("canAdd"),
  validate.body(createClientSchema),
  createClient
);

// single
router.get("/:id", authenticateUser, scope, getClientById);

router.put(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  // validate.body(updateClientSchema),
  updateClient
);

router.patch(
  "/:id",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  // validate.body(updateClientSchema),
  updateClient1
);

router.get("/:id/spocs/:spocId/dms", authenticateUser, scope, getSpocDMs);

router.post(
  "/:id/spocs/:spocId/dms",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(addSpocDMSchema),
  addSpocDMs
);

router.delete(
  "/:id/spocs/:spocId/dms/:spocDmId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  removeSpocDM
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

// notes
router.post(
  "/:id/notes",
  authenticateUser,
  scope,
  validate.body(addClientNoteSchema),
  addClientNote
);
router.delete("/:id/notes/:noteId", authenticateUser, scope, deleteClientNote);

router.get("/:id/spocs", authenticateUser, getClientSpocs);
// spocs
router.post(
  "/:id/spocs",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(addSpocSchema),
  addSpoc
);
router.patch(
  "/:id/spocs/:spocId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  validate.body(updateSpocSchema),
  updateSpoc
);
router.delete(
  "/:id/spocs/:spocId",
  authenticateUser,
  scope,
  checkPermission("canEdit"),
  removeSpoc
);

export default router;
