// File: outreach.controller.ts
// Path: src/controller/outreach.controller.ts
//
// Outreach packs written by the pipeline, and how people send them. The CRM
// does not send mail: a person reviews the pack, sends each mail from their
// own mailbox and marks it sent here, then records the outcome. Visible /
// editable when the pack's client is in the caller's outreach.read /
// outreach.manage scope (same client visibility rule).

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocWhereForUserId } from "@/services/scope.service";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import { logClientActivity } from "@/services/clientActivity.service";
import { ApiError, notFound } from "@/utils/httpError";
import type { ListOutreachQuery } from "@/validators/stepRun.validators";
import type { PackStatusInput } from "@/validators/outreach.validators";

const PACK_SELECT = {
  id: true,
  model: true,
  fileKey: true,
  createdAt: true,
  status: true,
  reviewedAt: true,
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
  outcomeNote: true,
  repliedAt: true,
  statusAt: true,
  statusBy: { select: { id: true, firstName: true, lastName: true } },
  client: { select: { id: true, name: true } },
  spoc: { select: { id: true, firstName: true, lastName: true, designation: true, email: true } },
  sourceRun: { select: { id: true, step: { select: { label: true } } } },
  messages: {
    select: {
      id: true,
      sequenceNo: true,
      subject: true,
      body: true,
      editedAt: true,
      editedBy: { select: { id: true, firstName: true, lastName: true } },
      sentAt: true,
      sentBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { sequenceNo: "asc" },
  },
} as const satisfies Prisma.OutreachPackSelect;

// ── GET /outreach
export const listOutreach = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListOutreachQuery;
  const canSeeContact = !!req.permissions!["spocs.view_contact"];

  const where: Prisma.OutreachPackWhereInput = {
    client: { deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
    // packs follow their SPOC: someone else's SPOC = someone else's mail
    spoc: await spocWhereForUserId(req.user.id),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.spocId && { spocId: q.spocId }),
    ...(q.search && {
      OR: [
        { client: { name: { contains: q.search, mode: "insensitive" } } },
        { spoc: { firstName: { contains: q.search, mode: "insensitive" } } },
        { spoc: { lastName: { contains: q.search, mode: "insensitive" } } },
      ],
    }),
  };

  const [total, packs, byStatus] = await Promise.all([
    prisma.outreachPack.count({ where: { ...where, ...(q.status && { status: q.status }) } }),
    prisma.outreachPack.findMany({
      where: { ...where, ...(q.status && { status: q.status }) },
      select: PACK_SELECT,
      orderBy: { createdAt: "desc" },
      ...toSkipTake(q),
    }),
    // counts per status for the tabs, ignoring the status filter itself
    prisma.outreachPack.groupBy({ by: ["status"], where, _count: true }),
  ]);

  res.json({
    success: true,
    // same mask rule as toSpocResponse
    data: canSeeContact ? packs : packs.map((p) => ({ ...p, spoc: { ...p.spoc, email: null } })),
    meta: { ...pageMeta(total, q.page, q.limit), byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count])) },
  });
};

// ── tracking ─────────────────────────────────────────────────────────────────

const findPack = async (req: Request, id: string) => {
  const pack = await prisma.outreachPack.findFirst({
    where: {
      id,
      client: { deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) },
      spoc: await spocWhereForUserId(req.user.id),
    },
    select: {
      id: true,
      status: true,
      clientId: true,
      spocId: true,
      spoc: { select: { firstName: true, lastName: true } },
      messages: { select: { id: true, sequenceNo: true, sentAt: true } },
    },
  });
  if (!pack) throw notFound("Outreach pack");
  return pack;
};

const who = (p: { spoc: { firstName: string; lastName: string | null } }) =>
  [p.spoc.firstName, p.spoc.lastName].filter(Boolean).join(" ");
const mailName = (seq: number) => (seq === 0 ? "first email" : `follow-up ${seq}`);

const log = (tx: Prisma.TransactionClient, req: Request, pack: { id: string; clientId: string; spocId: string }, summary: string, meta: object = {}) =>
  logClientActivity(tx, {
    clientId: pack.clientId,
    spocId: pack.spocId,
    actorId: req.user.id,
    type: "OUTREACH_UPDATED",
    summary,
    meta: { packId: pack.id, ...meta },
  });

const packOut = (id: string) => prisma.outreachPack.findUnique({ where: { id }, select: PACK_SELECT });

