// File: ticket.controller.ts
// Path: src/controller/ticket.controller.ts

import type { NextFunction, Request, Response } from "express";
import {
  Prisma,
  TicketEventKind,
  TicketPriority,
  TicketStatus,
} from "@prisma/client";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { uploadToS3, deleteFromS3, getSignedUrl } from "@/lib/s3";

/* ========================================================================== */
/*                                   CONFIG                                   */
/* ========================================================================== */

const TICKET_PREFIX = "TKT";
const S3_TICKET_FOLDER = "tickets";
const S3_COMMENT_FOLDER = "tickets/replies";

const envList = (key: string) =>
  (process.env[key] ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

/** fallback recipients when a ticket has no assignee yet (the support desk) */
const DESK_USER_IDS = () => envList("TICKET_DESK_USER_IDS");

/* ========================================================================== */
/*                                   SCHEMAS                                  */
/* ========================================================================== */

const createTicketSchema = z.object({
  title: z.string().min(3).max(180),
  description: z.string().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  categoryId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

const updateTicketSchema = z.object({
  title: z.string().min(3).max(180).optional(),
  description: z.string().optional(),
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  assignedToName: z.string().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
});

/** a reply can carry text, files, a status move, or any combination */
const replySchema = z
  .object({
    body: z.string().max(5000).optional(),
    status: z.nativeEnum(TicketStatus).optional(),
  })
  .refine((v) => !!v.body?.trim() || !!v.status, {
    message: "Add a message or change the status",
  });

const categorySchema = z.object({ name: z.string().min(2).max(60).trim() });
const categoryUpdateSchema = z.object({
  name: z.string().min(2).max(60).trim().optional(),
  isActive: z.boolean().optional(),
});

/* ========================================================================== */
/*                                   HELPERS                                  */
/* ========================================================================== */

const filesOf = (req: Request) => (req.files as Express.Multer.File[]) ?? [];
const csv = (v?: string) => (v ? v.split(",").filter(Boolean) : undefined);
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

const ticketNumber = (seq: number) =>
  `${TICKET_PREFIX}-${String(seq).padStart(5, "0")}`;

/** name/role captured at write time so the thread never needs a user join */
const actorOf = (req: Request) => {
  const u = req.user as any;
  const name =
    [u?.firstName, u?.lastName].filter(Boolean).join(" ") ||
    u?.name ||
    u?.email ||
    null;
  return {
    id: u.id as string,
    name: name as string | null,
    role: (u?.role?.name ?? u?.role ?? null) as string | null,
  };
};

const isTicketAdmin = (req: Request) => {
  const u = req.user as any;
  if (u?.isSuperAdmin) return true;
  const role = u?.role?.name ?? u?.role;
  return !!role && envList("TICKET_ALL_ACCESS_ROLES").includes(role);
};

const scopeOf = (req: Request): Prisma.TicketWhereInput =>
  isTicketAdmin(req)
    ? {}
    : {
        OR: [
          { raisedById: (req.user as any).id },
          { assignedToId: (req.user as any).id },
        ],
      };

const findScoped = (id: string, req: Request) =>
  prisma.ticket.findFirst({
    where: { AND: [{ id }, scopeOf(req)] },
    select: {
      id: true,
      seq: true,
      title: true,
      status: true,
      raisedById: true,
      assignedToId: true,
    },
  });

const signIfImage = async (a: { fileKey: string; mimeType: string }) =>
  a.mimeType.startsWith("image/") ? getSignedUrl(a.fileKey) : null;

/** signed url for everything — used on detail/thread reads */
const withUrls = async <T extends { fileKey: string }>(rows: T[]) =>
  Promise.all(
    rows.map(async (a) => ({ ...a, url: await getSignedUrl(a.fileKey) }))
  );

const uploadAll = async (files: Express.Multer.File[], folder: string) =>
  Promise.all(
    files.map(async (f) => ({
      fileName: f.originalname,
      fileKey: await uploadToS3({
        folder,
        fileName: f.originalname,
        buffer: f.buffer,
        mimeType: f.mimetype,
      }),
      mimeType: f.mimetype,
      sizeBytes: f.size,
    }))
  );

/* ------------------------------ notifications ----------------------------- */

/** everyone on the ticket except whoever caused the event */
const recipientsFor = (
  ticket: { raisedById: string; assignedToId?: string | null },
  actorId: string
) => {
  const ids = new Set<string>([ticket.raisedById]);
  if (ticket.assignedToId) ids.add(ticket.assignedToId);
  else DESK_USER_IDS().forEach((id) => ids.add(id));
  ids.delete(actorId);
  return [...ids];
};

const notify = async (args: {
  ticket: {
    id: string;
    seq: number;
    title: string;
    raisedById: string;
    assignedToId?: string | null;
  };
  actor: { id: string; name: string | null };
  kind: TicketEventKind;
  title: string;
  preview?: string | null;
  commentId?: string | null;
}) => {
  const recipients = recipientsFor(args.ticket, args.actor.id);
  if (!recipients.length) return;

  await prisma.ticketNotification.createMany({
    data: recipients.map((recipientId) => ({
      ticketId: args.ticket.id,
      commentId: args.commentId ?? null,
      recipientId,
      actorId: args.actor.id,
      actorName: args.actor.name,
      kind: args.kind,
      title: args.title,
      preview: args.preview?.slice(0, 200) ?? null,
    })),
  });
};

/* ========================================================================== */
/*                                    META                                    */
/* ========================================================================== */

export const getMeta = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const categories = await prisma.ticketCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return res.json({
      success: true,
      data: {
        statuses: Object.values(TicketStatus),
        priorities: Object.values(TicketPriority),
        categories,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/* ========================================================================== */
/*                                   TICKETS                                  */
/* ========================================================================== */

export const create = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = createTicketSchema.parse(req.body);
    const actor = actorOf(req);
    const uploaded = await uploadAll(filesOf(req), S3_TICKET_FOLDER);

    const ticket = await prisma.ticket.create({
      data: {
        ...payload,
        raisedById: actor.id,
        raisedByName: actor.name,
        lastActivityAt: new Date(),
        attachments: uploaded.length
          ? { create: uploaded.map((a) => ({ ...a, uploadedById: actor.id })) }
          : undefined,
      },
      include: { attachments: true, category: true },
    });

    await notify({
      ticket,
      actor,
      kind: TicketEventKind.MESSAGE,
      title: `New ticket ${ticketNumber(ticket.seq)}`,
      preview: ticket.title,
    });

    return res.status(201).json({
      success: true,
      message: "Ticket created",
      data: { ...ticket, ticketNumber: ticketNumber(ticket.seq) },
    });
  } catch (err) {
    return next(err);
  }
};

export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const statusIn = csv(q.status) as TicketStatus[] | undefined;
    const priorityIn = csv(q.priority) as TicketPriority[] | undefined;

    const where: Prisma.TicketWhereInput = {
      AND: [
        scopeOf(req),
        q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: "insensitive" } },
                { description: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {},
        statusIn?.length ? { status: { in: statusIn } } : {},
        priorityIn?.length ? { priority: { in: priorityIn } } : {},
        q.categoryId ? { categoryId: q.categoryId } : {},
        q.assignedToId ? { assignedToId: q.assignedToId } : {},
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { lastActivityAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          category: { select: { id: true, name: true } },
          attachments: { orderBy: { createdAt: "asc" }, take: 6 },
          comments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { attachments: true },
          },
          _count: { select: { attachments: true, comments: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async ({ comments, ...t }) => ({
        ...t,
        ticketNumber: ticketNumber(t.seq),
        latestComment: comments[0]
          ? {
              ...comments[0],
              attachments: await Promise.all(
                comments[0].attachments.map(async (a) => ({
                  ...a,
                  url: await signIfImage(a),
                }))
              ),
            }
          : null,
        attachments: await Promise.all(
          t.attachments.map(async (a) => ({ ...a, url: await signIfImage(a) }))
        ),
      }))
    );

    return res.json({
      success: true,
      data,
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const getOne = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { AND: [{ id: req.params.id }, scopeOf(req)] },
      include: { category: true, attachments: true },
    });
    if (!ticket) return fail(res, 404, "Ticket not found");

    return res.json({
      success: true,
      data: {
        ...ticket,
        ticketNumber: ticketNumber(ticket.seq),
        attachments: await withUrls(ticket.attachments),
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * Field edits. A status move made here is still recorded in the thread as a
 * STATUS_CHANGE entry, so the conversation never has silent gaps.
 */
export const update = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = updateTicketSchema.parse(req.body);
    const actor = actorOf(req);

    const existing = await findScoped(req.params.id, req);
    if (!existing) return fail(res, 404, "Ticket not found");

    const statusMoved = !!payload.status && payload.status !== existing.status;

    const data: Prisma.TicketUpdateInput = { ...payload };
    if (statusMoved) {
      data.lastActivityAt = new Date();
      data.resolvedAt =
        payload.status === TicketStatus.RESOLVED ? new Date() : null;
      data.closedAt =
        payload.status === TicketStatus.CLOSED ? new Date() : null;
    }

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data,
      include: { category: true, attachments: true },
    });

    if (statusMoved) {
      const event = await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          kind: TicketEventKind.STATUS_CHANGE,
          authorId: actor.id,
          authorName: actor.name,
          authorRole: actor.role,
          statusAtPost: payload.status!,
          fromStatus: existing.status,
          toStatus: payload.status!,
        },
      });

      await notify({
        ticket,
        actor,
        kind: TicketEventKind.STATUS_CHANGE,
        title: `${ticketNumber(ticket.seq)} → ${payload.status}`,
        preview: `${existing.status} → ${payload.status}`,
        commentId: event.id,
      });
    }

    if (
      payload.assignedToId &&
      payload.assignedToId !== existing.assignedToId
    ) {
      await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          kind: TicketEventKind.ASSIGNMENT,
          body: payload.assignedToName
            ? `Assigned to ${payload.assignedToName}`
            : "Reassigned",
          authorId: actor.id,
          authorName: actor.name,
          authorRole: actor.role,
          statusAtPost: ticket.status,
        },
      });
    }

    return res.json({
      success: true,
      message: "Ticket updated",
      data: { ...ticket, ticketNumber: ticketNumber(ticket.seq) },
    });
  } catch (err) {
    return next(err);
  }
};

