// File: client.routes.ts
// Path: src/routes/client.routes.ts

import { Router } from "express";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams } from "@/validators/validator";
import {
  bulkAssignBody,
  bulkClientStatusBody,
  setAssignmentsBody,
  clientActivitiesQuery,
  clientNoteBody,
  clientStatusBody,
  createClientBody,
  createLocationBody,
  documentParams,
  listClientsQuery,
  locationParams,
  noteParams,
  saveTechnologyBody,
  technologyParams,
  updateClientBody,
  updateLocationBody,
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
  addClientLocation,
  updateClientLocation,
  removeClientLocation,
  saveClientTechnology,
  removeClientTechnology,
  bulkUpdateClientStatus,
  getClientDocumentUrl,
} from "@/controller/client.controller";
import { bulkAssignClients, listClientAssignments, setClientAssignments } from "@/controller/clientAssignment.controller";

const router = Router();
const read = authorize("clients.read");

router.use(authenticateUser);

router.get("/", read, validate.query(listClientsQuery), listClients);
router.post("/", authorize("clients.create"), validate.body(createClientBody), createClient);

// bulk — before /:id so "bulk-status" isn't read as an id
router.patch(
  "/bulk-status",
  authorize("clients.approve"),
  validate.body(bulkClientStatusBody),
  bulkUpdateClientStatus,
);

router.post("/assign", authorize("clients.assign"), validate.body(bulkAssignBody), bulkAssignClients);

router.get("/:id", read, validate.params(idParams), getClientById);
router.get("/:id/assignments", read, validate.params(idParams), listClientAssignments);
router.put(
  "/:id/assignments",
  authorize("clients.assign"),
  validate.request({ params: idParams, body: setAssignmentsBody }),
  setClientAssignments,
);
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

// documents — presigned read URL, never the raw S3 key
router.get(
  "/:id/documents/:documentId/url",
  authorize("client_documents.read"),
  validate.params(documentParams),
  getClientDocumentUrl,
);

// notes — read with the client; delete: own notes, or anyone's with client_notes.delete_any
router.post(
  "/:id/notes",
  authorize("client_notes.create"),
  validate.request({ params: idParams, body: clientNoteBody }),
  addClientNote,
);
router.delete("/:id/notes/:noteId", read, validate.params(noteParams), deleteClientNote);

// locations + technologies
router.post(
  "/:id/locations",
  authorize("client_locations.create"),
  validate.request({ params: idParams, body: createLocationBody }),
  addClientLocation,
);
router.patch(
  "/:id/locations/:locationId",
  authorize("client_locations.update"),
  validate.request({ params: locationParams, body: updateLocationBody }),
  updateClientLocation,
);
router.delete(
  "/:id/locations/:locationId",
  authorize("client_locations.delete"),
  validate.params(locationParams),
  removeClientLocation,
);

router.put(
  "/:id/technologies",
  authorize("client_technologies.update"),
  validate.request({ params: idParams, body: saveTechnologyBody }),
  saveClientTechnology,
);
router.delete(
  "/:id/technologies/:technologyId",
  authorize("client_technologies.delete"),
  validate.params(technologyParams),
  removeClientTechnology,
);

export default router;