// ── GET /outreach/:id — the pack + its history
export const getOutreachPack = async (req: Request, res: Response) => {
  const pack = await findPack(req, req.validatedParams.id);
  const [full, history] = await Promise.all([
    packOut(pack.id),
    prisma.clientActivity.findMany({
      where: {
        clientId: pack.clientId,
        type: { in: ["OUTREACH_GENERATED", "OUTREACH_UPDATED"] },
        spocId: pack.spocId,
        OR: [{ meta: { path: ["packId"], equals: pack.id } }, { type: "OUTREACH_GENERATED" }],
      },
      select: { id: true, type: true, summary: true, createdAt: true, actor: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const canSeeContact = !!req.permissions!["spocs.view_contact"];
  res.json({
    success: true,
    data: { ...full!, spoc: canSeeContact ? full!.spoc : { ...full!.spoc, email: null }, history },
  });
};

// ── PATCH /outreach/:id/messages/:messageId — edit a draft mail (not once sent)
export const editOutreachMessage = async (req: Request, res: Response) => {
  const { id, messageId } = req.validatedParams;
  const body = req.validatedBody as { subject?: string; body?: string };
  const pack = await findPack(req, id);
  const msg = pack.messages.find((m) => m.id === messageId);
  if (!msg) throw notFound("Mail");
  if (msg.sentAt) throw ApiError(409, "This mail was already sent — it can't be changed", "ALREADY_SENT");

  await prisma.$transaction(async (tx) => {
    await tx.outreachMessage.update({
      where: { id: messageId },
      data: { ...body, editedById: req.user.id, editedAt: new Date() },
    });
    await log(tx, req, pack, `Edited the ${mailName(msg.sequenceNo)} for ${who(pack)}`, { messageId });
  });
  res.json({ success: true, message: "Mail updated", data: await packOut(pack.id) });
};

// ── PATCH /outreach/:id/messages/:messageId/sent — mark a mail sent / not sent
export const markOutreachSent = async (req: Request, res: Response) => {
  const { id, messageId } = req.validatedParams;
  const { sent, sentAt } = req.validatedBody as { sent: boolean; sentAt?: Date };
  const pack = await findPack(req, id);
  const msg = pack.messages.find((m) => m.id === messageId);
  if (!msg) throw notFound("Mail");
  if (sent && pack.status === "DRAFT") {
    throw ApiError(409, "Review the emails first, then mark them sent", "NOT_REVIEWED");
  }

  const othersSent = pack.messages.some((m) => m.id !== messageId && m.sentAt);
  // first mail sent → SENT; the last sent mail undone → back to REVIEWED
  const nextStatus = sent
    ? pack.status === "REVIEWED" ? "SENT" : pack.status
    : !othersSent && pack.status === "SENT" ? "REVIEWED" : pack.status;

  await prisma.$transaction(async (tx) => {
    await tx.outreachMessage.update({
      where: { id: messageId },
      data: sent ? { sentAt: sentAt ?? new Date(), sentById: req.user.id } : { sentAt: null, sentById: null },
    });
    if (nextStatus !== pack.status) {
      await tx.outreachPack.update({
        where: { id: pack.id },
        data: { status: nextStatus, statusById: req.user.id, statusAt: new Date() },
      });
    }
    await log(
      tx,
      req,
      pack,
      sent ? `Sent the ${mailName(msg.sequenceNo)} to ${who(pack)}` : `Unmarked the ${mailName(msg.sequenceNo)} as sent`,
      { messageId, sentAt: sent ? (sentAt ?? new Date()) : null },
    );
  });
  res.json({ success: true, message: sent ? "Marked as sent" : "Marked as not sent", data: await packOut(pack.id) });
};

// ── PATCH /outreach/:id/status — reviewed / outcome
const LABEL: Record<PackStatusInput["status"], string> = {
  DRAFT: "Moved back to draft",
  REVIEWED: "Reviewed",
  REPLIED: "Replied",
  NO_REPLY: "No reply",
  BOUNCED: "Bounced",
};

export const setOutreachStatus = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as PackStatusInput;
  const pack = await findPack(req, id);
  const anySent = pack.messages.some((m) => m.sentAt);

  if ((body.status === "DRAFT" || body.status === "REVIEWED") && anySent) {
    throw ApiError(409, "Mails were already sent — record the outcome instead", "ALREADY_SENT");
  }
  if (["REPLIED", "NO_REPLY", "BOUNCED"].includes(body.status) && !anySent) {
    throw ApiError(409, "Mark at least one mail as sent first", "NOTHING_SENT");
  }

  await prisma.$transaction(async (tx) => {
    await tx.outreachPack.update({
      where: { id: pack.id },
      data: {
        status: body.status,
        statusById: req.user.id,
        statusAt: new Date(),
        ...(body.status === "REVIEWED" && { reviewedById: req.user.id, reviewedAt: new Date() }),
        ...(body.status === "DRAFT" && { reviewedById: null, reviewedAt: null }),
        ...(body.status === "REPLIED" && { repliedAt: body.repliedAt ?? new Date() }),
        ...(body.note !== undefined && { outcomeNote: body.note || null }),
      },
    });
    await log(tx, req, pack, `${LABEL[body.status]}: outreach to ${who(pack)}${body.note ? ` — ${body.note.slice(0, 120)}` : ""}`, {
      status: body.status,
    });
  });
  res.json({ success: true, message: LABEL[body.status], data: await packOut(pack.id) });
};