/* ========================================================================== */
/*                             TICKET ATTACHMENTS                             */
/* ========================================================================== */

export const uploadAttachments = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const files = filesOf(req);
    if (!files.length) return fail(res, 400, "No files received");

    const ticket = await findScoped(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const actor = actorOf(req);
    const uploaded = await uploadAll(files, S3_TICKET_FOLDER);

    const created = await prisma.$transaction(
      uploaded.map((a) =>
        prisma.ticketAttachment.create({
          data: { ...a, ticketId: ticket.id, uploadedById: actor.id },
        })
      )
    );

    return res
      .status(201)
      .json({ success: true, message: "Attachments uploaded", data: created });
  } catch (err) {
    return next(err);
  }
};

export const deleteAttachment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ticket = await findScoped(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const att = await prisma.ticketAttachment.findFirst({
      where: { id: req.params.attachmentId, ticketId: ticket.id },
    });
    if (!att) return fail(res, 404, "Attachment not found");

    await deleteFromS3(att.fileKey).catch(() => null);
    await prisma.ticketAttachment.delete({ where: { id: att.id } });

    return res.json({
      success: true,
      message: "Attachment removed",
      data: { id: att.id },
    });
  } catch (err) {
    return next(err);
  }
};

/* ========================================================================== */
/*                                   THREAD                                   */
/* ========================================================================== */

