// File: client.validators.ts
// Path: src/validators/client.validators.ts

import { z } from "zod";
import {
  ClientOwnership,
  GovtLevel,
  ClientActivityType,
  ClientEntityType,
  ClientStatus,
  EmailStatus,
  OutreachStatus,
  SpocApprovalStatus,
  SpocDataFlag,
  ValidationBand,
  WorkTaskKind,
  WorkTaskStatus,
} from "@prisma/client";
import { csv, csvIds, optionalId, optionalText, paginationQuery } from "@/validators/validator";

const optionalUrl = z
  .string()
  .trim()
  .url("Invalid URL")
  .or(z.literal("").transform(() => null))
  .nullable()
  .optional();

const optionalYears = z.number().min(0).max(99.9).nullable().optional();

// project tags (Lookup PROJECT ids) — replaces the whole set when sent
const projectIds = z
  .array(z.string().uuid())
  .max(20)
  .transform((ids) => [...new Set(ids)])
  .optional();

// "me" = starred by me, "any" = by anyone, "none" = by nobody
const keyAccountFilter = z.enum(["me", "any", "none"]).optional();

// ── clients ──────────────────────────────────────────────────────────────────

export const createClientBody = z.object({
  entityType: z.nativeEnum(ClientEntityType).optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  shortName: optionalText(100),
  cin: optionalText(21).transform((v) => v?.toUpperCase() ?? v),
  website: optionalUrl,
  linkedinUrl: optionalUrl,
  industryId: optionalId,
  categoryId: optionalId,
  // exact head count if known; the band (lookup EMPLOYEE_SIZE) follows from it when not sent
  employeeCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  employeeSizeId: optionalId,
  businessUnitId: optionalId,
  // service lines are not sent: they follow the client's SPOCs (src/services/clientServiceLines.service.ts)
  projectIds,
  // company group (Adani Group, Tata Group …)
  groupName: optionalText(150),
  linkedinEmployees: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // ── add-on: registration (ClientRegistration)
  ownership: z.nativeEnum(ClientOwnership).nullable().optional(),
  companyClass: optionalText(150),
  yearOfIncorporation: z.number().int().min(1800).max(2100).nullable().optional(),
  isListed: z.boolean().nullable().optional(),
  subCategory: optionalText(200),
  marketCapRs: z.number().min(0).max(1e17).nullable().optional(),
  // ── add-on: CSR (ClientCsr)
  csrRoleId: optionalId,
  csrEligible: z.boolean().nullable().optional(),
  foundationName: optionalText(300),
  foundationWebsite: optionalUrl,
  // ── add-on: government body (ClientGovt) — only the fields sent are saved
  govt: z
    .object({
      level: z.nativeEnum(GovtLevel).nullable().optional(),
      orgTypeId: optionalId,
      parentClientId: optionalId,
      nodalMinistryId: optionalId,
      ministryName: optionalText(300),
      departmentName: optionalText(300),
      stateSkillBody: optionalText(300),
      sector: optionalText(200),
      skillFamily: optionalText(50),
      isNational: z.boolean().nullable().optional(),
      schemeType: optionalText(100),
      estimatedBudget: optionalText(200),
      tenderPortal: optionalText(300),
      tenderAuthority: optionalText(300),
      priority: z.enum(["H", "M", "L"]).nullable().optional(),
      digitalMaturity: optionalText(100),
    })
    .optional(),
});

export const updateClientBody = createClientBody.partial();

export const clientStatusBody = z.object({
  status: z.nativeEnum(ClientStatus),
});

const ids = csvIds;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional();

export const CLIENT_GAPS = ["website", "reports", "spocs", "approved", "figures", "outreach"] as const;
export const STEP_KEYS = ["reports", "report_spocs", "figures", "enrich", "apollo", "validate", "emails"] as const;

