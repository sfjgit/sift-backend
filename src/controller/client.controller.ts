// File: client.controller.ts
// Path: src/controller/client.controller.ts

import crypto from "crypto";
import { Request, Response } from "express";
import { ClientActivityType, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, getReportingLineIds, spocTaggedVisibleTo, spocWhereForUserId } from "@/services/scope.service";
import { assertLookupIds, assertLookups } from "@/services/lookup.service";
import { logClientActivity } from "@/services/clientActivity.service";
import { notifyUsers } from "@/services/notification.service";
import { definedOnly, pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError, notFound } from "@/utils/httpError";
import { deleteFromS3, getSignedUrl, uploadToS3 } from "@/lib/s3";
import { normaliseLocation } from "@/services/geo.service";
import { logWebsiteChange, websiteStates } from "@/services/website.service";
import { syncCsrSnapshot } from "@/services/csrSnapshot.service";
import { CSR_PROGRAM_SELECT } from "@/services/csrProgram.service";
import type {
  BulkClientStatusInput,
  CreateClientInput,
  CreateLocationInput,
  UpdateLocationInput,
  ListClientsQuery,
  ClientFacetsQuery,
  ClientFigure,
  SaveCorporateFinancialInput,
  SaveCsrFinancialInput,
  UpdateClientInput,
  UploadDocumentInput,
} from "@/validators/client.validators";
import { CLIENT_FIGURES } from "@/validators/client.validators";
import { assertFillOnly, assertSuperAdmin } from "@/services/editLock.service";
import { ADDON_SELECT, clientValuesForLock, flattenClient, saveAddons, splitClientInput } from "@/services/clientAddons.service";

const PERSON = { id: true, firstName: true, lastName: true } as const;
const NOTE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  editedAt: true,
  section: true,
  author: { select: PERSON },
  spoc: { select: PERSON },
} as const satisfies Prisma.ClientNoteSelect;
const LOOKUP = { id: true, code: true, label: true } as const;
const ORG = { id: true, name: true, code: true } as const;

// branch offices = every active office except the head office (the primary one,
// or one typed HQ) — on the list, the profile and the "has branches" filter
const BRANCHES = {
  where: {
    isActive: true,
    isPrimary: false,
    OR: [{ typeId: null }, { type: { code: { not: "HQ" } } }],
  },
} satisfies { where: Prisma.ClientLocationWhereInput };

