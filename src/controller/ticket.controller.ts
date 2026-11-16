// File: ticket.controller.ts
// Path: src/controller/ticket.controller.ts
//
// Support tickets — "Report a problem" and "Suggest a feature".
//   POST   /tickets                        anyone: new ticket (+ screenshot, replay, context)
//   GET    /tickets                        mine; everyone's with support.manage
//   GET    /tickets/:id                    reporter or support
//   GET    /tickets/:id/attachments/:aid   the bytes (jpeg / gzip JSON replay)
//   POST   /tickets/:id/attachments        reporter or support: a new recording of the steps
//   POST   /tickets/:id/comments           reporter or support
//   PATCH  /tickets/:id                    support: status / severity / assignee
//   POST   /tickets/:id/request-repro      support: ask the reporter to show the steps
//   POST   /tickets/:id/diagnose           support.diagnose: AI reading of the evidence

import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, type TicketKind } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { getUserPermissionMap } from "@/services/permission.service";
import { notifyPermission, notifyUsers } from "@/services/notification.service";
import {
  aiDiagnose,
  autoDiagnose,
  CLOSED_STATES,
  PIPELINE,
  sanitizeContext,
  SEVERITIES,
  STATUS_LABEL,
  type Diagnosis,
  type TicketContext,
} from "@/services/ticket.service";
import { logAi } from "@/services/ai/audit.service";
import { LlmError } from "@/services/ai/llm.service";
import { ApiError, notFound } from "@/utils/httpError";

const MAX_SHOT = 2_500_000; // bytes after decoding
const MAX_REPLAY = 6_000_000;
const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;
const name = (u: { firstName: string; lastName: string | null } | null | undefined) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() : null;

const isSupport = async (req: Request) => !!(await getUserPermissionMap(req.user))["support.manage"];

const b64 = (s: string | undefined, max: number, what: string) => {
  if (!s) return null;
  const buf = Buffer.from(s.replace(/^data:[^,]*,/, ""), "base64");
  if (buf.length > max) throw ApiError(413, `The ${what} is too large`, "TOO_LARGE");
  return buf;
};

/** the ticket, if this user may see it (reporter or support) */
const loadFor = async (req: Request, id: string) => {
  const t = await prisma.ticket.findUnique({ where: { id } });
  if (!t) throw notFound("Ticket");
  const support = await isSupport(req);
  if (!support && t.reporterId !== req.user.id) throw notFound("Ticket");
  return { t, support };
};

const link = (id: string) => `/support/${id}`;

// ── create ────────────────────────────────────────────────────────────────────