export const listComments = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ticket = await findScoped(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const rows = await prisma.ticketComment.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "asc" },
      include: { attachments: true },
    });

    const data = await Promise.all(
      rows.map(async (c) => ({
        ...c,
        attachments: await withUrls(c.attachments),
      }))
    );

    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

/**
 * One endpoint for the whole reply action: text + files + optional status move,
 * all recorded on a single thread entry so the conversation reads in order.
 */
export const addComment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = replySchema.parse(req.body);
    const files = filesOf(req);
    const actor = actorOf(req);

    const existing = await findScoped(req.params.id, req);
    if (!existing) return fail(res, 404, "Ticket not found");

    const nextStatus = payload.status ?? existing.status;
    const statusMoved = nextStatus !== existing.status;

    const uploaded = await uploadAll(files, S3_COMMENT_FOLDER);

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: existing.id,
        kind: statusMoved
          ? TicketEventKind.STATUS_CHANGE
          : TicketEventKind.MESSAGE,
        body: payload.body?.trim() || null,
        authorId: actor.id,
        authorName: actor.name,
        authorRole: actor.role,
        statusAtPost: nextStatus,
        fromStatus: statusMoved ? existing.status : null,
        toStatus: statusMoved ? nextStatus : null,
        attachments: uploaded.length ? { create: uploaded } : undefined,
      },
      include: { attachments: true },
    });

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        lastActivityAt: new Date(),
        ...(statusMoved
          ? {
              status: nextStatus,
              resolvedAt:
                nextStatus === TicketStatus.RESOLVED ? new Date() : null,
              closedAt: nextStatus === TicketStatus.CLOSED ? new Date() : null,
            }
          : {}),
      },
    });

    await notify({
      ticket,
      actor,
      kind: comment.kind,
      title: statusMoved
        ? `${ticketNumber(ticket.seq)} → ${nextStatus}`
        : `New reply on ${ticketNumber(ticket.seq)}`,
      preview: payload.body ?? `${existing.status} → ${nextStatus}`,
      commentId: comment.id,
    });

    return res.status(201).json({
      success: true,
      message: statusMoved ? "Reply posted, status updated" : "Reply posted",
      data: {
        ...comment,
        attachments: await withUrls(comment.attachments),
        ticketStatus: ticket.status,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/* ========================================================================== */
/*                          TICKET NOTIFICATIONS                              */
/* ========================================================================== */

export const listNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const unreadOnly = req.query.unread === "true";
    const limit = Math.min(Number(req.query.limit ?? 20), 50);

    const [rows, unread] = await Promise.all([
      prisma.ticketNotification.findMany({
        where: {
          recipientId: (req.user as any).id,
          ...(unreadOnly ? { isRead: false } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          ticket: { select: { seq: true, title: true, status: true } },
        },
      }),
      prisma.ticketNotification.count({
        where: { recipientId: (req.user as any).id, isRead: false },
      }),
    ]);

    return res.json({
      success: true,
      data: rows.map((n) => ({
        ...n,
        ticketNumber: ticketNumber(n.ticket.seq),
      })),
      meta: { unread },
    });
  } catch (err) {
    return next(err);
  }
};

export const notificationCount = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const unread = await prisma.ticketNotification.count({
      where: { recipientId: (req.user as any).id, isRead: false },
    });
    return res.json({ success: true, data: { unread } });
  } catch (err) {
    return next(err);
  }
};