/** latest-FY figures the list can sort and range-filter by: list key → [table, column] */
export const CLIENT_FIGURES = {
  csrObligation: ["ClientCsrFinancial", "obligationRs"],
  csrFund: ["ClientCsrFinancial", "budgetRs"],
  csrUnspent: ["ClientCsrFinancial", "unspentRs"],
  revenue: ["ClientCorporateFinancial", "revenueRs"],
  netProfit: ["ClientCorporateFinancial", "netProfitRs"],
  netWorth: ["ClientCorporateFinancial", "netWorthRs"],
  paidUpCapital: ["ClientCorporateFinancial", "paidUpCapitalRs"],
  authorisedCapital: ["ClientCorporateFinancial", "authorisedCapitalRs"],
} as const;
export type ClientFigure = keyof typeof CLIENT_FIGURES;
const FIGURE_KEYS = Object.keys(CLIENT_FIGURES) as [ClientFigure, ...ClientFigure[]];

export const listClientsQuery = z.object({
  search: z.string().trim().max(200).optional(),
  // several = any of them ("ACTIVE,PENDING")
  status: csv(z.nativeEnum(ClientStatus)),
  // column searches (contains, any case) — the clients table's column headers
  name: z.string().trim().max(200).optional(),
  shortName: z.string().trim().max(200).optional(),
  cin: z.string().trim().max(50).optional(),
  website: z.string().trim().max(200).optional(),
  // add-ons + company group; several = any of them
  groupName: csv(z.string().trim().min(1).max(150)),
  ownership: csv(z.nativeEnum(ClientOwnership)),
  csrRoleId: ids,
  govtLevel: csv(z.nativeEnum(GovtLevel)),
  govtOrgTypeId: ids,
  // latest CSR year ("2024-25"); several = any of them
  csrFy: csv(z.string().trim().regex(/^\d{4}-\d{2}(\d{2})?$/, "Use 2024-2025")),
  entityType: csv(z.nativeEnum(ClientEntityType)),
  industryId: ids,
  categoryId: ids,
  employeeSizeId: ids,
  // latest CSR spend (client snapshot), ₹ crore
  csrSpentMinCr: z.coerce.number().min(0).optional(),
  csrSpentMaxCr: z.coerce.number().min(0).optional(),
  // latest-FY figures, ₹ crore: <figure>MinCr / <figure>MaxCr (figure = a key of CLIENT_FIGURES); profit can be negative
  ...Object.fromEntries(
    Object.keys(CLIENT_FIGURES).flatMap((k) => [
      [`${k}MinCr`, z.coerce.number().optional()],
      [`${k}MaxCr`, z.coerce.number().optional()],
    ]),
  ) as Record<`${ClientFigure}${"Min" | "Max"}Cr`, z.ZodOptional<z.ZodCoercedNumber>>,
  employeeMin: z.coerce.number().int().min(0).optional(),
  employeeMax: z.coerce.number().int().min(0).optional(),
  // contains, any case — matched on the client's active offices
  address: z.string().trim().max(200).optional(),
  pincode: z.string().trim().max(10).optional(),
  // has an active location of type BRANCH
  hasBranches: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // the client's own BU / service lines
  businessUnitId: ids,
  serviceLineId: ids,
  // matched through the client's active SPOCs
  handlerId: ids,
  createdById: ids,
  // "me", "team" (me + everyone reporting to me), "none" (nobody assigned) or a user id
  assignedTo: z.union([z.literal("me"), z.literal("team"), z.literal("none"), z.string().uuid()]).optional(),
  assignedToId: ids,
  assignedById: ids,
  // data gaps (all picked must be missing) / pipeline coverage
  missing: csv(z.enum(CLIENT_GAPS)),
  pipeline: z.enum(["never", "run", "failed"]).optional(),
  // a DONE run of every picked step / no DONE run of any picked step
  stepsDone: csv(z.enum(STEP_KEYS)),
  stepsNotDone: csv(z.enum(STEP_KEYS)),
  outreachStatus: csv(z.nativeEnum(OutreachStatus)),
  createdFrom: day,
  createdTo: day,
  lastRunFrom: day,
  lastRunTo: day,
  // matched through the client's active locations
  // several = any of them; country + state + city must match the same location
  country: csv(z.string().trim().min(1).max(100)),
  state: csv(z.string().trim().min(1).max(100)),
  district: z.string().trim().max(100).optional(),
  city: csv(z.string().trim().min(1).max(100)),
  // matched through one CSR programme (all picked conditions on the same one)
  programSectorId: ids,
  programState: csv(z.string().trim().min(1).max(100)),
  programDistrict: z.string().trim().max(100).optional(),
  programAgency: z.string().trim().max(200).optional(),
  // sales marks
  keyAccount: keyAccountFilter,
  csrEligible: z.enum(["yes", "no", "unset"]).optional(),
  projectId: ids,
  ...paginationQuery,
  // .catch: an unknown sort from an old link or saved view falls back to the default, not a 400
  // default: last updated first — a run starting / ending counts as an update
  sortBy: z
    .enum(["name", "createdAt", "updatedAt", "status", "csrSpentRs", "csrFy", "employeeCount", "shortName", "cin", "entityType", "industry", "category", "businessUnit", "employeeSize", ...FIGURE_KEYS])
    .catch("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).catch("desc"),
});

// GET /clients/facets — the values of one column with how many clients have each (other filters applied)
export const CLIENT_FACETS = ["groupName", "ownership", "csrRoleId", "govtLevel", "govtOrgTypeId", "status", "entityType", "industryId", "categoryId", "employeeSizeId", "businessUnitId", "serviceLineId", "csrFy", "createdById", "assignedToId", "projectId", "country", "state", "city"] as const;
// q = only values whose label contains it
export const clientFacetsQuery = listClientsQuery.extend({ field: z.enum(CLIENT_FACETS), q: z.string().trim().max(100).optional() });
export type ClientFacetsQuery = z.infer<typeof clientFacetsQuery>;

export const clientActivitiesQuery = z.object({
  ...paginationQuery,
  spocId: z.string().uuid().optional(),
  type: csv(z.nativeEnum(ClientActivityType)),
});

// sections of the client page that take their own comments (CASPA tab comments)
export const NOTE_SECTIONS = ["info", "branches", "skilling", "csr", "reports", "spocs", "technology", "outreach", "meetings", "sales_assets", "marketing_assets"] as const;

export const clientNoteBody = z.object({
  content: z.string().trim().min(1, "Content is required").max(5000),
  // a comment on one SPOC of this client
  spocId: optionalId,
  // a comment on one section of the client page
  section: z.enum(NOTE_SECTIONS).optional(),
});

export const updateNoteBody = z.object({
  content: z.string().trim().min(1, "Content is required").max(5000),
});

// ── tasks / calls / meetings, and the quick "I emailed / called / WhatsApped" log
const dueAt = z.coerce.date().nullable().optional();

export const listTasksQuery = z.object({
  spocId: z.string().uuid().optional(),
  status: csv(z.nativeEnum(WorkTaskStatus)),
});

export const createTaskBody = z.object({
  spocId: optionalId,
  kind: z.nativeEnum(WorkTaskKind).default("TASK"),
  title: z.string().trim().min(1, "Say what needs doing").max(300),
  notes: optionalText(2000),
  dueAt,
  assigneeId: z.string().uuid().optional(),
});

export const updateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    notes: optionalText(2000),
    dueAt,
    assigneeId: z.string().uuid().optional(),
    status: z.nativeEnum(WorkTaskStatus).optional(),
    closeNote: optionalText(2000),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const taskParams = z.object({ id: z.string().uuid(), taskId: z.string().uuid() });

export const INTERACTION_CHANNELS = ["EMAIL", "CALL", "WHATSAPP", "LINKEDIN", "OTHER"] as const;
export const interactionBody = z.object({
  spocId: optionalId,
  channel: z.enum(INTERACTION_CHANNELS),
  note: optionalText(2000),
  // calls only: did they pick up?
  connected: z.boolean().optional(),
});

export const noteParams = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
});