const createBody = z.object({
  kind: z.enum(["BUG", "FEATURE"]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional(),
  expected: z.string().trim().max(3000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  pageUrl: z.string().max(1000).optional(),
  context: z.unknown().optional(),
  screenshot: z.string().optional(),
  replay: z.string().optional(),
  replayMs: z.number().int().min(0).max(3_600_000).optional(),
});

export const createTicket = async (req: Request, res: Response) => {
  const b = createBody.parse(req.body);
  const shot = b64(b.screenshot, MAX_SHOT, "screenshot");
  const replay = b64(b.replay, MAX_REPLAY, "recording");
  const context = sanitizeContext(b.context);
  const createdAt = new Date();
  const diagnosis =
    b.kind === "BUG" ? autoDiagnose({ title: b.title, description: b.description ?? null, pageUrl: b.pageUrl ?? null, reporterId: req.user.id, createdAt }, context) : null;

  const t = await prisma.ticket.create({
    data: {
      tenantId: req.user.tenantId,
      kind: b.kind,
      title: b.title,
      description: b.description ?? null,
      expected: b.expected ?? null,
      severity: b.kind === "BUG" ? (b.severity ?? "MEDIUM") : null,
      reporterId: req.user.id,
      pageUrl: b.pageUrl ?? null,
      context: context as Prisma.InputJsonValue,
      diagnosis: diagnosis ? (diagnosis as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      createdAt,
      events: { create: [{ type: "CREATED", authorId: req.user.id }] },
      attachments: {
        create: [
          ...(shot ? [{ kind: "SCREENSHOT", mime: "image/jpeg", sizeBytes: shot.length, data: shot, createdById: req.user.id }] : []),
          ...(replay
            ? [{ kind: "REPLAY", mime: "application/gzip", sizeBytes: replay.length, data: replay, durationMs: b.replayMs ?? null, createdById: req.user.id }]
            : []),
        ],
      },
    },
    select: { id: true, number: true },
  });

  await notifyPermission("support.manage", req.user.id, {
    type: "TICKET_UPDATE",
    severity: b.kind === "BUG" && (b.severity === "BLOCKER" || b.severity === "HIGH") ? "WARNING" : "INFO",
    title: `${b.kind === "BUG" ? "Bug" : "Idea"} #${t.number}: ${b.title}`.slice(0, 200),
    body: diagnosis?.summary ?? b.description?.slice(0, 200) ?? null,
    link: link(t.id),
    referenceId: t.id,
    referenceType: "TICKET",
  });
  res.status(201).json({ success: true, data: { ...t, diagnosis } });
};

// ── list / read ───────────────────────────────────────────────────────────────

const listQuery = z.object({
  kind: z.enum(["BUG", "FEATURE"]).optional(),
  status: z.string().max(200).optional(), // "NEW,INVESTIGATING" or "open" / "closed"
  mine: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const listTickets = async (req: Request, res: Response) => {
  const q = listQuery.parse(req.query);
  const support = await isSupport(req);
  const closed = [...CLOSED_STATES];
  const status =
    q.status === "open" ? { notIn: closed } : q.status === "closed" ? { in: closed } : q.status ? { in: q.status.split(",") } : undefined;
  const asNum = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace("#", "")) : null;
  const where: Prisma.TicketWhereInput = {
    ...(q.kind && { kind: q.kind }),
    ...(status && { status }),
    ...(!support || q.mine === "true" ? { reporterId: req.user.id } : {}),
    ...(q.q && { OR: asNum ? [{ number: asNum }] : [{ title: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }] }),
  };
  const [total, rows, counts] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true, number: true, kind: true, title: true, status: true, severity: true, pageUrl: true,
        reproRequested: true, createdAt: true, updatedAt: true, closedAt: true,
        reporter: PERSON, assignee: PERSON,
        attachments: { select: { kind: true } },
        _count: { select: { events: { where: { type: "COMMENT" } } } },
      },
    }),
    prisma.ticket.groupBy({
      by: ["kind", "status"],
      where: support && q.mine !== "true" ? {} : { reporterId: req.user.id },
      _count: true,
    }),
  ]);
  res.json({
    success: true,
    data: rows.map(({ attachments, _count, reporter, assignee, ...t }) => ({
      ...t,
      reporter: name(reporter),
      assignee: assignee ? { id: assignee.id, name: name(assignee) } : null,
      hasScreenshot: attachments.some((a) => a.kind === "SCREENSHOT"),
      recordings: attachments.filter((a) => a.kind !== "SCREENSHOT").length,
      comments: _count.events,
    })),
    meta: {
      total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit),
      support,
      counts: counts.map((c) => ({ kind: c.kind, status: c.status, count: c._count })),
      pipeline: PIPELINE,
      labels: STATUS_LABEL,
    },
  });
};

