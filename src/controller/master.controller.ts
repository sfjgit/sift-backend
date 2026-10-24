// File: master.controller.ts
// Path: src/controller/master.controller.ts
//
// Service lines, departments and designations share one shape
// (name, code, isActive, users) — one set of handlers for all three.

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import { createAuditLog } from "@/services/auditLogs.service";
import { ApiError, notFound } from "@/utils/httpError";

type MasterModel = "serviceLine" | "department" | "designation";

const MASTER_SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  createdAt: true,
  _count: { select: { users: true } },
} as const;

export const masterController = (model: MasterModel, label: string) => {
  // the three delegates have identical signatures for the calls used here
  const delegate = prisma[model] as any;
  const module = `${model}s`;

  const list = async (req: Request, res: Response) => {
    const { search, isActive } = req.query as Record<string, string | undefined>;

    const rows = await delegate.findMany({
      where: {
        ...(isActive !== undefined && { isActive: isActive === "true" }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      select: MASTER_SELECT,
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: rows });
  };

  const getById = async (req: Request, res: Response) => {
    const row = await delegate.findUnique({
      where: { id: req.validatedParams.id },
      select: {
        ...MASTER_SELECT,
        users: {
          where: { isActive: true },
          select: { id: true, firstName: true, lastName: true, email: true },
          orderBy: { firstName: "asc" },
        },
      },
    });
    if (!row) throw notFound(label);
    res.json({ success: true, data: row });
  };

  const create = async (req: Request, res: Response) => {
    const { name, code } = req.validatedBody;

    const row = await delegate.create({
      data: { name, code: code ?? null },
      select: MASTER_SELECT,
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "CREATE",
      module,
      recordId: row.id,
      newData: { name, code },
      req,
    });

    res.status(201).json({ success: true, message: `${label} created`, data: row });
  };

  const update = async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const { name, code } = req.validatedBody;

    const existing = await delegate.findUnique({ where: { id } });
    if (!existing) throw notFound(label);

    const row = await delegate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
      },
      select: MASTER_SELECT,
    });

    await createAuditLog({
      actorId: req.user.id,
      action: "UPDATE",
      module,
      recordId: id,
      oldData: { name: existing.name, code: existing.code },
      newData: { name, code },
      req,
    });

    res.json({ success: true, message: `${label} updated`, data: row });
  };

  // no hard delete — deactivate, and only when nobody is still assigned
  const toggle = async (req: Request, res: Response) => {
    const { id } = req.validatedParams;

    const existing = await delegate.findUnique({
      where: { id },
      select: { isActive: true, _count: { select: { users: true } } },
    });
    if (!existing) throw notFound(label);

    if (existing.isActive && existing._count.users > 0) {
      throw ApiError(
        400,
        `Cannot deactivate — ${existing._count.users} user(s) still assigned`,
        "IN_USE",
      );
    }

    const row = await delegate.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: MASTER_SELECT,
    });

    res.json({
      success: true,
      message: `${label} ${row.isActive ? "activated" : "deactivated"}`,
      data: row,
    });
  };

  return { list, getById, create, update, toggle };
};