const CLIENT_LIST_SELECT = {
  id: true,
  entityType: true,
  name: true,
  shortName: true,
  website: true,
  linkedinUrl: true,
  // the organisation's own office contact
  email: true,
  phone: true,
  status: true,
  employeeCount: true,
  employeeSize: { select: LOOKUP },
  csrFy: true,
  csrSpentRs: true,
  createdAt: true,
  updatedAt: true,
  industry: { select: LOOKUP },
  category: { select: LOOKUP },
  businessUnit: { select: ORG },
  // the client's service lines = the lines of its active SPOCs (automatic; flattenClient → serviceLines)
  spocs: { where: { isActive: true }, select: { serviceLine: { select: ORG } }, distinct: ["serviceLineId"] },
  createdBy: { select: PERSON },
  // who works the client (set by super admin / clients.assign)
  assignments: {
    where: { endedAt: null },
    select: { assignedAt: true, user: { select: PERSON } },
    orderBy: { assignedAt: "asc" },
  },
  // primary address for the list row
  locations: {
    where: { isPrimary: true, isActive: true },
    select: {
      id: true,
      addressLine: true,
      city: true,
      district: true,
      state: true,
      country: true,
      pincode: true,
    },
    take: 1,
  },
  _count: { select: { spocs: { where: { isActive: true } }, locations: BRANCHES } },
  // add-ons (registration, CSR, govt) + company group — flattened by flattenClient()
  ...ADDON_SELECT,
  // sales marks
  projectIds: true,
  projectSetAt: true,
  projectSetBy: { select: PERSON },
  keyAccounts: { select: { createdAt: true, user: { select: PERSON } }, orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.ClientSelect;

// list rows also carry what the CRM holds and the last pipeline run
const COVERAGE_SELECT = {
  _count: {
    select: {
      spocs: { where: { isActive: true } },
      locations: BRANCHES,
      documents: true,
      csrFinancials: true,
      csrPrograms: true,
      outreachPacks: true,
    },
  },
  stepRuns: {
    where: { parentRunId: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, status: true, note: true, createdAt: true, step: { select: { key: true, label: true } } },
  },
} as const satisfies Prisma.ClientSelect;

// extra list columns (each one a column the user can switch on); figures and
// files only with their read permission, like the client page
const LIST_EXTRA_SELECT = {
  approvedAt: true,
  approvedBy: { select: PERSON },
  technologies: { select: { details: true, category: { select: LOOKUP } } },
} as const satisfies Prisma.ClientSelect;

const LIST_FIGURES_SELECT = {
  csrFinancials: {
    orderBy: { fy: "desc" },
    take: 1,
    select: { fy: true, obligationRs: true, budgetRs: true, spentRs: true, unspentRs: true },
  },
  corporateFinancials: {
    orderBy: { fy: "desc" },
    take: 1,
    select: { fy: true, revenueRs: true, netProfitRs: true, netWorthRs: true, paidUpCapitalRs: true, authorisedCapitalRs: true },
  },
} as const satisfies Prisma.ClientSelect;

const LIST_DOCUMENTS_SELECT = {
  documents: { select: { id: true, fy: true, type: { select: LOOKUP } }, orderBy: { fy: "desc" } },
} as const satisfies Prisma.ClientSelect;

const MISSING_WHERE: Record<string, Prisma.ClientWhereInput> = {
  website: { OR: [{ website: null }, { website: "" }] },
  reports: { documents: { none: {} } },
  spocs: { spocs: { none: { isActive: true } } },
  approved: { spocs: { none: { isActive: true, approvalStatus: "APPROVED" } } },
  figures: { csrFinancials: { none: {} } },
  outreach: { outreachPacks: { none: {} } },
};

const PIPELINE_WHERE: Record<string, Prisma.ClientWhereInput> = {
  never: { stepRuns: { none: {} } },
  run: { stepRuns: { some: {} } },
  failed: { stepRuns: { some: { parentRunId: null, status: { in: ["FAILED", "DISPATCH_FAILED", "TIMED_OUT"] } } } },
};

const LOCATION_SELECT = {
  id: true,
  name: true,
  addressLine: true,
  city: true,
  district: true,
  state: true,
  country: true,
  pincode: true,
  latitude: true,
  longitude: true,
  isPrimary: true,
  isActive: true,
  dmEvidence: true,
  createdAt: true,
  type: { select: LOOKUP },
  addedBy: { select: PERSON },
  _count: { select: { spocs: { where: { isActive: true } } } },
} as const satisfies Prisma.ClientLocationSelect;

const TECHNOLOGY_SELECT = {
  id: true,
  details: true,
  updatedAt: true,
  category: { select: LOOKUP },
  addedBy: { select: PERSON },
} as const satisfies Prisma.ClientTechnologySelect;

const CLIENT_DETAIL_SELECT = {
  ...CLIENT_LIST_SELECT,
  linkedinEmployees: true,
  approvedAt: true,
  approvedBy: { select: PERSON },
  locations: {
    where: { isActive: true },
    select: LOCATION_SELECT,
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  technologies: { select: TECHNOLOGY_SELECT, orderBy: { createdAt: "asc" } },
  notes: {
    select: NOTE_SELECT,
    orderBy: { createdAt: "desc" },
  },
} as const satisfies Prisma.ClientSelect;

// field groups added to the detail only with their own read permission
const DOCUMENTS_SELECT = {
  documents: {
    select: {
      id: true,
      fy: true,
      fileKey: true,
      fileName: true,
      sourceUrl: true,
      createdAt: true,
      type: { select: LOOKUP },
    },
    orderBy: { fy: "desc" },
  },
} as const satisfies Prisma.ClientSelect;

const PROGRAMS_SELECT = {
  csrPrograms: { select: CSR_PROGRAM_SELECT, orderBy: [{ fy: "desc" }, { name: "asc" }] },
} as const satisfies Prisma.ClientSelect;

const FINANCIAL_SELECT = {
  id: true,
  fy: true,
  obligationRs: true,
  budgetRs: true,
  spentRs: true,
  unspentRs: true,
  evidence: true,
  confidence: true,
  isLocked: true,
  updatedAt: true,
} as const satisfies Prisma.ClientCsrFinancialSelect;

const CORPORATE_SELECT = {
  id: true,
  fy: true,
  revenueRs: true,
  netProfitRs: true,
  paidUpCapitalRs: true,
  authorisedCapitalRs: true,
  netWorthRs: true,
  source: true,
  isLocked: true,
  updatedAt: true,
} as const satisfies Prisma.ClientCorporateFinancialSelect;

// a SPOC named in a note / task / log must be one of this client's
export const assertSpocOfClient = async (clientId: string, spocId: string | null | undefined) => {
  if (!spocId) return null;
  const spoc = await prisma.clientSpoc.findFirst({
    where: { id: spocId, clientId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!spoc) throw ApiError(400, "That SPOC is not on this client", "INVALID_SPOC");
  return spoc;
};

// client by id within the caller's scope for this action — out of scope = 404
export const findClientInScope = async (req: Request, id: string) => {
  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    select: { id: true, name: true, status: true, approvedById: true },
  });
  if (!client) throw notFound("Client");
  return client;
};

// BU and service lines must exist and be active
const assertOrg = async (businessUnitId?: string | null, serviceLineIds?: string[]) => {
  if (businessUnitId) {
    const bu = await prisma.businessUnit.findFirst({ where: { id: businessUnitId, isActive: true } });
    if (!bu) throw ApiError(400, "Unknown or inactive business unit", "INVALID_BU");
  }
  if (serviceLineIds?.length) {
    const n = await prisma.serviceLine.count({ where: { id: { in: serviceLineIds }, isActive: true } });
    if (n !== new Set(serviceLineIds).size) {
      throw ApiError(400, "Unknown or inactive service line", "INVALID_SL");
    }
  }
};

// a head count without a band picks it: lookup EMPLOYEE_SIZE, meta { min, max } inclusive
const employeeBandFor = async (count: number) => {
  const bands = await prisma.lookup.findMany({
    where: { type: "EMPLOYEE_SIZE", isActive: true },
    select: { id: true, meta: true },
  });
  const hit = bands.find((b) => {
    const m = (b.meta ?? {}) as { min?: unknown; max?: unknown };
    const max = m.max === null || m.max === undefined ? Infinity : Number(m.max);
    return count >= Number(m.min) && count <= max;
  });
  return hit?.id ?? null;
};

const withEmployeeBand = async <T extends { employeeCount?: number | null | undefined; employeeSizeId?: string | null | undefined }>(
  b: T,
): Promise<T> =>
  typeof b.employeeCount === "number" && !b.employeeSizeId
    ? { ...b, employeeSizeId: await employeeBandFor(b.employeeCount) }
    : b;

const serviceLinesData = (ids: string[]) => ({
  create: [...new Set(ids)].map((serviceLineId) => ({ serviceLineId })),
});

const CRORE = 10_000_000;

// India-time day bounds for date filters: from = start of that day, to = end of it
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);
const range = (from?: string, to?: string) =>
  from || to ? { ...(from && { gte: dayStart(from) }), ...(to && { lt: dayEnd(to) }) } : undefined;

// Each filter is its own AND clause, so two filters on one relation never
// overwrite each other. Multi values match any of them, except "missing" and
// "steps done" (every picked one must hold).
// ── latest-FY figures (CSR fund, revenue, paid-up capital …) — the value the list shows is the newest year's row
const figureJoin = (f: ClientFigure) => {
  const [table, col] = CLIENT_FIGURES[f];
  return Prisma.sql`LEFT JOIN LATERAL (SELECT x."${Prisma.raw(col)}" AS v FROM "${Prisma.raw(table)}" x WHERE x."clientId" = c."id" ORDER BY x."fy" DESC LIMIT 1) l ON true`;
};
/** clients whose latest value of a figure is within [min, max] rupees */
const figureRangeIds = async (f: ClientFigure, min?: number, max?: number) => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "Client" c ${figureJoin(f)}
    WHERE c."deletedAt" IS NULL AND l.v IS NOT NULL
      ${min !== undefined ? Prisma.sql`AND l.v >= ${min}` : Prisma.empty}
      ${max !== undefined ? Prisma.sql`AND l.v <= ${max}` : Prisma.empty}`;
  return rows.map((r) => r.id);
};
/** one page of client ids ordered by a figure's latest value (blanks last) */
const figureSortedIds = async (ids: string[], f: ClientFigure, dir: "asc" | "desc", skip: number, take: number) => {
  if (!ids.length) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "Client" c ${figureJoin(f)}
    WHERE c."id" = ANY(${ids}::text[])
    ORDER BY l.v ${Prisma.raw(dir === "asc" ? "ASC" : "DESC")} NULLS LAST, c."name" ASC
    OFFSET ${skip} LIMIT ${take}`;
  return rows.map((r) => r.id);
};
const isFigure = (k: string): k is ClientFigure => k in CLIENT_FIGURES;

const clientFilterWhere = async (q: ListClientsQuery, me: string): Promise<Prisma.ClientWhereInput[]> => {
  // "team" = assigned to me or to anyone below me in the reporting line (mobile app's My team)
  if (q.assignedTo === "team") {
    q = { ...q, assignedTo: undefined, assignedToId: [...(q.assignedToId ?? []), me, ...(await getReportingLineIds(me))] };
  }
  const and: Prisma.ClientWhereInput[] = [];
  const any = <T,>(v: T[] | undefined) => (v?.length ? v : undefined);

  if (any(q.status)) and.push({ status: { in: q.status! } });
  // column searches — contains, any case
  for (const f of ["name", "shortName", "website"] as const) {
    if (q[f]) and.push({ [f]: { contains: q[f], mode: "insensitive" } });
  }
  if (q.cin) and.push({ registration: { cin: { contains: q.cin, mode: "insensitive" } } });
  if (any(q.csrFy)) and.push({ csrFy: { in: q.csrFy! } });
  if (any(q.groupName)) and.push({ groupName: { in: q.groupName! } });
  if (any(q.ownership)) and.push({ registration: { ownership: { in: q.ownership! } } });
  if (any(q.csrRoleId)) and.push({ csr: { csrRoleId: { in: q.csrRoleId! } } });
  if (any(q.govtLevel)) and.push({ govt: { level: { in: q.govtLevel! } } });
  if (any(q.govtOrgTypeId)) and.push({ govt: { orgTypeId: { in: q.govtOrgTypeId! } } });
  if (q.employeeMin !== undefined || q.employeeMax !== undefined)
    and.push({ employeeCount: { ...(q.employeeMin !== undefined && { gte: q.employeeMin }), ...(q.employeeMax !== undefined && { lte: q.employeeMax }) } });
  for (const f of Object.keys(CLIENT_FIGURES) as ClientFigure[]) {
    const min = q[`${f}MinCr`], max = q[`${f}MaxCr`];
    if (min === undefined && max === undefined) continue;
    and.push({ id: { in: await figureRangeIds(f, min === undefined ? undefined : min * CRORE, max === undefined ? undefined : max * CRORE) } });
  }
  if (any(q.entityType)) and.push({ entityType: { in: q.entityType! } });
  if (any(q.employeeSizeId)) and.push({ employeeSizeId: { in: q.employeeSizeId! } });
  if (q.csrSpentMinCr !== undefined || q.csrSpentMaxCr !== undefined) {
    and.push({
      csrSpentRs: {
        ...(q.csrSpentMinCr !== undefined && { gte: q.csrSpentMinCr * CRORE }),
        ...(q.csrSpentMaxCr !== undefined && { lte: q.csrSpentMaxCr * CRORE }),
      },
    });
  }
  if (q.hasBranches !== undefined) {
    and.push({ locations: q.hasBranches ? { some: BRANCHES.where } : { none: BRANCHES.where } });
  }
  if (any(q.industryId)) and.push({ industryId: { in: q.industryId! } });
  if (any(q.categoryId)) and.push({ categoryId: { in: q.categoryId! } });
  if (any(q.businessUnitId)) and.push({ businessUnitId: { in: q.businessUnitId! } });
  if (any(q.serviceLineId)) and.push({ spocs: { some: { isActive: true, serviceLineId: { in: q.serviceLineId! } } } });
  if (any(q.createdById)) and.push({ createdById: { in: q.createdById! } });
  if (any(q.handlerId)) and.push({ spocs: { some: { isActive: true, handlerId: { in: q.handlerId! } } } });

  // assignment: to whom and by whom match the same active assignment
  if (q.assignedTo === "none") and.push({ assignments: { none: { endedAt: null } } });
  const to = [...(q.assignedToId ?? []), ...(q.assignedTo === "me" ? [me] : q.assignedTo && q.assignedTo !== "none" ? [q.assignedTo] : [])];
  if (to.length || any(q.assignedById)) {
    and.push({
      assignments: {
        some: {
          endedAt: null,
          ...(to.length && { userId: { in: to } }),
          ...(any(q.assignedById) && { assignedById: { in: q.assignedById! } }),
        },
      },
    });
  }

  for (const gap of q.missing ?? []) and.push(MISSING_WHERE[gap]!);
  if (q.pipeline) and.push(PIPELINE_WHERE[q.pipeline]!);
  for (const key of q.stepsDone ?? []) and.push({ stepRuns: { some: { status: "DONE", step: { key } } } });
  if (any(q.stepsNotDone)) and.push({ stepRuns: { none: { status: "DONE", step: { key: { in: q.stepsNotDone! } } } } });
  if (any(q.outreachStatus)) and.push({ outreachPacks: { some: { status: { in: q.outreachStatus! } } } });

  const created = range(q.createdFrom, q.createdTo);
  if (created) and.push({ createdAt: created });
  const ran = range(q.lastRunFrom, q.lastRunTo);
  if (ran) and.push({ stepRuns: { some: { parentRunId: null, createdAt: ran } } });

  // names are stored normalised ("Bengaluru"); case-insensitive for old rows
  const anyOf = (field: "country" | "state" | "city", vals?: string[]): Prisma.ClientLocationWhereInput[] =>
    vals?.length ? [{ OR: vals.map((v) => ({ [field]: { equals: v, mode: "insensitive" } })) }] : [];
  const loc = [
    ...anyOf("country", q.country),
    ...anyOf("state", q.state),
    ...anyOf("city", q.city),
    ...(q.district ? [{ district: { contains: q.district, mode: "insensitive" as const } }] : []),
    ...(q.address ? [{ addressLine: { contains: q.address, mode: "insensitive" as const } }] : []),
    ...(q.pincode ? [{ pincode: { startsWith: q.pincode } }] : []),
  ];
  if (loc.length) and.push({ locations: { some: { isActive: true, AND: loc } } });

  // CSR programmes: "spends on education in Karnataka through Akshaya Patra"
  const prog: Prisma.ClientCsrProgramWhereInput[] = [];
  if (any(q.programSectorId)) prog.push({ sectors: { some: { sectorId: { in: q.programSectorId! } } } });
  if (any(q.programState) || q.programDistrict)
    prog.push({
      locations: {
        some: {
          ...(any(q.programState) && {
            OR: q.programState!.map((v) => ({ state: { equals: v, mode: "insensitive" as const } })),
          }),
          ...(q.programDistrict && { district: { equals: q.programDistrict, mode: "insensitive" } }),
        },
      },
    });
  if (q.programAgency)
    prog.push({
      agency: {
        OR: [
          { name: { contains: q.programAgency, mode: "insensitive" } },
          { registrationNo: { equals: q.programAgency.toUpperCase() } },
        ],
      },
    });
  if (prog.length) and.push({ csrPrograms: { some: { AND: prog } } });

  // sales marks
  if (q.keyAccount === "me") and.push({ keyAccounts: { some: { userId: me } } });
  if (q.keyAccount === "any") and.push({ keyAccounts: { some: {} } });
  if (q.keyAccount === "none") and.push({ keyAccounts: { none: {} } });
  if (q.csrEligible)
    and.push(
      q.csrEligible === "unset"
        ? { OR: [{ csr: null }, { csr: { csrEligible: null } }] }
        : { csr: { csrEligible: q.csrEligible === "yes" } },
    );
  if (any(q.projectId)) and.push({ projectIds: { hasSome: q.projectId! } });

  if (q.search) {
    and.push({
      OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { shortName: { contains: q.search, mode: "insensitive" } },
        { registration: { cin: { contains: q.search, mode: "insensitive" } } },
      ],
    });
  }
  return and;
};