export const getTicket = async (req: Request, res: Response) => {
  const { support } = await loadFor(req, String(req.params.id));
  const t = await prisma.ticket.findUnique({
    where: { id: String(req.params.id) },
    include: {
      reporter: PERSON,
      assignee: PERSON,
      attachments: { select: { id: true, kind: true, mime: true, sizeBytes: true, durationMs: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      events: { include: { author: PERSON }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!t) throw notFound("Ticket");
  const { reporter, assignee, events, ...rest } = t;
  res.json({
    success: true,
    data: {
      ...rest,
      // the raw evidence is for the people fixing it
      context: support ? rest.context : null,
      diagnosis: support ? rest.diagnosis : null,
      reporter: { id: reporter.id, name: name(reporter) },
      assignee: assignee ? { id: assignee.id, name: name(assignee) } : null,
      events: events.map(({ author, ...e }) => ({ ...e, author: name(author) })),
      pipeline: PIPELINE[t.kind],
      labels: STATUS_LABEL,
      canManage: support,
      canDiagnose: !!(await getUserPermissionMap(req.user))["support.diagnose"],
    },
  });
};

export const getAttachment = async (req: Request, res: Response) => {
  await loadFor(req, String(req.params.id));
  const a = await prisma.ticketAttachment.findFirst({ where: { id: String(req.params.aid), ticketId: String(req.params.id) } });
  if (!a) throw notFound("Attachment");
  res.setHeader("Content-Type", a.mime);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(Buffer.from(a.data));
};

// ── reporter + support ────────────────────────────────────────────────────────

const reproBody = z.object({
  replay: z.string().min(10),
  replayMs: z.number().int().min(0).max(3_600_000).optional(),
  context: z.unknown().optional(),
  note: z.string().trim().max(2000).optional(),
});

/** a new recording of the steps — re-reads the evidence, and the ticket goes back to support */
export const addRecording = async (req: Request, res: Response) => {
  const { t, support } = await loadFor(req, String(req.params.id));
  const b = reproBody.parse(req.body);
  const replay = b64(b.replay, MAX_REPLAY, "recording")!;
  const ctx = b.context ? sanitizeContext(b.context) : null;
  const prev = (t.diagnosis ?? null) as Diagnosis | null;
  const diagnosis =
    t.kind === "BUG" && ctx ? { ...autoDiagnose({ ...t, reporterId: t.reporterId }, mergeCtx(t.context as TicketContext | null, ctx)), ...(prev?.ai && { ai: prev.ai }) } : prev;
  await prisma.$transaction([
    prisma.ticketAttachment.create({
      data: { ticketId: t.id, kind: "REPRO", mime: "application/gzip", sizeBytes: replay.length, data: replay, durationMs: b.replayMs ?? null, createdById: req.user.id },
    }),
    prisma.ticket.update({
      where: { id: t.id },
      data: {
        reproRequested: false,
        ...(t.status === "NEEDS_REPRO" && { status: "INVESTIGATING" }),
        ...(ctx && { context: mergeCtx(t.context as TicketContext | null, ctx) as Prisma.InputJsonValue }),
        ...(diagnosis && { diagnosis: diagnosis as unknown as Prisma.InputJsonValue }),
      },
    }),
    prisma.ticketEvent.create({ data: { ticketId: t.id, type: "REPRO_ADDED", authorId: req.user.id, body: b.note ?? null } }),
  ]);
  if (!support)
    await notifyUsers(prisma, t.assigneeId ? [t.assigneeId] : [], req.user.id, {
      type: "TICKET_UPDATE",
      title: `#${t.number}: the steps were recorded`,
      link: link(t.id),
      referenceId: t.id,
      referenceType: "TICKET",
    });
  res.json({ success: true });
};

const mergeCtx = (a: TicketContext | null, b: TicketContext): TicketContext => ({
  env: { ...(a?.env ?? {}), ...(b.env ?? {}) },
  page: b.page ?? a?.page ?? {},
  network: [...(a?.network ?? []), ...(b.network ?? [])].slice(-80),
  console: [...(a?.console ?? []), ...(b.console ?? [])].slice(-80),
  crumbs: [...(a?.crumbs ?? []), ...(b.crumbs ?? [])].slice(-80),
});

const commentBody = z.object({ body: z.string().trim().min(1).max(5000) });

export const addComment = async (req: Request, res: Response) => {
  const { t, support } = await loadFor(req, String(req.params.id));
  const { body } = commentBody.parse(req.body);
  await prisma.$transaction([
    prisma.ticketEvent.create({ data: { ticketId: t.id, type: "COMMENT", authorId: req.user.id, body } }),
    prisma.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } }),
  ]);
  const to = support ? [t.reporterId] : t.assigneeId ? [t.assigneeId] : [];
  await notifyUsers(prisma, to, req.user.id, {
    type: "TICKET_UPDATE",
    title: `#${t.number}: new comment`,
    body: body.slice(0, 200),
    link: link(t.id),
    referenceId: t.id,
    referenceType: "TICKET",
  });
  res.status(201).json({ success: true });
};

// ── support only ──────────────────────────────────────────────────────────────

const patchBody = z.object({
  status: z.string().max(30).optional(),
  severity: z.enum(SEVERITIES).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
});

export const updateTicket = async (req: Request, res: Response) => {
  const { t } = await loadFor(req, String(req.params.id));
  const b = patchBody.parse(req.body);
  if (b.status && !PIPELINE[t.kind as TicketKind].includes(b.status)) throw ApiError(400, `“${b.status}” is not a step of this ticket's pipeline`, "BAD_STATUS");
  const events: Prisma.TicketEventCreateManyInput[] = [];
  if (b.status && b.status !== t.status)
    events.push({ ticketId: t.id, type: "STATUS", authorId: req.user.id, body: b.note ?? null, data: { from: t.status, to: b.status } });
  if (b.severity !== undefined && b.severity !== t.severity)
    events.push({ ticketId: t.id, type: "SEVERITY", authorId: req.user.id, data: { from: t.severity, to: b.severity } });
  let assigneeName: string | null = null;
  if (b.assigneeId !== undefined && b.assigneeId !== t.assigneeId) {
    if (b.assigneeId) {
      const u = await prisma.user.findUnique({ where: { id: b.assigneeId }, select: { firstName: true, lastName: true } });
      if (!u) throw notFound("User");
      assigneeName = name(u);
    }
    events.push({ ticketId: t.id, type: "ASSIGN", authorId: req.user.id, data: { to: b.assigneeId, name: assigneeName } });
  }
  if (!events.length) return void res.json({ success: true });
  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: t.id },
      data: {
        ...(b.status && { status: b.status, closedAt: CLOSED_STATES.has(b.status) ? new Date() : null, ...(b.status !== "NEEDS_REPRO" && { reproRequested: false }) }),
        ...(b.severity !== undefined && { severity: b.severity }),
        ...(b.assigneeId !== undefined && { assigneeId: b.assigneeId }),
      },
    }),
    prisma.ticketEvent.createMany({ data: events }),
  ]);
  if (b.status && b.status !== t.status)
    await notifyUsers(prisma, [t.reporterId], req.user.id, {
      type: "TICKET_UPDATE",
      severity: b.status === "FIXED" || b.status === "SHIPPED" ? "SUCCESS" : "INFO",
      title: `#${t.number} is now “${STATUS_LABEL[b.status] ?? b.status}”`,
      body: b.note ?? t.title,
      link: link(t.id),
      referenceId: t.id,
      referenceType: "TICKET",
    });
  if (b.assigneeId)
    await notifyUsers(prisma, [b.assigneeId], req.user.id, {
      type: "TICKET_UPDATE",
      title: `#${t.number} was assigned to you`,
      body: t.title,
      link: link(t.id),
      referenceId: t.id,
      referenceType: "TICKET",
    });
  res.json({ success: true });
};

