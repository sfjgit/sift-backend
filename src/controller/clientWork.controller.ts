// File: clientWork.controller.ts
// Path: src/controller/clientWork.controller.ts
//
// The day-to-day work on a client or one of its SPOCs (CASPA "Activity & Tasks"):
//  - tasks, calls to make and meetings — one WorkTask table, told apart by `kind`
//  - the quick log: "I emailed / called / WhatsApped them"
// Everything also lands on the client timeline, tagged with the SPOC when there is one.

import { Request, Response } from "express";
import { z } from "zod";
import { Prisma, WorkTaskKind, WorkTaskStatus } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError, notFound } from "@/utils/httpError";
import { logClientActivity } from "@/services/clientActivity.service";
import { spocTaggedVisibleTo } from "@/services/scope.service";
import { assertSpocOfClient, findClientInScope } from "@/controller/client.controller";

const PERSON = { id: true, firstName: true, lastName: true } as const;

const TASK_SELECT = {
  id: true,
  kind: true,
  title: true,
  notes: true,
  dueAt: true,
  status: true,
  closeNote: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: PERSON },
  createdBy: { select: PERSON },
  closedBy: { select: PERSON },
  spoc: { select: PERSON },
} as const satisfies Prisma.WorkTaskSelect;

const KIND_LABEL: Record<WorkTaskKind, string> = { TASK: "Task", CALL: "Call", MEETING: "Meeting" };
const STATUS_LABEL: Record<WorkTaskStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", DONE: "Done" };
const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

const assertAssignee = async (userId: string) => {
  const u = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
  if (!u) throw ApiError(400, "Assignee not found or inactive", "INVALID_ASSIGNEE");
};

// ── GET /clients/:id/tasks?spocId=&status=
export const listClientTasks = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const q = req.validatedQuery as { spocId?: string; status?: WorkTaskStatus[] };
  await findClientInScope(req, id);

  const tasks = await prisma.workTask.findMany({
    where: {
      clientId: id,
      ...(q.spocId && { spocId: q.spocId }),
      ...(q.status?.length && { status: { in: q.status } }),
      // work on someone else's SPOC stays with them
      ...(await spocTaggedVisibleTo(req.user.id)),
    },
    select: TASK_SELECT,
    // open first, then by due date (no date last), newest first
    orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
  });

  res.json({ success: true, data: tasks });
};