// ── GET /clients
// pick-list columns sort by the label people see, not the id
const RELATION_SORT: Partial<Record<ListClientsQuery["sortBy"], "industry" | "category" | "employeeSize">> = {
  industry: "industry",
  category: "category",
  employeeSize: "employeeSize",
};

export const listClients = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListClientsQuery;
  const canFigures = !!req.permissions!["client_financials.read"];
  // no figures permission: CSR spend can't be used to filter or sort either
  if (!canFigures) {
    delete q.csrSpentMinCr;
    delete q.csrSpentMaxCr;
    if (q.sortBy === "csrSpentRs" || q.sortBy === "csrFy" || isFigure(q.sortBy)) q.sortBy = "createdAt";
    for (const f of Object.keys(CLIENT_FIGURES) as ClientFigure[]) { delete q[`${f}MinCr`]; delete q[`${f}MaxCr`]; }
  }
  // programme filters need programme access
  if (!req.permissions!["client_programs.read"]) {
    delete q.programSectorId;
    delete q.programState;
    delete q.programDistrict;
    delete q.programAgency;
  }

  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    AND: [await clientScopeWhere(req.user, req.scope!), ...(await clientFilterWhere(q, req.user.id))],
  };

  // figure sorts (latest-FY CSR fund, revenue …) can't be a Prisma orderBy: order the matching ids in SQL, then load that page
  const figureSort = isFigure(q.sortBy) ? q.sortBy : null;
  const pageIds = figureSort
    ? await figureSortedIds(
        (await prisma.client.findMany({ where, select: { id: true } })).map((r) => r.id),
        figureSort, q.sortDir, toSkipTake(q).skip, toSkipTake(q).take,
      )
    : null;
  const [total, unordered] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where: pageIds ? { id: { in: pageIds } } : where,
      select: {
        ...CLIENT_LIST_SELECT,
        ...COVERAGE_SELECT,
        ...LIST_EXTRA_SELECT,
        ...(canFigures && LIST_FIGURES_SELECT),
        ...(req.permissions!["client_documents.read"] && LIST_DOCUMENTS_SELECT),
      },
      // figures sort with blanks last, whichever direction
      // (a figure-sorted page is re-ordered below)
      orderBy: pageIds
        ? { name: "asc" }
        : q.sortBy === "csrFy"
          ? // latest CSR year, then the bigger spend within a year
            [
              { csrFy: { sort: q.sortDir, nulls: "last" } },
              { csrSpentRs: { sort: "desc", nulls: "last" } },
              { name: "asc" },
            ]
          : q.sortBy === "cin"
            ? [{ registration: { cin: q.sortDir } }, { name: "asc" }]
          : q.sortBy === "csrSpentRs" || q.sortBy === "employeeCount" || q.sortBy === "shortName"
            ? [{ [q.sortBy]: { sort: q.sortDir, nulls: "last" } }, { name: "asc" }]
            : RELATION_SORT[q.sortBy]
              ? [{ [RELATION_SORT[q.sortBy]!]: { label: q.sortDir } }, { name: "asc" }]
              : q.sortBy === "businessUnit"
                ? [{ businessUnit: { name: q.sortDir } }, { name: "asc" }]
                : { [q.sortBy]: q.sortDir },
      ...(pageIds ? {} : toSkipTake(q)),
    }),
  ]);
  const rows = pageIds ? pageIds.flatMap((id) => unordered.filter((r) => r.id === id)) : unordered;

  // approved SPOCs + sent packs for this page in two grouped queries
  const ids = rows.map((r) => r.id);
  const mine = await spocWhereForUserId(req.user.id);
  const [approved, sent, stepRows, visible] = await Promise.all([
    prisma.clientSpoc.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, isActive: true, approvalStatus: "APPROVED" },
      _count: true,
    }),
    prisma.outreachPack.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, status: { notIn: ["DRAFT", "REVIEWED"] } },
      _count: true,
    }),
    // latest run per step per client — the step columns of the list
    prisma.stepRun.findMany({
      where: { clientId: { in: ids } },
      distinct: ["clientId", "stepId"],
      orderBy: { createdAt: "desc" },
      select: {
        id: true, clientId: true, status: true, note: true, createdAt: true,
        step: { select: { key: true } },
        requestedBy: { select: PERSON },
      },
    }),
    prisma.clientSpoc.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, isActive: true, ...mine },
      _count: true,
    }),
  ]);
  const visibleBy = new Map(visible.map((v) => [v.clientId, v._count]));
  const websiteBy = await websiteStates(ids);
  const stepsBy = new Map<string, Record<string, Omit<(typeof stepRows)[number], "clientId" | "step">>>();
  for (const { clientId, step, ...r } of stepRows) {
    const m = stepsBy.get(clientId) ?? {};
    m[step.key] = r;
    stepsBy.set(clientId, m);
  }
  const approvedBy = new Map(approved.map((a) => [a.clientId, a._count]));
  const sentBy = new Map(sent.map((a) => [a.clientId, a._count]));

  const clients = rows.map(({ stepRuns, _count, ...c }) => ({
    ...flattenClient(c),
    // the CSR snapshot is a figure too
    ...(!canFigures && { csrSpentRs: null, csrFy: null }),
    // SPOCs column = the ones this user sees; coverage = what the CRM holds in total
    _count: { spocs: visibleBy.get(c.id) ?? 0, branches: _count.locations },
    coverage: {
      reports: _count.documents,
      spocs: _count.spocs,
      approvedSpocs: approvedBy.get(c.id) ?? 0,
      figureYears: _count.csrFinancials,
      programs: _count.csrPrograms,
      outreachPacks: _count.outreachPacks,
      outreachSent: sentBy.get(c.id) ?? 0,
      lastRun: stepRuns[0] ?? null,
      steps: stepsBy.get(c.id) ?? {},
      // a website request waiting for an admin, or who changed the website lately
      website: websiteBy.get(c.id) ?? null,
    },
  }));

  res.json({ success: true, data: clients, meta: pageMeta(total, q.page, q.limit) });
};