const reproRequestBody = z.object({ message: z.string().trim().max(2000).optional() });

export const requestRepro = async (req: Request, res: Response) => {
  const { t } = await loadFor(req, String(req.params.id));
  if (t.kind !== "BUG") throw ApiError(400, "Only bugs can be reproduced", "NOT_A_BUG");
  const { message } = reproRequestBody.parse(req.body ?? {});
  await prisma.$transaction([
    prisma.ticket.update({ where: { id: t.id }, data: { reproRequested: true, status: "NEEDS_REPRO", closedAt: null } }),
    prisma.ticketEvent.create({ data: { ticketId: t.id, type: "REPRO_REQUESTED", authorId: req.user.id, body: message ?? null } }),
  ]);
  await notifyUsers(prisma, [t.reporterId], req.user.id, {
    type: "TICKET_UPDATE",
    severity: "WARNING",
    title: `#${t.number}: please show us the steps`,
    body: message ?? "Open the ticket and press “Record the steps”, then do what you did when it went wrong.",
    link: link(t.id),
    referenceId: t.id,
    referenceType: "TICKET",
  });
  res.json({ success: true });
};

export const diagnoseTicket = async (req: Request, res: Response) => {
  const { t } = await loadFor(req, String(req.params.id));
  if (t.kind !== "BUG") throw ApiError(400, "Only bugs are diagnosed", "NOT_A_BUG");
  const base = (t.diagnosis as Diagnosis | null) ?? autoDiagnose(t, (t.context as TicketContext | null) ?? {});
  const startedAt = Date.now();
  try {
    const { ai, usage, model } = await aiDiagnose(t, base);
    const diagnosis = { ...base, ai };
    await prisma.$transaction([
      prisma.ticket.update({ where: { id: t.id }, data: { diagnosis: diagnosis as unknown as Prisma.InputJsonValue } }),
      prisma.ticketEvent.create({ data: { ticketId: t.id, type: "DIAGNOSIS", authorId: req.user.id, body: ai.summary } }),
    ]);
    await logAi({ user: req.user, mode: "COMMAND", usageMode: null, input: `ticket #${t.number}: ${t.title}`, tier: "llm", outcome: "success", action: "ticket_diagnose", model, usage, startedAt });
    res.json({ success: true, data: diagnosis });
  } catch (e) {
    if (e instanceof LlmError) {
      await logAi({ user: req.user, mode: "COMMAND", usageMode: null, input: `ticket #${t.number}: ${t.title}`, tier: "llm", outcome: "error", action: "ticket_diagnose", model: e.model ?? null, usage: e.usage ?? null, startedAt });
      throw ApiError(e.code === "not_configured" ? 503 : 502, e.message, "AI_FAILED");
    }
    throw e;
  }
};
