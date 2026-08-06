// File: ticket.controller.ts
// Path: src/controller/ticket.controller.ts

import type { NextFunction, Request, Response } from "express";
import { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { uploadToS3, deleteFromS3, getSignedUrl } from "@/lib/s3";

/* ========================================================================== */
/*                                  CONFIG                                    */
/* ========================================================================== */

const TICKET_PREFIX = "TKT";
const S3_FOLDER = "tickets";

/* ========================================================================== */
/*                                  SCHEMAS                                   */
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
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
});

const categorySchema = z.object({
  name: z.string().min(2).max(60).trim(),
});

const categoryUpdateSchema = z.object({
  name: z.string().min(2).max(60).trim().optional(),
  isActive: z.boolean().optional(),
});

/* ========================================================================== */
/*                                  HELPERS                                   */
/* ========================================================================== */

const filesOf = (req: Request) => (req.files as Express.Multer.File[]) ?? [];

const csv = (v?: string) => (v ? v.split(",").filter(Boolean) : undefined);

const ticketNumber = (seq: number) =>
  `${TICKET_PREFIX}-${String(seq).padStart(5, "0")}`;

const isTicketAdmin = (user: {
  role?: string | null;
  isSuperAdmin?: boolean;
}) => {
  if (user.isSuperAdmin) return true;
  const roles = (process.env.TICKET_ALL_ACCESS_ROLES ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return !!user.role && roles.includes(user.role);
};

/** admins see everything, everyone else sees only what they raised or own */
const scopeOf = (user: {
  id: string;
  role?: string | null;
  isSuperAdmin?: boolean;
}): Prisma.TicketWhereInput =>
  isTicketAdmin(user)
    ? {}
    : { OR: [{ raisedById: user.id }, { assignedToId: user.id }] };

/** 404s if the ticket doesn't exist OR the caller isn't allowed to see it */
const findScopedTicket = async (id: string, req: Request) =>
  prisma.ticket.findFirst({
    where: { AND: [{ id }, scopeOf(req.user!)] },
    select: { id: true, status: true },
  });

const uploadMany = async (files: Express.Multer.File[], userId: string) =>
  Promise.all(
    files.map(async (f) => ({
      fileName: f.originalname,
      fileKey: await uploadToS3({
        folder: S3_FOLDER,
        fileName: f.originalname,
        buffer: f.buffer,
        mimeType: f.mimetype,
      }),
      mimeType: f.mimetype,
      sizeBytes: f.size,
      uploadedById: userId,
    }))
  );

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

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
/*                                  TICKETS                                   */
/* ========================================================================== */

export const create = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = createTicketSchema.parse(req.body);
    const uploaded = await uploadMany(filesOf(req), req.user!.id);

    const ticket = await prisma.ticket.create({
      data: {
        ...payload,
        raisedById: req.user!.id,
        attachments: uploaded.length ? { create: uploaded } : undefined,
      },
      include: { attachments: true, category: true },
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
    const query = listQuerySchema.parse(req.query);
    const { page, limit, search } = query;

    const statusIn = csv(query.status) as TicketStatus[] | undefined;
    const priorityIn = csv(query.priority) as TicketPriority[] | undefined;

    const where: Prisma.TicketWhereInput = {
      AND: [
        scopeOf(req.user!),
        search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
        statusIn?.length ? { status: { in: statusIn } } : {},
        priorityIn?.length ? { priority: { in: priorityIn } } : {},
        query.categoryId ? { categoryId: query.categoryId } : {},
        query.assignedToId ? { assignedToId: query.assignedToId } : {},
      ],
    };

    const [rows, total] = await Promise.all([
      // File: ticket.controller.ts
      // Path: src/controller/ticket.controller.ts
      // --- inside `list`, replace the include + the response mapping ---

      prisma.ticket.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          attachments: { orderBy: { createdAt: "asc" }, take: 6 },
          comments: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { attachments: true, comments: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async ({ comments, ...t }) => ({
        ...t,
        ticketNumber: ticketNumber(t.seq),
        latestComment: comments[0] ?? null,
        attachments: await Promise.all(
          t.attachments.map(async (a) => ({
            ...a,
            url: a.mimeType.startsWith("image/")
              ? await getSignedUrl(a.fileKey)
              : null,
          }))
        ),
      }))
    );

    return res.json({
      success: true,
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });

    // return res.json({
    //   success: true,
    //   data: rows.map((t) => ({ ...t, ticketNumber: ticketNumber(t.seq) })),
    //   meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    // });
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
      where: { AND: [{ id: req.params.id }, scopeOf(req.user!)] },
      include: { category: true, attachments: true },
    });
    if (!ticket) return fail(res, 404, "Ticket not found");

    const attachments = await Promise.all(
      ticket.attachments.map(async (a) => ({
        ...a,
        url: await getSignedUrl(a.fileKey),
      }))
    );

    return res.json({
      success: true,
      data: { ...ticket, ticketNumber: ticketNumber(ticket.seq), attachments },
    });
  } catch (err) {
    return next(err);
  }
};

export const update = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = updateTicketSchema.parse(req.body);

    const existing = await findScopedTicket(req.params.id, req);
    if (!existing) return fail(res, 404, "Ticket not found");

    const data: Prisma.TicketUpdateInput = { ...payload };

    if (payload.status && payload.status !== existing.status) {
      data.resolvedAt =
        payload.status === TicketStatus.RESOLVED ? new Date() : null;
      data.closedAt =
        payload.status === TicketStatus.CLOSED ? new Date() : null;
    }

    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data,
      include: { category: true, attachments: true },
    });

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
/*                                ATTACHMENTS                                 */
/* ========================================================================== */

export const uploadAttachments = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const files = filesOf(req);
    if (!files.length) return fail(res, 400, "No files received");

    const ticket = await findScopedTicket(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const uploaded = await uploadMany(files, req.user!.id);
    const created = await prisma.$transaction(
      uploaded.map((a) =>
        prisma.ticketAttachment.create({
          data: { ...a, ticketId: req.params.id },
        })
      )
    );

    return res.status(201).json({
      success: true,
      message: "Attachments uploaded",
      data: created,
    });
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
    const ticket = await findScopedTicket(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const att = await prisma.ticketAttachment.findFirst({
      where: { id: req.params.attachmentId, ticketId: req.params.id },
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
    const ticket = await findScopedTicket(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const data = await prisma.ticketComment.findMany({
      where: { ticketId: req.params.id },
      orderBy: { createdAt: "asc" },
    });

    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

export const addComment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { body } = commentSchema.parse(req.body);

    const ticket = await findScopedTicket(req.params.id, req);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const data = await prisma.ticketComment.create({
      data: { ticketId: req.params.id, body, authorId: req.user!.id },
    });

    return res
      .status(201)
      .json({ success: true, message: "Reply posted", data });
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
