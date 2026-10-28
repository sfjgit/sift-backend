// File: client.controller.ts
// Path: src/controller/client.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocWhereForUserId } from "@/services/scope.service";
import { assertLookups } from "@/services/lookup.service";
import { logClientActivity } from "@/services/clientActivity.service";
import { notifyUsers } from "@/services/notification.service";
import { definedOnly, pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError, notFound } from "@/utils/httpError";
import { getSignedUrl } from "@/lib/s3";
import type {
  BulkClientStatusInput,
  CreateClientInput,
  CreateLocationInput,
  UpdateLocationInput,
  ListClientsQuery,
  UpdateClientInput,
} from "@/validators/client.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;
const LOOKUP = { id: true, code: true, label: true } as const;
const ORG = { id: true, name: true, code: true } as const;

const CLIENT_LIST_SELECT = {
  id: true,
  name: true,
  shortName: true,
  cin: true,
  website: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  industry: { select: LOOKUP },
  category: { select: LOOKUP },
  businessUnit: { select: ORG },
  serviceLines: { select: { serviceLine: { select: ORG } }, orderBy: { createdAt: "asc" } },
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
    select: { id: true, city: true, state: true, country: true },
    take: 1,
  },
  _count: { select: { spocs: { where: { isActive: true } } } },
} as const satisfies Prisma.ClientSelect;

// list rows also carry what the CRM holds and the last pipeline run
const COVERAGE_SELECT = {
  _count: {
    select: {
      spocs: { where: { isActive: true } },
      documents: true,
      financials: true,
      programs: true,
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

const MISSING_WHERE: Record<string, Prisma.ClientWhereInput> = {
  website: { OR: [{ website: null }, { website: "" }] },
  reports: { documents: { none: {} } },
  spocs: { spocs: { none: { isActive: true } } },
  approved: { spocs: { none: { isActive: true, approvalStatus: "APPROVED" } } },
  figures: { financials: { none: {} } },
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
  linkedinUrl: true,
  approvedAt: true,
  approvedBy: { select: PERSON },
  locations: {
    where: { isActive: true },
    select: LOCATION_SELECT,
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  technologies: { select: TECHNOLOGY_SELECT, orderBy: { createdAt: "asc" } },
  notes: {
    select: { id: true, content: true, createdAt: true, author: { select: PERSON } },
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
  programs: {
    select: {
      id: true,
      fy: true,
      name: true,
      budgetRs: true,
      locations: true,
      beneficiaries: true,
      implementor: true,
      sourceUrl: true,
      sector: { select: LOOKUP },
    },
    orderBy: { fy: "desc" },
  },
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
} as const satisfies Prisma.ClientFinancialSelect;

// client by id within the caller's scope for this action — out of scope = 404
const findClientInScope = async (req: Request, id: string) => {
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

const serviceLinesData = (ids: string[]) => ({
  create: [...new Set(ids)].map((serviceLineId) => ({ serviceLineId })),
});

// India-time day bounds for date filters: from = start of that day, to = end of it
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);
const range = (from?: string, to?: string) =>
  from || to ? { ...(from && { gte: dayStart(from) }), ...(to && { lt: dayEnd(to) }) } : undefined;

// Each filter is its own AND clause, so two filters on one relation never
// overwrite each other. Multi values match any of them, except "missing" and
// "steps done" (every picked one must hold).
const clientFilterWhere = (q: ListClientsQuery, me: string): Prisma.ClientWhereInput[] => {
  const and: Prisma.ClientWhereInput[] = [];
  const any = <T,>(v: T[] | undefined) => (v?.length ? v : undefined);

  if (q.status) and.push({ status: q.status });
  if (any(q.industryId)) and.push({ industryId: { in: q.industryId! } });
  if (any(q.categoryId)) and.push({ categoryId: { in: q.categoryId! } });
  if (any(q.businessUnitId)) and.push({ businessUnitId: { in: q.businessUnitId! } });
  if (any(q.serviceLineId)) and.push({ serviceLines: { some: { serviceLineId: { in: q.serviceLineId! } } } });
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

  const loc: Prisma.ClientLocationWhereInput = {
    ...(q.state && { state: { equals: q.state, mode: "insensitive" } }),
    ...(q.district && { district: { equals: q.district, mode: "insensitive" } }),
    ...(q.city && { city: { equals: q.city, mode: "insensitive" } }),
  };
  if (Object.keys(loc).length) and.push({ locations: { some: { isActive: true, ...loc } } });

  if (q.search) {
    and.push({
      OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { shortName: { contains: q.search, mode: "insensitive" } },
        { cin: { contains: q.search, mode: "insensitive" } },
      ],
    });
  }
  return and;
};

// ── GET /clients
export const listClients = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListClientsQuery;

  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    AND: [await clientScopeWhere(req.user, req.scope!), ...clientFilterWhere(q, req.user.id)],
  };

  const [total, rows] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      select: { ...CLIENT_LIST_SELECT, ...COVERAGE_SELECT },
      orderBy: { [q.sortBy]: q.sortDir },
      ...toSkipTake(q),
    }),
  ]);

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
  const stepsBy = new Map<string, Record<string, Omit<(typeof stepRows)[number], "clientId" | "step">>>();
  for (const { clientId, step, ...r } of stepRows) {
    const m = stepsBy.get(clientId) ?? {};
    m[step.key] = r;
    stepsBy.set(clientId, m);
  }
  const approvedBy = new Map(approved.map((a) => [a.clientId, a._count]));
  const sentBy = new Map(sent.map((a) => [a.clientId, a._count]));

  const clients = rows.map(({ stepRuns, _count, ...c }) => ({
    ...c,
    // SPOCs column = the ones this user sees; coverage = what the CRM holds in total
    _count: { spocs: visibleBy.get(c.id) ?? 0 },
    coverage: {
      reports: _count.documents,
      spocs: _count.spocs,
      approvedSpocs: approvedBy.get(c.id) ?? 0,
      figureYears: _count.financials,
      programs: _count.programs,
      outreachPacks: _count.outreachPacks,
      outreachSent: sentBy.get(c.id) ?? 0,
      lastRun: stepRuns[0] ?? null,
      steps: stepsBy.get(c.id) ?? {},
    },
  }));

  res.json({ success: true, data: clients, meta: pageMeta(total, q.page, q.limit) });
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
        financials: { select: FINANCIAL_SELECT, orderBy: { fy: "desc" } },
      }),
    },
  });
  if (!client) throw notFound("Client");

  // SPOC count = the ones this user may see (others' SPOCs stay hidden)
  const spocs = await prisma.clientSpoc.count({
    where: { clientId: id, isActive: true, ...(await spocWhereForUserId(req.user.id)) },
  });
  res.json({ success: true, data: { ...client, _count: { spocs }, spocsTotal: client._count.spocs } });
};