// ── locations ────────────────────────────────────────────────────────────────

const optionalCoord = (max: number) => z.number().min(-max).max(max).nullable().optional();

// a point needs both halves: give latitude and longitude together (or clear both)
const coordsPaired = (
  v: { latitude?: number | null | undefined; longitude?: number | null | undefined },
  ctx: z.RefinementCtx,
) => {
  if (v.latitude === undefined && v.longitude === undefined) return;
  if ((v.latitude ?? null) === null !== ((v.longitude ?? null) === null))
    ctx.addIssue({
      code: "custom",
      path: [v.latitude == null ? "latitude" : "longitude"],
      message: "Give latitude and longitude together",
    });
};

const locationFields = z.object({
  typeId: optionalId,
  name: optionalText(200),
  addressLine: optionalText(500),
  city: optionalText(100),
  district: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  pincode: optionalText(10),
  latitude: optionalCoord(90),
  longitude: optionalCoord(180),
  isPrimary: z.boolean().optional(),
  dmEvidence: optionalText(2000),
});

export const createLocationBody = locationFields.superRefine(coordsPaired);
export const updateLocationBody = locationFields.partial().superRefine(coordsPaired);

export const locationParams = z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
});

// ── technologies — one row per client per category ───────────────────────────

export const saveTechnologyBody = z.object({
  categoryId: z.string().uuid("Category is required"),
  details: z.string().trim().min(1, "Details are required").max(2000),
});

