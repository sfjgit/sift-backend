// File: ticket.service.ts
// Path: src/service/ticket.service.ts

import { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { uploadToS3, deleteFromS3, getSignedUrl } from "@/lib/s3";
import { ApiError as httpError } from "@/utils/httpError";
import type {
  CreateTicketInput,
  UpdateTicketInput,
  ListTicketQuery,
} from "@/validators/ticket.validation";

const TICKET_PREFIX = "TKT";
const S3_FOLDER = "tickets";

const csv = (v?: string) => (v ? v.split(",").filter(Boolean) : undefined);

export const formatTicketNumber = (seq: number) =>
  `${TICKET_PREFIX}-${String(seq).padStart(5, "0")}`;

/** enums + active categories, so the client never hardcodes lists */
export const getTicketMeta = async () => {
  const categories = await prisma.ticketCategory.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return {
    statuses: Object.values(TicketStatus),
    priorities: Object.values(TicketPriority),
    categories,
  };
};

export const createTicket = async (
  payload: CreateTicketInput,
  files: Express.Multer.File[],
  userId: string
) => {
  const uploaded = await Promise.all(
    (files ?? []).map(async (f) => {
      const fileKey = await uploadToS3({
        folder: S3_FOLDER,
        fileName: f.originalname,
        buffer: f.buffer,
        mimeType: f.mimetype,
      });
      return {
        fileName: f.originalname,
        fileKey,
        mimeType: f.mimetype,
        sizeBytes: f.size,
        uploadedById: userId,
      };
    })
  );

  return prisma.ticket.create({
    data: {
      ...payload,
      raisedById: userId,
      attachments: uploaded.length ? { create: uploaded } : undefined,
    },
    include: { attachments: true, category: true },
  });
};

export const listTickets = async (
  query: ListTicketQuery,
  scope: Prisma.TicketWhereInput
) => {
  const { page, limit, search } = query;

  const statusIn = csv(query.status) as TicketStatus[] | undefined;
  const priorityIn = csv(query.priority) as TicketPriority[] | undefined;

  const where: Prisma.TicketWhereInput = {
    AND: [
      scope,
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
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { attachments: true } },
      },
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    data: rows.map((t) => ({ ...t, ticketNumber: formatTicketNumber(t.seq) })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getTicketById = async (
  id: string,
  scope: Prisma.TicketWhereInput
) => {
  const ticket = await prisma.ticket.findFirst({
    where: { AND: [{ id }, scope] },
    include: { category: true, attachments: true },
  });
  if (!ticket) throw httpError(404, "Ticket not found");

  return {
    ...ticket,
    ticketNumber: formatTicketNumber(ticket.seq),
    attachments: await Promise.all(
      ticket.attachments.map(async (a) => ({
        ...a,
        url: await getSignedUrl(a.fileKey),
      }))
    ),
  };
};

export const updateTicket = async (
  id: string,
  payload: UpdateTicketInput,
  scope: Prisma.TicketWhereInput
) => {
  const existing = await prisma.ticket.findFirst({
    where: { AND: [{ id }, scope] },
  });
  if (!existing) throw httpError(404, "Ticket not found");

  const data: Prisma.TicketUpdateInput = { ...payload };

  if (payload.status && payload.status !== existing.status) {
    data.resolvedAt =
      payload.status === TicketStatus.RESOLVED ? new Date() : null;
    data.closedAt = payload.status === TicketStatus.CLOSED ? new Date() : null;
  }

  return prisma.ticket.update({
    where: { id },
    data,
    include: { category: true, attachments: true },
  });
};

export const addAttachments = async (
  ticketId: string,
  files: Express.Multer.File[],
  userId: string,
  scope: Prisma.TicketWhereInput
) => {
  if (!files?.length) throw httpError(400, "No files received");

  const exists = await prisma.ticket.findFirst({
    where: { AND: [{ id: ticketId }, scope] },
    select: { id: true },
  });
  if (!exists) throw httpError(404, "Ticket not found");

  return Promise.all(
    files.map(async (f) => {
      const fileKey = await uploadToS3({
        folder: S3_FOLDER,
        fileName: f.originalname,
        buffer: f.buffer,
        mimeType: f.mimetype,
      });
      return prisma.ticketAttachment.create({
        data: {
          ticketId,
          fileName: f.originalname,
          fileKey,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          uploadedById: userId,
        },
      });
    })
  );
};

export const removeAttachment = async (attachmentId: string) => {
  const att = await prisma.ticketAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!att) throw httpError(404, "Attachment not found");

  await deleteFromS3(att.fileKey);
  await prisma.ticketAttachment.delete({ where: { id: attachmentId } });
  return { id: attachmentId };
};

// File: ticket.service.ts
// Path: src/service/ticket.service.ts
// --- APPEND to the existing file ---

export const listCategories = async (includeInactive = false) =>
  prisma.ticketCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { tickets: true } } },
  });

export const createCategory = async (name: string) => {
  const exists = await prisma.ticketCategory.findUnique({ where: { name } });
  if (exists) throw httpError(409, "Category already exists");
  return prisma.ticketCategory.create({ data: { name } });
};

export const updateCategory = async (
  id: string,
  payload: { name?: string; isActive?: boolean }
) => {
  const exists = await prisma.ticketCategory.findUnique({ where: { id } });
  if (!exists) throw httpError(404, "Category not found");
  return prisma.ticketCategory.update({ where: { id }, data: payload });
};
