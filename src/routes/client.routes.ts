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
  createCsrProgramBody,
  csrProgramParams,
  updateCsrProgramBody,
  documentParams,
  financialParams,
  listClientsQuery,
  locationParams,
  noteParams,
  saveTechnologyBody,
  technologyParams,
  saveCorporateFinancialBody,
  saveCsrFinancialBody,
  updateClientBody,
  updateLocationBody,
  uploadDocumentBody,
} from "@/validators/client.validators";
import { createCsrProgram, removeCsrProgram, updateCsrProgram } from "@/controller/csrProgram.controller";
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
  uploadClientDocument,
  removeClientDocument,
  saveCsrFinancial,
  removeCsrFinancial,
  saveCorporateFinancial,
  removeCorporateFinancial,
} from "@/controller/client.controller";
import { getClientMap } from "@/controller/clientMap.controller";
import { getExportDetails } from "@/controller/clientExport.controller";
import {
  checkClientWebsite,
  checkWebsiteBody,
  getWebsiteHistory,
  replaceClientWebsite,
  replaceWebsiteBody,
} from "@/controller/website.controller";
import { singleFile } from "@/middleware/upload";
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
// the 3D office map — before /:id so "map" isn't read as an id
router.get("/map", read, getClientMap);
// the nested data behind an export (extra sheets) — read-only
router.post("/export-details", read, getExportDetails);
// the website: replace it (old one kept in the history), and the history
router.post(
  "/:id/website",
  authorize("clients.update"),
  validate.request({ params: idParams, body: replaceWebsiteBody }),
  replaceClientWebsite,
);
router.get("/:id/website-history", read, validate.params(idParams), getWebsiteHistory);
router.post(
  "/:id/website/check",
  authorize("clients.update"),
  validate.request({ params: idParams, body: checkWebsiteBody }),
  checkClientWebsite,
);

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

router.post(
  "/:id/documents",
  authorize("client_documents.upload"),
  singleFile,
  validate.request({ params: idParams, body: uploadDocumentBody }),
  uploadClientDocument,
);
router.delete(
  "/:id/documents/:documentId",
  authorize("client_documents.delete"),
  validate.params(documentParams),
  removeClientDocument,
);

// financials — CSR figures and company figures, one row per FY
router.put(
  "/:id/financials",
  authorize("client_financials.update"),
  validate.request({ params: idParams, body: saveCsrFinancialBody }),
  saveCsrFinancial,
);
router.delete(
  "/:id/financials/:financialId",
  authorize("client_financials.update"),
  validate.params(financialParams),
  removeCsrFinancial,
);
router.put(
  "/:id/corporate-financials",
  authorize("client_financials.update"),
  validate.request({ params: idParams, body: saveCorporateFinancialBody }),
  saveCorporateFinancial,
);
router.delete(
  "/:id/corporate-financials/:financialId",
  authorize("client_financials.update"),
  validate.params(financialParams),
  removeCorporateFinancial,
);

// CSR programmes — the project table of the annual CSR report
router.post(
  "/:id/csr-programs",
  authorize("client_programs.create"),
  validate.request({ params: idParams, body: createCsrProgramBody }),
  createCsrProgram,
);
router.patch(
  "/:id/csr-programs/:programId",
  authorize("client_programs.update"),
  validate.request({ params: csrProgramParams, body: updateCsrProgramBody }),
  updateCsrProgram,
);
router.delete(
  "/:id/csr-programs/:programId",
  authorize("client_programs.delete"),
  validate.params(csrProgramParams),
  removeCsrProgram,
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