export const technologyParams = z.object({
  id: z.string().uuid(),
  technologyId: z.string().uuid(),
});

// ── spocs ────────────────────────────────────────────────────────────────────

const spocFields = {
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: optionalText(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email")
    .or(z.literal("").transform(() => null))
    .nullable()
    .optional(),
  phone: optionalText(30),
  designation: optionalText(200),
  department: optionalText(200),
  linkedinUrl: optionalUrl,
  seniority: optionalText(50),
  totalExpYears: optionalYears,
  currentOrgExpYears: optionalYears,
  businessUnitId: z.string().uuid("Business unit is required"),
  serviceLineId: z.string().uuid("Service line is required"),
  locationId: optionalId, // must belong to the same client
  sourceId: optionalId,
  emailSourceId: optionalId,
  salesStatusId: optionalId,
  isPrimary: z.boolean().optional(),
  notes: optionalText(2000),
  erp: optionalText(100),
  dataFlag: z.nativeEnum(SpocDataFlag).nullable().optional(),
  projectIds,
  // CASPA SPOC profile
  phone2: optionalText(30),
  phone3: optionalText(30),
  state: optionalText(100),
  district: optionalText(100),
  city: optionalText(100),
  pincode: optionalText(10),
  address: optionalText(500),
  callConnected: z.boolean().nullable().optional(),
  roleCategoryId: optionalId,
  decisionAuthorityId: optionalId,
  orgTypeId: optionalId,
  revenueBandId: optionalId,
};

export const createSpocBody = z.object({
  clientId: z.string().uuid("Client is required"),
  handlerId: z.string().uuid("Handler is required"),
  ...spocFields,
});

// handler changes go through /spocs/:id/assign
export const updateSpocBody = z.object(spocFields).partial();

export const assignSpocBody = z.object({
  assignToId: z.string().uuid("assignToId is required"),
  reason: optionalText(500),
});

export const listSpocsQuery = z.object({
  search: z.string().trim().optional(),
  clientId: z.string().uuid().optional(),
  handlerId: csvIds,
  // "me" = I handle them, "team" = me + everyone reporting to me (phone app)
  handledBy: z.enum(["me", "team"]).optional(),
  businessUnitId: csvIds,
  serviceLineId: csvIds,
  salesStatusId: csvIds,
  emailStatus: csv(z.nativeEnum(EmailStatus)),
  validationBand: csv(z.nativeEnum(ValidationBand)),
  approvalStatus: csv(z.nativeEnum(SpocApprovalStatus)),
  reviewFlag: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // NONE = not flagged; BOTH_WRONG rows are hidden unless picked here
  dataFlag: csv(z.union([z.nativeEnum(SpocDataFlag), z.literal("NONE")])),
  keyAccount: keyAccountFilter,
  projectId: csvIds,
  erp: z.string().trim().max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
  ...paginationQuery,
  sortBy: z.enum(["firstName", "createdAt", "updatedAt", "validationScore"]).catch("createdAt"),
  sortDir: z.enum(["asc", "desc"]).catch("desc"),
});

export type CreateClientInput = z.infer<typeof createClientBody>;
export type UpdateClientInput = z.infer<typeof updateClientBody>;
export type CreateLocationInput = z.infer<typeof createLocationBody>;
export type UpdateLocationInput = z.infer<typeof updateLocationBody>;
export type ListClientsQuery = z.infer<typeof listClientsQuery>;
export type CreateSpocInput = z.infer<typeof createSpocBody>;
export type UpdateSpocInput = z.infer<typeof updateSpocBody>;
export type ListSpocsQuery = z.infer<typeof listSpocsQuery>;

// ── bulk actions ─────────────────────────────────────────────────────────────

const bulkIds = (what: string) =>
  z
    .array(z.string().uuid(`Invalid ${what} id`))
    .min(1, `Select at least one ${what}`)
    .max(200, "At most 200 at a time")
    .transform((ids) => [...new Set(ids)]);

export const spocApprovalBody = z.object({
  spocIds: bulkIds("SPOC"),
  decision: z.nativeEnum(SpocApprovalStatus),
  note: optionalText(500),
});

export type SpocApprovalInput = z.infer<typeof spocApprovalBody>;

export const bulkAssignSpocsBody = z.object({
  spocIds: bulkIds("SPOC"),
  assignToId: z.string().uuid("assignToId is required"),
  reason: optionalText(500),
});

// one bulk "set field" for SPOCs: any of the fields below, the rest untouched
export const bulkUpdateSpocsBody = z
  .object({
    spocIds: bulkIds("SPOC"),
    salesStatusId: z.string().uuid().nullable().optional(),
    dataFlag: z.nativeEnum(SpocDataFlag).nullable().optional(),
    erp: optionalText(100),
    projectIds: z.array(z.string().uuid()).max(20).optional(),
    projectMode: z.enum(["add", "remove", "replace"]).default("add"),
  })
  .refine(
    (b) => b.salesStatusId !== undefined || b.dataFlag !== undefined || b.erp !== undefined || b.projectIds !== undefined,
    { message: "Pick a field to set" },
  );

export type BulkUpdateSpocsInput = z.infer<typeof bulkUpdateSpocsBody>;

export const bulkClientStatusBody = z.object({
  clientIds: bulkIds("client"),
  status: z.nativeEnum(ClientStatus),
});

export const documentParams = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
});