export const markNotificationRead = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await prisma.ticketNotification.updateMany({
      where: {
        id: req.params.notificationId,
        recipientId: (req.user as any).id,
      },
      data: { isRead: true, readAt: new Date() },
    });
    if (!result.count) return fail(res, 404, "Notification not found");
    return res.json({ success: true, message: "Marked read" });
  } catch (err) {
    return next(err);
  }
};

export const markAllNotificationsRead = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await prisma.ticketNotification.updateMany({
      where: { recipientId: (req.user as any).id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return res.json({
      success: true,
      message: "All marked read",
      data: { count: result.count },
    });
  } catch (err) {
    return next(err);
  }
};

/* ========================================================================== */
/*                                 CATEGORIES                                 */
/* ========================================================================== */

export const listCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await prisma.ticketCategory.findMany({
      where: req.query.includeInactive === "true" ? {} : { isActive: true },
      orderBy: { name: "asc" },
      include: { _count: { select: { tickets: true } } },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

export const createCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { name } = categorySchema.parse(req.body);
    const exists = await prisma.ticketCategory.findUnique({ where: { name } });
    if (exists) return fail(res, 409, "Category already exists");

    const data = await prisma.ticketCategory.create({ data: { name } });
    return res
      .status(201)
      .json({ success: true, message: "Category created", data });
  } catch (err) {
    return next(err);
  }
};

export const updateCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = categoryUpdateSchema.parse(req.body);
    const exists = await prisma.ticketCategory.findUnique({
      where: { id: req.params.id },
    });
    if (!exists) return fail(res, 404, "Category not found");

    const data = await prisma.ticketCategory.update({
      where: { id: req.params.id },
      data: payload,
    });
    return res.json({ success: true, message: "Category updated", data });
  } catch (err) {
    return next(err);
  }
};
