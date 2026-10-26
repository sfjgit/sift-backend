// File: client.controller.ts
// Path: src/controller/client.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere } from "@/services/scope.service";
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
  createdBy: { select: PERSON },
  // primary address for the list row
  locations: {
    where: { isPrimary: true, isActive: true },
    select: { id: true, city: true, state: true, country: true },
    take: 1,
  },
  _count: { select: { spocs: { where: { isActive: true } } } },
} as const satisfies Prisma.ClientSelect;

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

// ── GET /clients
export const listClients = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListClientsQuery;

  const spocFilter: Prisma.ClientSpocWhereInput = {
    ...(q.handlerId && { handlerId: q.handlerId }),
    ...(q.businessUnitId && { businessUnitId: q.businessUnitId }),
    ...(q.serviceLineId && { serviceLineId: q.serviceLineId }),
  };

  const locationFilter: Prisma.ClientLocationWhereInput = {
    ...(q.state && { state: { equals: q.state, mode: "insensitive" } }),
    ...(q.district && { district: { equals: q.district, mode: "insensitive" } }),
    ...(q.city && { city: { equals: q.city, mode: "insensitive" } }),
  };

  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    AND: [
      await clientScopeWhere(req.user, req.scope!),
      {
        ...(q.status && { status: q.status }),
        ...(q.industryId && { industryId: q.industryId }),
        ...(q.categoryId && { categoryId: q.categoryId }),
        ...(Object.keys(spocFilter).length && {
          spocs: { some: { isActive: true, ...spocFilter } },
        }),
        ...(Object.keys(locationFilter).length && {
          locations: { some: { isActive: true, ...locationFilter } },
        }),
        ...(q.search && {
          OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { shortName: { contains: q.search, mode: "insensitive" } },
            { cin: { contains: q.search, mode: "insensitive" } },
          ],
        }),
      },
    ],
  };

  const [total, clients] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      select: CLIENT_LIST_SELECT,
      orderBy: { [q.sortBy]: q.sortDir },
      ...toSkipTake(q),
    }),
  ]);

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

  res.json({ success: true, data: client });
};

// ── POST /clients — starts PENDING until approved
export const createClient = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateClientInput;

  await assertLookups({
    industryId: [body.industryId, "INDUSTRY"],
    categoryId: [body.categoryId, "CLIENT_CATEGORY"],
  });

  const client = await prisma.$transaction(async (tx) => {
    const c = await tx.client.create({
      data: { ...definedOnly(body), createdById: req.user.id },
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

  const data = definedOnly(body);
  const changed = Object.keys(data);

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.client.update({ where: { id }, data, select: CLIENT_LIST_SELECT });

    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "CLIENT_UPDATED",
      summary: `Updated ${changed.join(", ")}`,
      meta: { changes: data },
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

  const where = { clientId: id };
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
    select: { fileKey: true },
  });
  if (!doc) throw notFound("Document");

  const unavailable = () =>
    ApiError(503, "Document storage is not configured", "STORAGE_UNAVAILABLE");
  if (!process.env.AWS_BUCKET) throw unavailable();

  const url = await getSignedUrl(doc.fileKey, DOCUMENT_URL_TTL);
  if (!url) throw unavailable();

  res.json({ success: true, data: { url, expiresIn: DOCUMENT_URL_TTL } });
};
