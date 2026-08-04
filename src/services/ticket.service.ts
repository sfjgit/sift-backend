// File: ticket.service.ts
// Path: src/modules/ticket/ticket.service.ts

import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { uploadToS3, deleteFromS3, getSignedUrl } from "../../lib/s3";
import { ApiError } from "../../utils/ApiError";
import type {
  CreateTicketInput,
  UpdateTicketInput,
  ListTicketQuery,
} from "./ticket.validation";

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
    priorities: Object.values(Prisma.TicketPriority ?? {}) as string[],
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
      csv(query.status)
        ? { status: { in: csv(query.status) as TicketStatus[] } }
        : {},
      csv(query.priority)
        ? { priority: { in: csv(query.priority) as any } }
        : {},
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
  if (!ticket) throw new ApiError(404, "Ticket not found");

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
  if (!existing) throw new ApiError(404, "Ticket not found");

  const data: Prisma.TicketUpdateInput = { ...payload };

  if (payload.status && payload.status !== existing.status) {
    data.resolvedAt = payload.status === "RESOLVED" ? new Date() : null;
    data.closedAt = payload.status === "CLOSED" ? new Date() : null;
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
  const exists = await prisma.ticket.findFirst({
    where: { AND: [{ id: ticketId }, scope] },
  });
  if (!exists) throw new ApiError(404, "Ticket not found");
  if (!files?.length) throw new ApiError(400, "No files received");

  const created = await Promise.all(
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

  return created;
};

export const removeAttachment = async (attachmentId: string) => {
  const att = await prisma.ticketAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!att) throw new ApiError(404, "Attachment not found");

  await deleteFromS3(att.fileKey);
  await prisma.ticketAttachment.delete({ where: { id: attachmentId } });
  return { id: attachmentId };
};