// ── POST /clients — starts PENDING until approved
export const createClient = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateClientInput;

  await assertLookups({
    industryId: [body.industryId, "INDUSTRY"],
    categoryId: [body.categoryId, "CLIENT_CATEGORY"],
  });
  await assertOrg(body.businessUnitId, body.serviceLineIds);
  const { serviceLineIds, ...fields } = body;

  const client = await prisma.$transaction(async (tx) => {
    const c = await tx.client.create({
      data: {
        ...definedOnly(fields),
        createdById: req.user.id,
        ...(serviceLineIds?.length && { serviceLines: serviceLinesData(serviceLineIds) }),
      },
      select: CLIENT_LIST_SELECT,
    });

    await logClientActivity(tx, {
      clientId: c.id,
      actorId: req.user.id,
      type: "CLIENT_CREATED",
      summary: `Client "${c.name}" created`,
    });

    return c;
  });

  res.status(201).json({ success: true, message: "Client created", data: client });
};

// ── PATCH /clients/:id
export const updateClient = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateClientInput;

  await findClientInScope(req, id);
  await assertLookups({
    industryId: [body.industryId, "INDUSTRY"],
    categoryId: [body.categoryId, "CLIENT_CATEGORY"],
  });
  await assertOrg(body.businessUnitId, body.serviceLineIds);

  const { serviceLineIds, ...fields } = body;
  const data = definedOnly(fields);
  const changed = [...Object.keys(data), ...(serviceLineIds ? ["serviceLineIds"] : [])];

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.client.update({
      where: { id },
      data: {
        ...data,
        ...(serviceLineIds && { serviceLines: { deleteMany: {}, ...serviceLinesData(serviceLineIds) } }),
      },
      select: CLIENT_LIST_SELECT,
    });

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `Updated ${changed.join(", ")}`,
      meta: { changes: { ...data, ...(serviceLineIds && { serviceLineIds }) } },
    });

    return c;
  });

  res.json({ success: true, message: "Client updated", data: updated });
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
  const { id } = req.validatedParams;
  const client = await findClientInScope(req, id);

  await prisma.$transaction([
    prisma.client.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
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
  const q = req.validatedQuery as { page: number; limit: number };
  await findClientInScope(req, id);

  // activity on someone else's SPOC stays with them
  const where: Prisma.ClientActivityWhereInput = {
    clientId: id,
    OR: [{ spocId: null }, { spoc: await spocWhereForUserId(req.user.id) }],
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
  const { content } = req.validatedBody;
  const client = await findClientInScope(req, id);

  const note = await prisma.$transaction(async (tx) => {
    const n = await tx.clientNote.create({
      data: { clientId: id, authorId: req.user.id, content },
      select: { id: true, content: true, createdAt: true, author: { select: PERSON } },
    });

    await logClientActivity(tx, {
      clientId: id,
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

// ── DELETE /clients/:id/notes/:noteId — own notes; anyone's with client_notes.delete_any
export const deleteClientNote = async (req: Request, res: Response) => {
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
        ...definedOnly(body),
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
  const { id, locationId } = req.validatedParams;
  const body = req.validatedBody as UpdateLocationInput;
  await findClientInScope(req, id);
  await assertLookups({ typeId: [body.typeId, "LOCATION_TYPE"] });

  const existing = await prisma.clientLocation.findFirst({
    where: { id: locationId, clientId: id },
    select: { id: true },
  });
  if (!existing) throw notFound("Location");

  const location = await prisma.$transaction(async (tx) => {
    const l = await tx.clientLocation.update({
      where: { id: locationId },
      data: definedOnly(body),
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
