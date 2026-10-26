// File: faq.controller.ts
// Path: src/controller/faq.controller.ts
//
// Help centre. Everyone reads published FAQs; help.manage edits them and
// may list drafts.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { getUserPermissionMap } from "@/services/permission.service";
import { createAuditLog } from "@/services/auditLogs.service";
import { definedOnly } from "@/utils/pagination";
import { notFound } from "@/utils/httpError";
import type { CreateFaqInput, ListFaqsQuery, UpdateFaqInput } from "@/validators/faq.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;

const FAQ_SELECT = {
  id: true,
  question: true,
  answer: true,
  category: true,
  module: true,
  order: true,
  isPublished: true,
  helpfulCount: true,
  notHelpfulCount: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: PERSON },
} as const satisfies Prisma.FaqSelect;

// ── GET /faqs — drafts only for help.manage
export const listFaqs = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListFaqsQuery;
  const canManage = !!(await getUserPermissionMap(req.user))["help.manage"];

  const faqs = await prisma.faq.findMany({
    where: {
      ...(!(q.includeUnpublished && canManage) && { isPublished: true }),
      ...(q.category && { category: q.category }),
      ...(q.module && { module: q.module }),
      ...(q.search && {
        OR: [
          { question: { contains: q.search, mode: "insensitive" } },
          { answer: { contains: q.search, mode: "insensitive" } },
        ],
      }),
    },
    select: FAQ_SELECT,
    orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
  });

  res.json({ success: true, data: faqs });
};

// ── GET /faqs/categories — published only
export const listFaqCategories = async (_req: Request, res: Response) => {
  const rows = await prisma.faq.groupBy({
    by: ["category"],
    where: { isPublished: true },
    _count: { _all: true },
    orderBy: { category: "asc" },
  });

  res.json({
    success: true,
    data: rows.map((r) => ({ category: r.category, count: r._count._all })),
  });
};

// ── POST /faqs
export const createFaq = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateFaqInput;

  const faq = await prisma.faq.create({
    data: { ...definedOnly(body), createdById: req.user.id },
    select: FAQ_SELECT,
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "CREATE",
    module: "faqs",
    recordId: faq.id,
    newData: body,
    req,
  });

  res.status(201).json({ success: true, message: "FAQ created", data: faq });
};

// ── PUT /faqs/:id
export const updateFaq = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateFaqInput;

  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) throw notFound("FAQ");

  const faq = await prisma.faq.update({
    where: { id },
    data: definedOnly(body),
    select: FAQ_SELECT,
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "UPDATE",
    module: "faqs",
    recordId: id,
    oldData: existing,
    newData: body,
    req,
  });

  res.json({ success: true, message: "FAQ updated", data: faq });
};

// ── DELETE /faqs/:id — hard delete; the audit row keeps the content
export const deleteFaq = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) throw notFound("FAQ");

  await prisma.faq.delete({ where: { id } });

  await createAuditLog({
    actorId: req.user.id,
    action: "DELETE",
    module: "faqs",
    recordId: id,
    oldData: existing,
    req,
  });

  res.json({ success: true, message: "FAQ deleted" });
};

// ── POST /faqs/:id/feedback — atomic increment, no per-user tracking
export const faqFeedback = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { helpful } = req.validatedBody as { helpful: boolean };

  const exists = await prisma.faq.count({ where: { id, isPublished: true } });
  if (!exists) throw notFound("FAQ");

  const faq = await prisma.faq.update({
    where: { id },
    data: helpful ? { helpfulCount: { increment: 1 } } : { notHelpfulCount: { increment: 1 } },
    select: { helpfulCount: true, notHelpfulCount: true },
  });

  res.json({ success: true, data: faq });
};
