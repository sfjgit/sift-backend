// File: lookup.controller.ts
// Path: src/controller/lookup.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { LOOKUP_TYPES } from "@/config/lookups";
import { createAuditLog } from "@/services/auditLogs.service";
import { ApiError, notFound } from "@/utils/httpError";

// ── GET /lookups/types
export const listLookupTypes = (_req: Request, res: Response) => {
  res.json({ success: true, data: LOOKUP_TYPES });
};

// ── GET /lookups?type=INDUSTRY&includeInactive=true
export const listLookups = async (req: Request, res: Response) => {
  const { type, includeInactive } = req.validatedQuery;

  const rows = await prisma.lookup.findMany({
    where: {
      ...(type && { type }),
      ...(!includeInactive && { isActive: true }),
    },
    orderBy: [{ type: "asc" }, { order: "asc" }, { label: "asc" }],
  });

  res.json({ success: true, data: rows });
};

// ── POST /lookups
export const createLookup = async (req: Request, res: Response) => {
  const body = req.validatedBody;

  const row = await prisma.lookup.create({
    data: {
      type: body.type,
      code: body.code,
      label: body.label,
      order: body.order ?? null,
      meta: body.meta ?? undefined,
    },
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "CREATE",
    module: "lookups",
    recordId: row.id,
    newData: body,
    req,
  });

  res.status(201).json({ success: true, message: "Lookup created", data: row });
};

// ── PUT /lookups/:id — type never changes; code locked on system rows
export const updateLookup = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody;

  const existing = await prisma.lookup.findUnique({ where: { id } });
  if (!existing) throw notFound("Lookup");
  if (existing.isSystem && body.code !== undefined && body.code !== existing.code) {
    throw ApiError(400, "Code of a system lookup cannot change", "SYSTEM_LOOKUP");
  }

  const row = await prisma.lookup.update({
    where: { id },
    data: {
      ...(body.code !== undefined && { code: body.code }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.meta !== undefined && { meta: body.meta }),
    },
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "UPDATE",
    module: "lookups",
    recordId: id,
    oldData: existing,
    newData: body,
    req,
  });

  res.json({ success: true, message: "Lookup updated", data: row });
};

// ── PATCH /lookups/:id/toggle — no hard delete; records keep pointing at it
export const toggleLookup = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const existing = await prisma.lookup.findUnique({ where: { id } });
  if (!existing) throw notFound("Lookup");
  if (existing.isSystem) {
    throw ApiError(400, "System lookups cannot be deactivated", "SYSTEM_LOOKUP");
  }

  const row = await prisma.lookup.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  res.json({
    success: true,
    message: `Lookup ${row.isActive ? "activated" : "deactivated"}`,
    data: row,
  });
};
