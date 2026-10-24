// File: client.routes.ts
// Path: src/routes/client.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  clientActivitiesQuery,
  clientNoteBody,
  clientStatusBody,
  createClientBody,
  listClientsQuery,
  noteParams,
  updateClientBody,
} from "@/validators/client.validators";
import {
  listClients,
  getClientById,
  createClient,
  updateClient,
  updateClientStatus,
  deleteClient,
  listClientActivities,
  addClientNote,
  deleteClientNote,
} from "@/controller/client.controller";

const router = Router();
const read = authorize("clients.read");

router.use(authenticateUser);

router.get("/", read, validate.query(listClientsQuery), listClients);
router.post("/", authorize("clients.create"), validate.body(createClientBody), createClient);

router.get("/:id", read, validate.params(idParams), getClientById);
router.patch(
  "/:id",
  authorize("clients.update"),
  validate.request({ params: idParams, body: updateClientBody }),
  updateClient,
);
router.patch(
  "/:id/status",
  authorize("clients.approve"),
  validate.request({ params: idParams, body: clientStatusBody }),
  updateClientStatus,
);
router.delete("/:id", authorize("clients.delete"), validate.params(idParams), deleteClient);

router.get(
  "/:id/activities",
  read,
  validate.request({ params: idParams, query: clientActivitiesQuery }),
  listClientActivities,
);

// notes — anyone who can see the client
router.post(
  "/:id/notes",
  read,
  validate.request({ params: idParams, body: clientNoteBody }),
  addClientNote,
);
router.delete("/:id/notes/:noteId", read, validate.params(noteParams), deleteClientNote);

export default router;