// ── GET /clients/facets?field= — one column's values + how many clients have each.
// Every other filter (and the user's scope) applies; the column's own filter doesn't, so you can add more values.
const FACET_FILTER: Record<ClientFacetsQuery["field"], keyof ListClientsQuery> = {
  groupName: "groupName", ownership: "ownership", csrRoleId: "csrRoleId", govtLevel: "govtLevel", govtOrgTypeId: "govtOrgTypeId",
  status: "status", entityType: "entityType", industryId: "industryId", categoryId: "categoryId",
  employeeSizeId: "employeeSizeId", businessUnitId: "businessUnitId", serviceLineId: "serviceLineId",
  csrFy: "csrFy", createdById: "createdById", assignedToId: "assignedToId", projectId: "projectId",
  country: "country", state: "state", city: "city",
};
export const clientFacets = async (req: Request, res: Response) => {
  const { field, q: search, ...q } = req.validatedQuery as ClientFacetsQuery;
  if (field === "csrFy" && !req.permissions!["client_financials.read"]) return void res.json({ success: true, data: [] });
  delete (q as Partial<ListClientsQuery>)[FACET_FILTER[field]];
  if (!req.permissions!["client_financials.read"]) { delete q.csrSpentMinCr; delete q.csrSpentMaxCr; }
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    AND: [await clientScopeWhere(req.user, req.scope!), ...(await clientFilterWhere(q as ListClientsQuery, req.user.id))],
  };
  let counts: { value: string | null; count: number }[];
  if (field === "serviceLineId") {
    // a client counts once per line its active SPOCs have
    const rows = await prisma.clientSpoc.findMany({
      where: { client: where, isActive: true },
      select: { clientId: true, serviceLineId: true },
      distinct: ["clientId", "serviceLineId"],
    });
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.serviceLineId, (m.get(r.serviceLineId) ?? 0) + 1);
    counts = [...m].map(([value, count]) => ({ value, count }));
    counts.push({ value: null, count: await prisma.client.count({ where: { AND: [where, { spocs: { none: { isActive: true } } }] } }) });
  } else if (field === "ownership" || field === "csrRoleId" || field === "govtLevel" || field === "govtOrgTypeId") {
    // add-on fields: count per value on the matching clients' add-on rows
    const rows =
      field === "ownership"
        ? (await prisma.clientRegistration.findMany({ where: { client: where }, select: { ownership: true } })).map((r) => r.ownership as string | null)
        : field === "csrRoleId"
          ? (await prisma.clientCsr.findMany({ where: { client: where }, select: { csrRoleId: true } })).map((r) => r.csrRoleId)
          : field === "govtLevel"
            ? (await prisma.clientGovt.findMany({ where: { client: where }, select: { level: true } })).map((r) => r.level as string | null)
            : (await prisma.clientGovt.findMany({ where: { client: where }, select: { orgTypeId: true } })).map((r) => r.orgTypeId);
    const m = new Map<string | null, number>();
    for (const v of rows) m.set(v, (m.get(v) ?? 0) + 1);
    counts = [...m].map(([value, count]) => ({ value, count }));
  } else if (field === "assignedToId") {
    // people with an active assignment on the matching clients
    const g = await prisma.clientAssignment.groupBy({ by: ["userId"], where: { client: where, endedAt: null }, _count: { clientId: true } });
    counts = g.map((r) => ({ value: r.userId, count: r._count.clientId }));
    counts.push({ value: null, count: await prisma.client.count({ where: { AND: [where, { assignments: { none: { endedAt: null } } }] } }) });
  } else if (field === "projectId") {
    const m = new Map<string, number>();
    let none = 0;
    for (const r of await prisma.client.findMany({ where, select: { projectIds: true } })) {
      if (!r.projectIds.length) none++;
      for (const p of r.projectIds) m.set(p, (m.get(p) ?? 0) + 1);
    }
    counts = [...m].map(([value, count]) => ({ value, count }));
    counts.push({ value: null, count: none });
  } else if (field === "country" || field === "state" || field === "city") {
    // a client counts once per place, however many offices it has there
    const rows = await prisma.clientLocation.findMany({
      where: { client: where, isActive: true, [field]: { not: null } },
      select: { clientId: true, [field]: true },
      distinct: ["clientId", field],
    });
    const m = new Map<string, number>();
    for (const r of rows as unknown as Record<string, string>[]) m.set(r[field]!, (m.get(r[field]!) ?? 0) + 1);
    counts = [...m].map(([value, count]) => ({ value, count }));
  } else {
    const g = await prisma.client.groupBy({ by: [field], where, _count: true });
    counts = g.map((r) => ({ value: (r as Record<string, unknown>)[field] as string | null, count: r._count as number }));
  }
  // labels for ids
  const ids = counts.map((c) => c.value).filter((v): v is string => !!v);
  const labels = new Map<string, string>();
  if (field === "industryId" || field === "categoryId" || field === "employeeSizeId" || field === "projectId" || field === "csrRoleId" || field === "govtOrgTypeId")
    for (const l of await prisma.lookup.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })) labels.set(l.id, l.label);
  if (field === "businessUnitId")
    for (const b of await prisma.businessUnit.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) labels.set(b.id, b.name);
  if (field === "serviceLineId")
    for (const b of await prisma.serviceLine.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) labels.set(b.id, b.name);
  if (field === "createdById" || field === "assignedToId")
    for (const u of await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true } }))
      labels.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email);
  const data = counts
    .filter((c) => c.count > 0)
    .map((c) => ({ value: c.value, label: c.value ? (labels.get(c.value) ?? c.value) : null, count: c.count }))
    // search inside the values (the box at the top of the list)
    .filter((c) => !search || (c.label ?? "").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
    .slice(0, 500);
  res.json({ success: true, data });
};

