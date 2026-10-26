// File: bu.controller.ts
// Path: src/controller/bu.controller.ts
//
// Business units are flat (no hierarchy). Users join via UserBusinessUnit.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import type { CreateBUInput, UpdateBUInput } from "@/validators/bu.validator";
import { createAuditLog } from "@/services/auditLogs.service";
import { ApiError, notFound } from "@/utils/httpError";

const BU_SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  createdAt: true,
  _count: { select: { users: true, clientSpocs: true } },
} as const satisfies Prisma.BusinessUnitSelect;

// ── GET /business-units?isActive=true
export const listBusinessUnits = async (req: Request, res: Response) => {
  const { isActive } = req.query as Record<string, string | undefined>;

  const rows = await prisma.businessUnit.findMany({
    where: isActive !== undefined ? { isActive: isActive === "true" } : {},
    orderBy: { name: "asc" },
    select: BU_SELECT,
  });

  res.json({ success: true, data: rows });
};

// ── GET /business-units/:id
export const getBusinessUnitById = async (req: Request, res: Response) => {
  const bu = await prisma.businessUnit.findUnique({
    where: { id: req.validatedParams.id },
    select: {
      ...BU_SELECT,
      users: {
        select: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!bu) throw notFound("Business unit");

  res.json({ success: true, data: bu });
};

// ── POST /business-units
export const createBusinessUnit = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateBUInput;

  const bu = await prisma.businessUnit.create({
    data: { name: body.name, code: body.code ?? null },
    select: BU_SELECT,
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "CREATE",
    module: "business_units",
    recordId: bu.id,
    newData: body,
    req,
  });

  res.status(201).json({ success: true, message: "BU created", data: bu });
};

// ── PUT /business-units/:id
export const updateBusinessUnit = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateBUInput;

  const existing = await prisma.businessUnit.findUnique({
    where: { id },
    select: { name: true, code: true, isActive: true },
  });
  if (!existing) throw notFound("BU");

  const bu = await prisma.businessUnit.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.code !== undefined && { code: body.code }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
    select: BU_SELECT,
  });

  await createAuditLog({
    actorId: req.user.id,
    action: "UPDATE",
    module: "business_units",
    recordId: id,
    oldData: existing,
    newData: body,
    req,
  });

  res.json({ success: true, message: "BU updated", data: bu });
};

// ── DELETE /business-units/:id — blocked while users or SPOCs reference it
export const deleteBusinessUnit = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const bu = await prisma.businessUnit.findUnique({
    where: { id },
    select: { name: true, _count: { select: { users: true, clientSpocs: true } } },
  });
  if (!bu) throw notFound("BU");

  const { users, clientSpocs } = bu._count;
  const blockers = [users && `${users} user(s)`, clientSpocs && `${clientSpocs} SPOC(s)`].filter(
    Boolean,
  );
  if (blockers.length) {
    throw ApiError(
      409,
      `Cannot delete — this BU has ${blockers.join(", ")}. Deactivate it instead.`,
      "BU_IN_USE",
    );
  }

  await prisma.businessUnit.delete({ where: { id } });

  await createAuditLog({
    actorId: req.user.id,
    action: "DELETE",
    module: "business_units",
    recordId: id,
    oldData: { name: bu.name },
    req,
  });

  res.json({ success: true, message: "BU deleted" });
};