// ── GET /me/work?kind=MEETING&done=false&from=&to= — my follow-ups / calls / meetings
// across every client (phone app: Today + Meetings). Only work assigned to me.
export const myWorkQuery = z.object({
  kind: z.nativeEnum(WorkTaskKind).optional(),
  done: z.enum(["true", "false"]).transform((v) => v === "true").default(false),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const listMyWork = async (req: Request, res: Response) => {
  const q = myWorkQuery.parse(req.query);
  const tasks = await prisma.workTask.findMany({
    where: {
      assigneeId: req.user.id,
      client: { deletedAt: null },
      ...(q.kind && { kind: q.kind }),
      status: q.done ? "DONE" : { not: "DONE" },
      ...((q.from || q.to) && { dueAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    },
    select: { ...TASK_SELECT, client: { select: { id: true, name: true } } },
    orderBy: q.done ? [{ closedAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: q.limit,
  });
  res.json({ success: true, data: tasks });
};

// ── POST /clients/:id/tasks
export const createClientTask = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as {
    spocId?: string | null;
    kind: WorkTaskKind;
    title: string;
    notes?: string | null;
    dueAt?: Date | null;
    assigneeId?: string;
  };
  const client = await prisma.client.findFirst({
    where: { id: (await findClientInScope(req, id)).id },
    select: { tenantId: true },
  });
  await assertSpocOfClient(id, body.spocId);
  const assigneeId = body.assigneeId ?? req.user.id;
  if (body.assigneeId) await assertAssignee(body.assigneeId);

  const task = await prisma.$transaction(async (tx) => {
    const t = await tx.workTask.create({
      data: {
        tenantId: client!.tenantId,
        clientId: id,
        spocId: body.spocId ?? null,
        kind: body.kind,
        title: body.title,
        notes: body.notes ?? null,
        dueAt: body.dueAt ?? null,
        assigneeId,
        createdById: req.user.id,
      },
      select: TASK_SELECT,
    });
    await logClientActivity(tx, {
      clientId: id,
      spocId: body.spocId ?? null,
      actorId: req.user.id,
      type: "TASK_ADDED",
      summary: clip(`${KIND_LABEL[t.kind]}: ${t.title}${t.dueAt ? ` · due ${day(t.dueAt)}` : ""}`),
      meta: { taskId: t.id, kind: t.kind },
    });
    return t;
  });

  res.status(201).json({ success: true, data: task });
};

// ── PATCH /clients/:id/tasks/:taskId — edit, move to In progress, or close with a note
export const updateClientTask = async (req: Request, res: Response) => {
  const { id, taskId } = req.validatedParams;
  const body = req.validatedBody as {
    title?: string;
    notes?: string | null;
    dueAt?: Date | null;
    assigneeId?: string;
    status?: WorkTaskStatus;
    closeNote?: string | null;
  };
  await findClientInScope(req, id);
  const existing = await prisma.workTask.findFirst({
    where: { id: taskId, clientId: id },
    select: { id: true, status: true, spocId: true, kind: true, title: true },
  });
  if (!existing) throw notFound("Task");
  if (body.assigneeId) await assertAssignee(body.assigneeId);

  const closing = body.status === "DONE" && existing.status !== "DONE";
  const reopening = body.status !== undefined && body.status !== "DONE" && existing.status === "DONE";
  const statusChanged = body.status !== undefined && body.status !== existing.status;

  const task = await prisma.$transaction(async (tx) => {
    const t = await tx.workTask.update({
      where: { id: taskId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.dueAt !== undefined && { dueAt: body.dueAt }),
        ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.closeNote !== undefined && { closeNote: body.closeNote }),
        ...(closing && { closedAt: new Date(), closedById: req.user.id }),
        ...(reopening && { closedAt: null, closedById: null }),
      },
      select: TASK_SELECT,
    });
    await logClientActivity(tx, {
      clientId: id,
      spocId: existing.spocId,
      actorId: req.user.id,
      type: closing ? "TASK_CLOSED" : "TASK_UPDATED",
      summary: clip(
        closing
          ? `${KIND_LABEL[t.kind]} done: ${t.title}${t.closeNote ? ` — ${t.closeNote}` : ""}`
          : statusChanged
            ? `${KIND_LABEL[t.kind]} ${STATUS_LABEL[t.status].toLowerCase()}: ${t.title}`
            : `${KIND_LABEL[t.kind]} updated: ${t.title}`,
        200,
      ),
      meta: { taskId: t.id, kind: t.kind, status: t.status },
    });
    return t;
  });

  res.json({ success: true, data: task });
};

// ── DELETE /clients/:id/tasks/:taskId — whoever created it (or was given it), while not done
export const deleteClientTask = async (req: Request, res: Response) => {
  const { id, taskId } = req.validatedParams;
  await findClientInScope(req, id);
  const { count } = await prisma.workTask.deleteMany({
    where: {
      id: taskId,
      clientId: id,
      ...(!req.user.isSuperAdmin && { OR: [{ createdById: req.user.id }, { assigneeId: req.user.id }] }),
    },
  });
  if (!count) throw notFound("Task");
  res.json({ success: true, message: "Task removed" });
};

// ── POST /clients/:id/interactions — "I emailed / called / WhatsApped them"
const CHANNEL_VERB: Record<string, string> = {
  EMAIL: "Email sent",
  CALL: "Call made",
  WHATSAPP: "WhatsApp sent",
  LINKEDIN: "LinkedIn message sent",
  OTHER: "Contacted",
};

export const logClientInteraction = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as {
    spocId?: string | null;
    channel: keyof typeof CHANNEL_VERB;
    note?: string | null;
    connected?: boolean;
  };
  await findClientInScope(req, id);
  await assertSpocOfClient(id, body.spocId);

  const verb =
    body.channel === "CALL" && body.connected !== undefined
      ? body.connected
        ? "Call — connected"
        : "Call — not connected"
      : (CHANNEL_VERB[body.channel] ?? "Contacted");

  const row = await prisma.$transaction(async (tx) => {
    // the SPOC's "connected call" mark follows the latest call
    if (body.channel === "CALL" && body.connected !== undefined && body.spocId) {
      await tx.clientSpoc.update({ where: { id: body.spocId }, data: { callConnected: body.connected } });
    }
    return logClientActivity(tx, {
      clientId: id,
      spocId: body.spocId ?? null,
      actorId: req.user.id,
      type: "INTERACTION_LOGGED",
      summary: clip(body.note ? `${verb}: ${body.note}` : verb, 300),
      meta: { channel: body.channel, ...(body.connected !== undefined && { connected: body.connected }) },
    });
  });

  res.status(201).json({ success: true, data: { id: row.id } });
};