// ── GET /clients/:id — SPOCs come from GET /spocs?clientId=
export const getClientById = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const map = req.permissions!;

  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    select: {
      ...CLIENT_DETAIL_SELECT,
      ...(map["client_documents.read"] && DOCUMENTS_SELECT),
      ...(map["client_programs.read"] && PROGRAMS_SELECT),
      ...(map["client_financials.read"] && {
        csrFinancials: { select: FINANCIAL_SELECT, orderBy: { fy: "desc" } },
        corporateFinancials: { select: CORPORATE_SELECT, orderBy: { fy: "desc" } },
      }),
    },
  });
  if (!client) throw notFound("Client");

  // SPOC count = the ones this user may see (others' SPOCs stay hidden)
  const spocs = await prisma.clientSpoc.count({
    where: { clientId: id, isActive: true, ...(await spocWhereForUserId(req.user.id)) },
  });
  res.json({
    success: true,
    data: { ...flattenClient(client), _count: { spocs, branches: client._count.locations }, spocsTotal: client._count.spocs },
  });
};

// ── POST /clients — starts PENDING until approved
export const createClient = async (req: Request, res: Response) => {
  const body = await withEmployeeBand(req.validatedBody as CreateClientInput);

  await assertLookups({
    industryId: [body.industryId, "INDUSTRY"],
    categoryId: [body.categoryId, "CLIENT_CATEGORY"],
    employeeSizeId: [body.employeeSizeId, "EMPLOYEE_SIZE"],
  });
  await assertOrg(body.businessUnitId);
  await assertLookupIds(body.projectIds, "PROJECT", "projectIds");
  await assertLookups({ csrRoleId: [body.csrRoleId, "CSR_ROLE"], orgTypeId: [body.govt?.orgTypeId, "GOVT_ORG_TYPE"] });
  // core client fields vs the add-ons (registration / CSR / govt)
  const parts = splitClientInput(body as Record<string, unknown>);

  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        ...(definedOnly(parts.core) as Omit<Prisma.ClientUncheckedCreateInput, "tenantId" | "createdById">),
        tenantId: req.user.tenantId,
        createdById: req.user.id,
        ...(body.projectIds?.length && { projectSetById: req.user.id, projectSetAt: new Date() }),
      },
      select: { id: true },
    });
    await saveAddons(tx, created.id, parts, req.user.id);
    const c = await tx.client.findUniqueOrThrow({ where: { id: created.id }, select: CLIENT_LIST_SELECT });

    await logClientActivity(tx, {
      clientId: c.id,
      actorId: req.user.id,
      type: "CLIENT_CREATED",
      summary: `Client "${c.name}" created`,
    });

    return c;
  });

  res.status(201).json({ success: true, message: "Client created", data: flattenClient(client) });
};

// ── PATCH /clients/:id
export const updateClient = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = await withEmployeeBand(req.validatedBody as UpdateClientInput);

  await findClientInScope(req, id);
  await assertLookups({
    industryId: [body.industryId, "INDUSTRY"],
    categoryId: [body.categoryId, "CLIENT_CATEGORY"],
    employeeSizeId: [body.employeeSizeId, "EMPLOYEE_SIZE"],
  });
  await assertOrg(body.businessUnitId);
  await assertLookupIds(body.projectIds, "PROJECT", "projectIds");
  await assertLookups({ csrRoleId: [body.csrRoleId, "CSR_ROLE"], orgTypeId: [body.govt?.orgTypeId, "GOVT_ORG_TYPE"] });

  const parts = splitClientInput(body as Record<string, unknown>);
  const fields = parts.core;
  const was = await clientValuesForLock(id);
  const before = was?.core as { website?: string | null } | undefined;
  // filled data: only a super admin changes it (sales marks + status are work, not data) — core and each add-on
  if (was) {
    assertFillOnly(req.user, was.core, fields, ["status", "projectIds", "website"]);
    assertFillOnly(req.user, was.registration, parts.registration);
    assertFillOnly(req.user, was.csr, parts.csr, ["csrEligible"]);
    assertFillOnly(req.user, was.govt, parts.govt, ["priority"]);
  }
  const websiteChanged = body.website !== undefined && (body.website ?? "") !== (before?.website ?? "");
  // a typed website can't be trusted: only an admin changes it (others use the website check)
  if (websiteChanged && !req.user.isSuperAdmin) {
    throw ApiError(403, "Only an admin can change the website. If it does not open, run a step — the website check finds the current one.", "ADMIN_ONLY");
  }
  const data = definedOnly(fields) as Prisma.ClientUpdateInput;
  const addonData = { ...definedOnly(parts.registration), ...definedOnly(parts.csr), ...(Object.keys(parts.govt).length && { govt: parts.govt }) };
  const changed = [...Object.keys(data), ...Object.keys(addonData)];

  const updated = await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id },
      data: {
        ...(data as Prisma.ClientUncheckedUpdateInput),
        ...(body.projectIds !== undefined && { projectSetById: req.user.id, projectSetAt: new Date() }),
      } as Prisma.ClientUncheckedUpdateInput,
      select: { id: true },
    });
    await saveAddons(tx, id, parts, req.user.id);
    const c = await tx.client.findUniqueOrThrow({ where: { id }, select: CLIENT_LIST_SELECT });

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `Updated ${changed.join(", ")}`,
      meta: JSON.parse(JSON.stringify({ changes: { ...data, ...addonData } })) as Prisma.InputJsonValue,
    });
    if (websiteChanged) {
      await logWebsiteChange(tx, { clientId: id, actorId: req.user.id, old: before?.website ?? null, new: body.website ?? null, via: "edit" });
    }

    return c;
  });

  res.json({ success: true, message: "Client updated", data: flattenClient(updated) });
};

// ── PATCH /clients/:id/status — first activation stamps approver
export const updateClientStatus = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { status } = req.validatedBody;

  const existing = await prisma.client.findFirst({
    where: { id, deletedAt: null },
    select: { status: true, approvedById: true },
  });
  if (!existing) throw notFound("Client");

  const firstApproval = status === "ACTIVE" && !existing.approvedById;

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.client.update({
      where: { id },
      data: {
        status,
        ...(firstApproval && { approvedById: req.user.id, approvedAt: new Date() }),
      },
      select: { id: true, name: true, status: true, approvedAt: true },
    });

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: firstApproval ? "CLIENT_APPROVED" : "CLIENT_UPDATED",
      summary: `Status ${existing.status} → ${status}`,
    });

    return c;
  });

  res.json({ success: true, message: `Client ${status.toLowerCase()}`, data: updated });
};

// ── DELETE /clients/:id — soft delete
export const deleteClient = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "delete a client");
  const { id } = req.validatedParams;
  const client = await findClientInScope(req, id);

  await prisma.$transaction([
    prisma.client.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        tenantId: req.user.tenantId,
        actorId: req.user.id,
        action: "DELETE",
        module: "clients",
        recordId: id,
        oldData: { name: client.name },
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    }),
  ]);

  res.json({ success: true, message: "Client deleted" });
};