export type BulkAssignSpocsInput = z.infer<typeof bulkAssignSpocsBody>;
export type BulkClientStatusInput = z.infer<typeof bulkClientStatusBody>;

// ── assignment — who works a client
export const setAssignmentsBody = z.object({
  userIds: z.array(z.string().uuid()).max(50),
  note: z.string().trim().max(500).optional(),
});

export const bulkAssignBody = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(500),
  userIds: z.array(z.string().uuid()).min(1).max(50),
  mode: z.enum(["add", "remove", "replace"]).default("add"),
  note: z.string().trim().max(500).optional(),
});

export type SetAssignmentsInput = z.infer<typeof setAssignmentsBody>;
export type BulkAssignInput = z.infer<typeof bulkAssignBody>;

// ── financials — one row per client per FY, ₹ (not crore) ────────────────────

export const fyText = z.string().trim().regex(/^\d{4}-\d{4}$/, "Use the form 2025-2026");
const rupees = z.number().min(0).max(1e16).nullable().optional();

export const saveCsrFinancialBody = z.object({
  fy: fyText,
  obligationRs: rupees,
  budgetRs: rupees,
  spentRs: rupees,
  unspentRs: rupees,
  evidence: optionalText(2000),
});

export const saveCorporateFinancialBody = z.object({
  fy: fyText,
  revenueRs: rupees,
  netProfitRs: z.number().min(-1e16).max(1e16).nullable().optional(), // a loss is negative
  paidUpCapitalRs: rupees,
  authorisedCapitalRs: rupees,
  netWorthRs: z.number().min(-1e16).max(1e16).nullable().optional(),
  source: optionalText(500),
});

