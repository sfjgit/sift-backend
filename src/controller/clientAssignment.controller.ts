// File: clientAssignment.controller.ts
// Path: src/controller/clientAssignment.controller.ts
//
// Who works a client. Super admin / clients.assign gives a client to people;
// they then see it (clients.read scope) and can run the pipeline for it.
// SPOCs they find are theirs (handler) and stay hidden from the others.
// The target people must be inside the caller's clients.assign scope.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, resolveScopeUserIds } from "@/services/scope.service";
import { logClientActivity } from "@/services/clientActivity.service";
import { notifyUsers } from "@/services/notification.service";
import { ApiError, notFound } from "@/utils/httpError";
import type { BulkAssignInput, SetAssignmentsInput } from "@/validators/client.validators";

const PERSON = { id: true, firstName: true, lastName: true, email: true } as const;
const nameOf = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

// active users inside the caller's assign scope — anything else is refused
const assertAssignable = async (req: Request, userIds: string[]) => {
  const ids = [...new Set(userIds)];
  if (!ids.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (users.length !== ids.length) throw ApiError(400, "Some people are not active users", "INVALID_USERS");
  const inScope = await resolveScopeUserIds(req.user, req.scope!);
  if (inScope && ids.some((id) => !inScope.includes(id))) {
    throw ApiError(403, "You can only assign clients to people in your team", "OUT_OF_SCOPE");
  }
  return users;
};

// apply one client's change; returns who was added / removed
const applyAssignment = async (
  tx: Prisma.TransactionClient,
  req: Request,
  client: { id: string; name: string },
  add: string[],
  remove: string[],
  note: string | null,
  names: Map<string, string>,
) => {
  const active = await tx.clientAssignment.findMany({
    where: { clientId: client.id, endedAt: null },
    select: { id: true, userId: true },
  });
  const has = new Set(active.map((a) => a.userId));
  const toAdd = add.filter((id) => !has.has(id));
  const toEnd = active.filter((a) => remove.includes(a.userId));

  if (toEnd.length) {
    await tx.clientAssignment.updateMany({ where: { id: { in: toEnd.map((a) => a.id) } }, data: { endedAt: new Date() } });
  }
  if (toAdd.length) {
    await tx.clientAssignment.createMany({
      data: toAdd.map((userId) => ({ clientId: client.id, userId, assignedById: req.user.id, note })),
    });
  }
  if (toAdd.length || toEnd.length) {
    const parts = [
      toAdd.length && `assigned to ${toAdd.map((id) => names.get(id)).join(", ")}`,
      toEnd.length && `removed ${toEnd.map((a) => names.get(a.userId) ?? "someone").join(", ")}`,
    ].filter(Boolean);
    await logClientActivity(tx, {
      clientId: client.id,
      actorId: req.user.id,
      type: "CLIENT_ASSIGNED",
      summary: `Client ${parts.join("; ")}`.slice(0, 300),
      meta: { added: toAdd, removed: toEnd.map((a) => a.userId), note },
    });
    await notifyUsers(tx, toAdd, req.user.id, {
      type: "CLIENT_ASSIGNED",
      title: `${client.name} was assigned to you`,
      body: note ?? `By ${nameOf(req.user)}`,
      link: `/clients/${client.id}`,
      referenceId: client.id,
      referenceType: "CLIENT",
    });
  }
  return { added: toAdd.length, removed: toEnd.length };
};

const namesOf = async (ids: string[]) => {
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, nameOf(u)]));
};

// ── GET /clients/:id/assignments — current people + history
export const listClientAssignments = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    select: { id: true },
  });
  if (!client) throw notFound("Client");
  const rows = await prisma.clientAssignment.findMany({
    where: { clientId: id },
    select: { id: true, note: true, assignedAt: true, endedAt: true, user: { select: PERSON }, assignedBy: { select: PERSON } },
    orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { assignedAt: "desc" }],
  });
  res.json({ success: true, data: rows });
};

// ── PUT /clients/:id/assignments — the client's people become exactly userIds
export const setClientAssignments = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as SetAssignmentsInput;
  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    select: { id: true, name: true },
  });
  if (!client) throw notFound("Client");
  await assertAssignable(req, body.userIds);

  const current = await prisma.clientAssignment.findMany({ where: { clientId: id, endedAt: null }, select: { userId: true } });
  const remove = current.map((c) => c.userId).filter((u) => !body.userIds.includes(u));
  // removing someone outside your team is as much a change as adding them
  if (remove.length) await assertAssignable(req, remove);
  const names = await namesOf([...body.userIds, ...remove]);

  const result = await prisma.$transaction((tx) =>
    applyAssignment(tx, req, client, body.userIds, remove, body.note ?? null, names),
  );
  res.json({ success: true, message: "Assignment saved", data: result });
};

// ── POST /clients/assign — many clients at once (add / remove / replace)
export const bulkAssignClients = async (req: Request, res: Response) => {
  const body = req.validatedBody as BulkAssignInput;
  await assertAssignable(req, body.userIds);

  const clients = await prisma.client.findMany({
    where: { id: { in: body.clientIds }, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    select: { id: true, name: true, assignments: { where: { endedAt: null }, select: { userId: true } } },
  });
  const extra = body.mode === "replace"
    ? [...new Set(clients.flatMap((c) => c.assignments.map((a) => a.userId)))].filter((u) => !body.userIds.includes(u))
    : [];
  if (extra.length) await assertAssignable(req, extra);
  const names = await namesOf([...body.userIds, ...extra]);

  let added = 0;
  let removed = 0;
  for (const c of clients) {
    const r = await prisma.$transaction((tx) => {
      const current = c.assignments.map((a) => a.userId);
      const add = body.mode === "remove" ? [] : body.userIds;
      const remove = body.mode === "add" ? [] : body.mode === "remove" ? body.userIds : current.filter((u) => !body.userIds.includes(u));
      return applyAssignment(tx, req, c, add, remove, body.note ?? null, names);
    });
    added += r.added;
    removed += r.removed;
  }
  res.json({
    success: true,
    message: `${clients.length} client(s) updated`,
    data: { clients: clients.length, added, removed, notFound: body.clientIds.length - clients.length },
  });
};