// ── GET /clients/:id/activities
export const listClientActivities = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const q = req.validatedQuery as { page: number; limit: number; spocId?: string; type?: ClientActivityType[] };
  await findClientInScope(req, id);

  // activity on someone else's SPOC stays with them
  const where: Prisma.ClientActivityWhereInput = {
    clientId: id,
    ...(q.spocId && { spocId: q.spocId }),
    ...(q.type?.length && { type: { in: q.type } }),
    ...(await spocTaggedVisibleTo(req.user.id)),
  };
  const [total, rows] = await Promise.all([
    prisma.clientActivity.count({ where }),
    prisma.clientActivity.findMany({
      where,
      select: {
        id: true,
        type: true,
        summary: true,
        meta: true,
        createdAt: true,
        actor: { select: PERSON },
        spoc: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(q),
    }),
  ]);

  res.json({ success: true, data: rows, meta: pageMeta(total, q.page, q.limit) });
};

// ── POST /clients/:id/notes — anyone who can see the client; handlers get notified
export const addClientNote = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { content, spocId, section } = req.validatedBody as { content: string; spocId?: string | null; section?: string };
  const client = await findClientInScope(req, id);
  await assertSpocOfClient(id, spocId);

  const note = await prisma.$transaction(async (tx) => {
    const n = await tx.clientNote.create({
      data: { clientId: id, spocId: spocId ?? null, section: section ?? null, authorId: req.user.id, content },
      select: NOTE_SELECT,
    });

    await logClientActivity(tx, {
      clientId: id,
      spocId: spocId ?? null,
      actorId: req.user.id,
      type: "NOTE_ADDED",
      summary: content.length > 120 ? `${content.slice(0, 117)}...` : content,
    });

    const handlers = await tx.clientSpoc.findMany({
      where: { clientId: id, isActive: true },
      select: { handlerId: true },
      distinct: ["handlerId"],
    });
    await notifyUsers(tx, handlers.map((h) => h.handlerId), req.user.id, {
      type: "NOTE_ADDED",
      title: `New note on ${client.name}`,
      body: `${req.user.firstName} ${req.user.lastName}: ${content.slice(0, 200)}`,
      referenceId: id,
      referenceType: "CLIENT",
    });

    return n;
  });

  res.status(201).json({ success: true, data: note });
};

// ── PATCH /clients/:id/notes/:noteId — the author corrects their own comment
export const updateClientNote = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "edit a note");
  const { id, noteId } = req.validatedParams;
  const { content } = req.validatedBody as { content: string };
  await findClientInScope(req, id);

  const mine = await prisma.clientNote.findFirst({
    where: { id: noteId, clientId: id, authorId: req.user.id },
    select: { id: true, spocId: true },
  });
  if (!mine) throw notFound("Note");

  const note = await prisma.$transaction(async (tx) => {
    const n = await tx.clientNote.update({
      where: { id: noteId },
      data: { content, editedAt: new Date() },
      select: NOTE_SELECT,
    });
    await logClientActivity(tx, {
      clientId: id,
      spocId: mine.spocId,
      actorId: req.user.id,
      type: "NOTE_UPDATED",
      summary: content.length > 120 ? `${content.slice(0, 117)}...` : content,
    });
    return n;
  });

  res.json({ success: true, data: note });
};

// ── DELETE /clients/:id/notes/:noteId — own notes; anyone's with client_notes.delete_any
export const deleteClientNote = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "delete a note");
  const { id, noteId } = req.validatedParams;
  await findClientInScope(req, id);
  const canDeleteAny = !!req.permissions!["client_notes.delete_any"];

  const { count } = await prisma.clientNote.deleteMany({
    where: { id: noteId, clientId: id, ...(!canDeleteAny && { authorId: req.user.id }) },
  });
  if (!count) throw notFound("Note");

  res.json({ success: true, message: "Note deleted" });
};

// ── locations ────────────────────────────────────────────────────────────────

// one primary per client — setting a new one clears the rest
const clearOtherPrimaries = (
  tx: Prisma.TransactionClient,
  clientId: string,
  keepId: string,
) =>
  tx.clientLocation.updateMany({
    where: { clientId, isPrimary: true, id: { not: keepId } },
    data: { isPrimary: false },
  });

const describeLocation = (l: { name?: string | null; city?: string | null; state?: string | null }) =>
  [l.name, l.city, l.state].filter(Boolean).join(", ") || "location";

// ── POST /clients/:id/locations
export const addClientLocation = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as CreateLocationInput;
  await findClientInScope(req, id);
  await assertLookups({ typeId: [body.typeId, "LOCATION_TYPE"] });

  const location = await prisma.$transaction(async (tx) => {
    // first location becomes primary automatically
    const hasAny = await tx.clientLocation.count({ where: { clientId: id, isActive: true } });
    const l = await tx.clientLocation.create({
      data: {
        // "BANGALORE." → "Bengaluru": one spelling per place, so filters match
        ...normaliseLocation(definedOnly(body)),
        isPrimary: body.isPrimary ?? hasAny === 0,
        clientId: id,
        addedById: req.user.id,
      },
      select: LOCATION_SELECT,
    });
    if (l.isPrimary) await clearOtherPrimaries(tx, id, l.id);

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "LOCATION_ADDED",
      summary: `Location added: ${describeLocation(l)}`,
    });

    return l;
  });

  res.status(201).json({ success: true, message: "Location added", data: location });
};

// ── PATCH /clients/:id/locations/:locationId
export const updateClientLocation = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "edit an office");
  const { id, locationId } = req.validatedParams;
  const body = req.validatedBody as UpdateLocationInput;
  await findClientInScope(req, id);
  await assertLookups({ typeId: [body.typeId, "LOCATION_TYPE"] });

  const existing = await prisma.clientLocation.findFirst({
    where: { id: locationId, clientId: id },
    select: { id: true, country: true, state: true, city: true },
  });
  if (!existing) throw notFound("Location");

  // normalise with the stored values as context, write back only what was sent
  const fields = definedOnly(body);
  const geo = normaliseLocation({ country: existing.country, state: existing.state, city: existing.city, ...fields });
  for (const k of ["country", "state", "city"] as const) if (k in fields) (fields as Record<string, unknown>)[k] = geo[k];

  const location = await prisma.$transaction(async (tx) => {
    const l = await tx.clientLocation.update({
      where: { id: locationId },
      data: fields,
      select: LOCATION_SELECT,
    });
    if (body.isPrimary) await clearOtherPrimaries(tx, id, locationId);

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `Location updated: ${describeLocation(l)}`,
    });

    return l;
  });

  res.json({ success: true, message: "Location updated", data: location });
};

// ── DELETE /clients/:id/locations/:locationId — soft; SPOCs keep the link
export const removeClientLocation = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "remove an office");
  const { id, locationId } = req.validatedParams;
  await findClientInScope(req, id);

  const existing = await prisma.clientLocation.findFirst({
    where: { id: locationId, clientId: id, isActive: true },
    select: { name: true, city: true, state: true },
  });
  if (!existing) throw notFound("Location");

  await prisma.$transaction(async (tx) => {
    await tx.clientLocation.update({
      where: { id: locationId },
      data: { isActive: false, isPrimary: false },
    });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `Location removed: ${describeLocation(existing)}`,
    });
  });

  res.json({ success: true, message: "Location removed" });
};

// ── technologies ─────────────────────────────────────────────────────────────

