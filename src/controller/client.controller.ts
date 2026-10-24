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
import type {
  CreateClientInput,
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
  city: true,
  state: true,
  country: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  industry: { select: LOOKUP },
  category: { select: LOOKUP },
  parentClient: { select: { id: true, name: true } },
  createdBy: { select: PERSON },
  _count: { select: { spocs: { where: { isActive: true } } } },
} as const;

const CLIENT_DETAIL_SELECT = {
  ...CLIENT_LIST_SELECT,
  linkedinUrl: true,
  district: true,
  pincode: true,
  address: true,
  approvedAt: true,
  approvedBy: { select: PERSON },
  childClients: {
    where: { deletedAt: null },
    select: { id: true, name: true, status: true },
  },
  notes: {
    select: { id: true, content: true, createdAt: true, author: { select: PERSON } },
    orderBy: { createdAt: "desc" },
  },
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
} as const;

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
} as const;

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
  const canSeeFinancials = !!req.permissions!["clients.view_financials"];

  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    select: {
      ...CLIENT_DETAIL_SELECT,
      ...(canSeeFinancials && {
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
  if (body.parentClientId === id) {
    throw ApiError(400, "A client cannot be its own parent", "CLIENT_CYCLE");
  }

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

// ── DELETE /clients/:id/notes/:noteId — own notes only
export const deleteClientNote = async (req: Request, res: Response) => {
  const { id, noteId } = req.validatedParams;

  const { count } = await prisma.clientNote.deleteMany({
    where: { id: noteId, clientId: id, authorId: req.user.id },
  });
  if (!count) throw notFound("Note");

  res.json({ success: true, message: "Note deleted" });
};
