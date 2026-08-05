// File: ticket.controller.ts
// Path: src/controller/ticket.controller.ts

import type { NextFunction, Request, Response } from "express";
import * as ticketService from "@/services/ticket.service";
import { buildTicketScope } from "@/utils/ticket.scope";
import {
  createTicketSchema,
  updateTicketSchema,
  listTicketQuerySchema,
  createCategorySchema,
  updateCategorySchema,
} from "@/validators/ticket.validation";

const files = (req: Request) => (req.files as Express.Multer.File[]) ?? [];

export const getMeta = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await ticketService.getTicketMeta();
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

export const create = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = createTicketSchema.parse(req.body);
    const ticket = await ticketService.createTicket(
      payload,
      files(req),
      req.user!.id
    );
    return res
      .status(201)
      .json({ success: true, message: "Ticket created", data: ticket });
  } catch (err) {
    return next(err);
  }
};

export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listTicketQuerySchema.parse(req.query);
    const scope = buildTicketScope(req.user!);
    const result = await ticketService.listTickets(query, scope);
    return res.json({ success: true, data: result.data, meta: result.meta });
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
    const scope = buildTicketScope(req.user!);
    const ticket = await ticketService.getTicketById(req.params.id, scope);
    return res.json({ success: true, data: ticket });
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
    const scope = buildTicketScope(req.user!);
    const ticket = await ticketService.updateTicket(
      req.params.id,
      payload,
      scope
    );
    return res.json({
      success: true,
      message: "Ticket updated",
      data: ticket,
    });
  } catch (err) {
    return next(err);
  }
};

export const uploadAttachments = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const scope = buildTicketScope(req.user!);
    const created = await ticketService.addAttachments(
      req.params.id,
      files(req),
      req.user!.id,
      scope
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
    const data = await ticketService.removeAttachment(req.params.attachmentId);
    return res.json({ success: true, message: "Attachment removed", data });
  } catch (err) {
    return next(err);
  }
};

// File: ticket.controller.ts
// Path: src/controller/ticket.controller.ts
// --- APPEND (and add the two schemas to your existing import) ---

export const listCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await ticketService.listCategories(
      req.query.includeInactive === "true"
    );
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
    const { name } = createCategorySchema.parse(req.body);
    const data = await ticketService.createCategory(name);
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
    const payload = updateCategorySchema.parse(req.body);
    const data = await ticketService.updateCategory(req.params.id, payload);
    return res.json({ success: true, message: "Category updated", data });
  } catch (err) {
    return next(err);
  }
};