// ── PUT /clients/:id/technologies — upsert by category (one row per category)
export const saveClientTechnology = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { categoryId, details } = req.validatedBody;
  await findClientInScope(req, id);
  await assertLookups({ categoryId: [categoryId, "TECH_CATEGORY"] });
  // a category already filled: only a super admin rewrites it
  const had = await prisma.clientTechnology.findUnique({ where: { clientId_categoryId: { clientId: id, categoryId } }, select: { details: true } });
  if (had) assertFillOnly(req.user, had, { details });

  const technology = await prisma.$transaction(async (tx) => {
    const t = await tx.clientTechnology.upsert({
      where: { clientId_categoryId: { clientId: id, categoryId } },
      create: { clientId: id, categoryId, details, addedById: req.user.id },
      update: { details },
      select: TECHNOLOGY_SELECT,
    });

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "TECHNOLOGY_UPDATED",
      summary: `${t.category.label}: ${details.slice(0, 100)}`,
    });

    return t;
  });

  res.json({ success: true, message: "Technology saved", data: technology });
};

// ── DELETE /clients/:id/technologies/:technologyId
export const removeClientTechnology = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "remove a technology");
  const { id, technologyId } = req.validatedParams;
  await findClientInScope(req, id);

  const existing = await prisma.clientTechnology.findFirst({
    where: { id: technologyId, clientId: id },
    select: { category: { select: { label: true } } },
  });
  if (!existing) throw notFound("Technology");

  await prisma.$transaction(async (tx) => {
    await tx.clientTechnology.delete({ where: { id: technologyId } });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "TECHNOLOGY_UPDATED",
      summary: `${existing.category.label} removed`,
    });
  });

  res.json({ success: true, message: "Technology removed" });
};

// ── PATCH /clients/bulk-status — updateClientStatus's rules per client
export const bulkUpdateClientStatus = async (req: Request, res: Response) => {
  const { clientIds, status } = req.validatedBody as BulkClientStatusInput;

  const found = await prisma.client.findMany({
    where: { id: { in: clientIds }, deletedAt: null },
    select: { id: true, status: true, approvedById: true },
  });
  const byId = new Map(found.map((c) => [c.id, c]));

  const skipped: { id: string; reason: string }[] = [];
  const eligible: typeof found = [];
  for (const id of clientIds) {
    const c = byId.get(id);
    if (!c) skipped.push({ id, reason: "Client not found" });
    // a no-op would only add noise to the timeline
    else if (c.status === status) skipped.push({ id, reason: `Client is already ${status}` });
    else eligible.push(c);
  }

  if (eligible.length) {
    const now = new Date();
    const firstApprovals = new Set(
      eligible.filter((c) => status === "ACTIVE" && !c.approvedById).map((c) => c.id),
    );
    const others = eligible.filter((c) => !firstApprovals.has(c.id)).map((c) => c.id);

    await prisma.$transaction(
      async (tx) => {
        if (firstApprovals.size) {
          await tx.client.updateMany({
            where: { id: { in: [...firstApprovals] } },
            data: { status, approvedById: req.user.id, approvedAt: now },
          });
        }
        if (others.length) {
          await tx.client.updateMany({ where: { id: { in: others } }, data: { status } });
        }

        for (const c of eligible) {
          await logClientActivity(tx, {
            clientId: c.id,
            actorId: req.user.id,
            type: firstApprovals.has(c.id) ? "CLIENT_APPROVED" : "CLIENT_UPDATED",
            summary: `Status ${c.status} → ${status}`,
          });
        }
      },
      { timeout: 30_000 }, // up to 200 activity rows
    );
  }

  res.json({
    success: true,
    message: `${eligible.length} client${eligible.length === 1 ? "" : "s"} updated`,
    data: { updated: eligible.length, skipped },
  });
};

// ── GET /clients/:id/documents/:documentId/url — short-lived presigned read URL
const DOCUMENT_URL_TTL = 60 * 15;

export const getClientDocumentUrl = async (req: Request, res: Response) => {
  const { id, documentId } = req.validatedParams;
  await findClientInScope(req, id);

  const doc = await prisma.clientDocument.findFirst({
    where: { id: documentId, clientId: id },
    select: { fileKey: true, fileName: true },
  });
  if (!doc) throw notFound("Document");
  const download = req.query.download === "1";

  const unavailable = () =>
    ApiError(503, "Document storage is not configured", "STORAGE_UNAVAILABLE");
  if (!process.env.AWS_BUCKET) throw unavailable();

  const url = await getSignedUrl(doc.fileKey, DOCUMENT_URL_TTL, download ? (doc.fileName ?? doc.fileKey.split("/").pop()) : undefined);
  if (!url) throw unavailable();

  res.json({ success: true, data: { url, expiresIn: DOCUMENT_URL_TTL } });
};

// ── financials — a person's figures are locked: the pipeline never overwrites them

// ── PUT /clients/:id/financials — CSR figures for one FY (upsert by FY)
export const saveCsrFinancial = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { fy, evidence, ...figures } = req.validatedBody as SaveCsrFinancialInput;
  await findClientInScope(req, id);

  const values = definedOnly({ ...figures, evidence });
  // an existing year: fill its empty figures only, unless super admin
  const had = await prisma.clientCsrFinancial.findUnique({ where: { clientId_fy: { clientId: id, fy } } });
  if (had) assertFillOnly(req.user, had, values, ["evidence"]);
  const row = await prisma.$transaction(async (tx) => {
    const f = await tx.clientCsrFinancial.upsert({
      where: { clientId_fy: { clientId: id, fy } },
      create: { clientId: id, fy, ...values, isLocked: true },
      update: { ...values, isLocked: true },
      select: FINANCIAL_SELECT,
    });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "FINANCIALS_UPDATED",
      summary: `CSR figures for FY ${fy} saved`,
      meta: { fy, ...figures },
    });
    return f;
  });
  // the list's "CSR spent" follows the newest figures
  await syncCsrSnapshot(id);

  res.json({ success: true, message: `FY ${fy} saved`, data: row });
};

// ── DELETE /clients/:id/financials/:financialId
export const removeCsrFinancial = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "delete a CSR year");
  const { id, financialId } = req.validatedParams;
  await findClientInScope(req, id);

  const row = await prisma.clientCsrFinancial.findFirst({ where: { id: financialId, clientId: id }, select: { fy: true } });
  if (!row) throw notFound("CSR figures");
  await prisma.$transaction(async (tx) => {
    await tx.clientCsrFinancial.delete({ where: { id: financialId } });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "FINANCIALS_UPDATED",
      summary: `CSR figures for FY ${row.fy} removed`,
    });
  });
  await syncCsrSnapshot(id);
  res.json({ success: true, message: `FY ${row.fy} removed` });
};

// ── PUT /clients/:id/corporate-financials — company figures for one FY
export const saveCorporateFinancial = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { fy, source, ...figures } = req.validatedBody as SaveCorporateFinancialInput;
  await findClientInScope(req, id);

  const values = definedOnly({ ...figures, source, updatedById: req.user.id });
  const had = await prisma.clientCorporateFinancial.findUnique({ where: { clientId_fy: { clientId: id, fy } } });
  if (had) assertFillOnly(req.user, had, values, ["source", "updatedById"]);
  const row = await prisma.$transaction(async (tx) => {
    const f = await tx.clientCorporateFinancial.upsert({
      where: { clientId_fy: { clientId: id, fy } },
      create: { clientId: id, fy, ...values, isLocked: true },
      update: { ...values, isLocked: true },
      select: CORPORATE_SELECT,
    });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "FINANCIALS_UPDATED",
      summary: `Company figures for FY ${fy} saved`,
      meta: { fy, ...figures },
    });
    return f;
  });
  res.json({ success: true, message: `FY ${fy} saved`, data: row });
};

// ── DELETE /clients/:id/corporate-financials/:financialId
export const removeCorporateFinancial = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "delete a company figures year");
  const { id, financialId } = req.validatedParams;
  await findClientInScope(req, id);

  const { count } = await prisma.clientCorporateFinancial.deleteMany({ where: { id: financialId, clientId: id } });
  if (!count) throw notFound("Company figures");
  res.json({ success: true, message: "Figures removed" });
};

// ── documents — reports and other attachments, stored in S3 per tenant ───────

const DOCUMENT_SELECT = DOCUMENTS_SELECT.documents.select;