export const financialParams = z.object({
  id: z.string().uuid(),
  financialId: z.string().uuid(),
});

export type SaveCsrFinancialInput = z.infer<typeof saveCsrFinancialBody>;

// ── CSR programmes — the project table of the annual CSR report ─────────────

const programLocation = z
  .object({
    state: z.string().trim().min(1, "State is required").max(100),
    district: optionalText(100),
    city: optionalText(100),
    latitude: optionalCoord(90),
    longitude: optionalCoord(180),
  })
  .superRefine(coordsPaired);

const csrProgramFields = z.object({
  fy: fyText,
  name: z.string().trim().min(1, "Programme name is required").max(500),
  sectorIds: z.array(z.string().uuid()).max(13),
  // the sector as written (imports) when it matches no Schedule VII activity
  sectorText: optionalText(1000),
  isOngoing: z.boolean().nullable().optional(),
  duration: optionalText(100),
  isLocalArea: z.boolean().nullable().optional(),
  locations: z.array(programLocation).max(100),
  locationNote: optionalText(2000),
  budgetRs: rupees,
  spentRs: rupees,
  unspentTransferredRs: rupees,
  mode: z.enum(["DIRECT", "AGENCY"]).nullable().optional(),
  // an existing agency, or a name (+ CSR-1 number) to find or add one
  agencyId: optionalId,
  agencyName: optionalText(300),
  agencyRegistrationNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^CSR\d{8}$/, "Use the CSR-1 number, e.g. CSR00012345")
    .nullable()
    .optional(),
  beneficiaries: optionalText(1000),
  // UN SDGs 1–17
  sdgs: z
    .array(z.number().int().min(1).max(17))
    .max(17)
    .transform((n) => [...new Set(n)].sort((a, b) => a - b))
    .optional(),
  sourceUrl: optionalUrl,
});

export const createCsrProgramBody = csrProgramFields.extend({
  sectorIds: csrProgramFields.shape.sectorIds.default([]),
  locations: csrProgramFields.shape.locations.default([]),
});
export const updateCsrProgramBody = csrProgramFields.partial().extend({
  // false hands the programme back to the pipeline
  isLocked: z.boolean().optional(),
});

export const csrProgramParams = z.object({
  id: z.string().uuid(),
  programId: z.string().uuid(),
});

export const csrAgencyQuery = z.object({
  search: z.string().trim().max(100).optional(),
});

export type CreateCsrProgramInput = z.infer<typeof createCsrProgramBody>;
export type UpdateCsrProgramInput = z.infer<typeof updateCsrProgramBody>;
export type SaveCorporateFinancialInput = z.infer<typeof saveCorporateFinancialBody>;

// ── documents (annual reports, attachments) — multipart: file + these fields ─

export const uploadDocumentBody = z.object({
  typeId: z.string().uuid("Document type is required"),
  fy: fyText,
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentBody>;