// ── POST /clients/:id/documents — multipart: file + typeId + fy; replaces the
// file already held for that type + FY
export const uploadClientDocument = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { typeId, fy } = req.validatedBody as UploadDocumentInput;
  const file = req.file;
  if (!file) throw ApiError(400, "Choose a file to upload", "NO_FILE");
  if (!process.env.AWS_BUCKET) throw ApiError(503, "Document storage is not configured", "STORAGE_UNAVAILABLE");

  await findClientInScope(req, id);
  await assertLookups({ typeId: [typeId, "DOCUMENT_TYPE"] });

  const fileKey = await uploadToS3({
    folder: `tenants/${req.user.tenantId}/clients/${id}`,
    fileName: file.originalname,
    buffer: file.buffer,
    mimeType: file.mimetype,
  });
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const previous = await prisma.clientDocument.findUnique({
    where: { clientId_typeId_fy: { clientId: id, typeId, fy } },
    select: { fileKey: true },
  });

  const doc = await prisma.$transaction(async (tx) => {
    const values = { fileKey, fileName: file.originalname, sha256, sourceUrl: null, sourceRunId: null };
    const d = await tx.clientDocument.upsert({
      where: { clientId_typeId_fy: { clientId: id, typeId, fy } },
      create: { clientId: id, typeId, fy, ...values },
      update: values,
      select: DOCUMENT_SELECT,
    });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "DOCUMENT_ADDED",
      summary: `${d.type.label} (FY ${fy}) uploaded: ${file.originalname}`,
    });
    return d;
  });

  // the replaced file is no longer referenced — best effort
  if (previous && previous.fileKey !== fileKey) void deleteFromS3(previous.fileKey).catch(() => undefined);
  res.status(201).json({ success: true, message: "Document uploaded", data: doc });
};

// ── DELETE /clients/:id/documents/:documentId
export const removeClientDocument = async (req: Request, res: Response) => {
  assertSuperAdmin(req.user, "delete a document");
  const { id, documentId } = req.validatedParams;
  await findClientInScope(req, id);

  const doc = await prisma.clientDocument.findFirst({
    where: { id: documentId, clientId: id },
    select: { fileKey: true, fy: true, type: { select: { label: true } } },
  });
  if (!doc) throw notFound("Document");

  await prisma.$transaction(async (tx) => {
    await tx.clientDocument.delete({ where: { id: documentId } });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `${doc.type.label} (FY ${doc.fy}) removed`,
    });
  });
  void deleteFromS3(doc.fileKey).catch(() => undefined);
  res.json({ success: true, message: "Document removed" });
};

// ── POST /clients/:id/key-account — my personal star; many users per client.
// It marks the client for me only: it never widens who can see it.
export const toggleClientKeyAccount = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const client = await findClientInScope(req, id);
  const key = { clientId_userId: { clientId: id, userId: req.user.id } };
  const had = await prisma.clientKeyAccount.findUnique({ where: key });

  await prisma.$transaction(async (tx) => {
    if (had) await tx.clientKeyAccount.delete({ where: key });
    else await tx.clientKeyAccount.create({ data: { clientId: id, userId: req.user.id } });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `${had ? "Removed" : "Marked"} "${client.name}" as a key account`,
    });
  });

  const keyAccounts = await prisma.clientKeyAccount.findMany({
    where: { clientId: id },
    select: { createdAt: true, user: { select: PERSON } },
    orderBy: { createdAt: "asc" },
  });
  res.json({
    success: true,
    message: had ? "Key account removed" : "Marked as your key account",
    data: { starred: !had, keyAccounts },
  });
};

// ── GET /clients/stats — counts for the Stats view, same filters as the list.
type StatBucket = { key: string; label: string; count: number };
export type ClientAsker = { user: Request["user"]; scope: Request["scope"] | true | null | undefined; figures: boolean };
const CLIENT_STATS_CAP = 50_000;

export const computeClientStats = async (who: ClientAsker, q: ListClientsQuery) => {
  if (!who.figures) {
    delete q.csrSpentMinCr;
    delete q.csrSpentMaxCr;
  }
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    AND: [who.scope === true || who.scope == null ? {} : await clientScopeWhere(who.user, who.scope), ...(await clientFilterWhere(q, who.user.id))],
  };
  const rows = await prisma.client.findMany({
    where,
    take: CLIENT_STATS_CAP,
    select: {
      status: true,
      entityType: true,
      website: true,
      linkedinUrl: true,
      registration: { select: { cin: true } },
      csrSpentRs: true,
      csr: { select: { csrEligible: true } },
      industry: { select: { id: true, label: true } },
      category: { select: { id: true, label: true } },
      businessUnit: { select: { id: true, name: true } },
      locations: { where: { isPrimary: true, isActive: true }, select: { state: true }, take: 1 },
      _count: { select: { spocs: { where: { isActive: true } }, keyAccounts: true } },
    },
  });

  const tally = () => new Map<string, StatBucket>();
  const add = (m: Map<string, StatBucket>, key: string | null | undefined, label: string | null | undefined) => {
    const k = key ?? "_none";
    const b = m.get(k) ?? { key: k, label: key ? (label ?? key) : "Not set", count: 0 };
    b.count++;
    m.set(k, b);
  };
  const by = { status: tally(), industry: tally(), category: tally(), state: tally(), businessUnit: tally(), entityType: tally() };
  const has = { website: 0, linkedin: 0, cin: 0, spocs: 0, csrFigures: 0, state: 0 };
  let keyAccounts = 0;
  let csrEligible = 0;
  let spocs = 0;
  let csrSpentRs = 0;

  for (const r of rows) {
    if (r.website) has.website++;
    if (r.linkedinUrl) has.linkedin++;
    if (r.registration?.cin) has.cin++;
    if (r._count.spocs) has.spocs++;
    spocs += r._count.spocs;
    if (r.csrSpentRs !== null) {
      has.csrFigures++;
      csrSpentRs += Number(r.csrSpentRs);
    }
    const state = (r.locations[0]?.state ?? "").trim();
    if (state) has.state++;
    if (r._count.keyAccounts) keyAccounts++;
    if (r.csr?.csrEligible) csrEligible++;
    add(by.status, r.status, r.status);
    add(by.industry, r.industry?.id, r.industry?.label);
    add(by.category, r.category?.id, r.category?.label);
    add(by.state, state ? state.toLowerCase() : null, state);
    add(by.businessUnit, r.businessUnit?.id, r.businessUnit?.name);
    add(by.entityType, r.entityType, r.entityType);
  }
  const sorted = (m: Map<string, StatBucket>) => [...m.values()].sort((a, b) => b.count - a.count);
  return {
    total: rows.length,
    capped: rows.length === CLIENT_STATS_CAP,
    spocs,
    keyAccounts,
    csrEligible,
    /** null when the caller may not see CSR figures */
    csrSpentRs: who.figures ? csrSpentRs : null,
    has: { ...has, csrFigures: who.figures ? has.csrFigures : null },
    by: Object.fromEntries(Object.entries(by).map(([k, m]) => [k, sorted(m)])) as Record<keyof typeof by, StatBucket[]>,
  };
};

/** ids of the clients a list filter shows (for an AI action on "these"), capped */
export const clientIdsFor = async (who: ClientAsker, q: ListClientsQuery, cap: number) => {
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    AND: [who.scope === true || who.scope == null ? {} : await clientScopeWhere(who.user, who.scope), ...(await clientFilterWhere(q, who.user.id))],
  };
  const [total, rows] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({ where, select: { id: true, name: true }, orderBy: { name: "asc" }, take: cap }),
  ]);
  return { total, rows };
};

export const clientStats = async (req: Request, res: Response) => {
  const data = await computeClientStats(
    { user: req.user, scope: req.scope, figures: !!req.permissions!["client_financials.read"] },
    req.validatedQuery as ListClientsQuery,
  );
  res.json({ success: true, data });
};
