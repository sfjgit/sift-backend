// File: bu.controller.ts
// Path: src/controller/bu.controller.ts

import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import type { CreateBUInput, UpdateBUInput } from "@/validators/bu.validator";
import { ApiError, notFound } from "@/utils/httpError";

const BU_SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  parentBUId: true,
  ancestorIds: true,
  createdAt: true,
  serviceLines: { select: { serviceLine: { select: { id: true, name: true } } } },
  _count: { select: { users: true, clientSpocs: true, childBUs: true } },
} as const;

// self excluded — ancestorIds of a new child = parent's ancestors + parent
const resolveAncestorIds = async (parentBUId: string | null | undefined) => {
  if (!parentBUId) return [];

  const parent = await prisma.businessUnit.findUnique({
    where: { id: parentBUId },
    select: { id: true, ancestorIds: true },
  });
  if (!parent) throw notFound("Parent BU");

  return [...parent.ancestorIds, parent.id];
};

// ── GET /business-units — tree + flat list
export const listBusinessUnits = async (_req: Request, res: Response) => {
  const all = await prisma.businessUnit.findMany({
    orderBy: { name: "asc" },
    select: BU_SELECT,
  });

  const nodes = new Map(all.map((bu) => [bu.id, { ...bu, children: [] as unknown[] }]));
  const roots: unknown[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentBUId ? nodes.get(node.parentBUId) : undefined;
    (parent ? parent.children : roots).push(node);
  }

  res.json({ success: true, data: roots, flat: all });
};

// ── GET /business-units/:id
export const getBusinessUnitById = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const bu = await prisma.businessUnit.findUnique({
    where: { id },
    select: {
      ...BU_SELECT,
      parentBU: { select: { id: true, name: true } },
      childBUs: {
        select: { id: true, name: true, code: true, isActive: true },
        orderBy: { name: "asc" },
      },
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
  const ancestorIds = await resolveAncestorIds(body.parentBUId);

  const bu = await prisma.$transaction(async (tx) => {
    const created = await tx.businessUnit.create({
      data: {
        name: body.name,
        code: body.code ?? null,
        parentBUId: body.parentBUId ?? null,
        ancestorIds,
        serviceLines: {
          create: body.serviceLineIds.map((serviceLineId) => ({ serviceLineId })),
        },
      },
      select: BU_SELECT,
    });

    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "CREATE",
        module: "business_units",
        recordId: created.id,
        newData: body,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    return created;
  });

  res.status(201).json({ success: true, message: "BU created", data: bu });
};

// ── PUT /business-units/:id
export const updateBusinessUnit = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateBUInput;

  const existing = await prisma.businessUnit.findUnique({
    where: { id },
    select: { name: true, isActive: true, parentBUId: true },
  });
  if (!existing) throw notFound("BU");

  const parentChanged =
    body.parentBUId !== undefined && body.parentBUId !== existing.parentBUId;

  let newAncestorIds: string[] | undefined;
  if (parentChanged) {
    newAncestorIds = await resolveAncestorIds(body.parentBUId);
    // new parent can't be this BU or one of its descendants
    if (body.parentBUId === id || newAncestorIds.includes(id)) {
      throw ApiError(400, "A BU cannot be moved under itself", "BU_CYCLE");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.businessUnit.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.code !== undefined && { code: body.code }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(parentChanged && { parentBUId: body.parentBUId ?? null }),
        ...(newAncestorIds && { ancestorIds: newAncestorIds }),
      },
      select: BU_SELECT,
    });

    // rewrite descendants: keep the part of their chain from this BU down
    if (newAncestorIds) {
      const descendants = await tx.businessUnit.findMany({
        where: { ancestorIds: { has: id } },
        select: { id: true, ancestorIds: true },
      });
      for (const d of descendants) {
        const suffix = d.ancestorIds.slice(d.ancestorIds.indexOf(id));
        await tx.businessUnit.update({
          where: { id: d.id },
          data: { ancestorIds: [...newAncestorIds, ...suffix] },
        });
      }
    }

    if (body.serviceLineIds) {
      await tx.businessUnitServiceLine.deleteMany({ where: { businessUnitId: id } });
      await tx.businessUnitServiceLine.createMany({
        data: body.serviceLineIds.map((serviceLineId) => ({
          businessUnitId: id,
          serviceLineId,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "UPDATE",
        module: "business_units",
        recordId: id,
        oldData: existing,
        newData: body,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    return u;
  });

  res.json({ success: true, message: "BU updated", data: updated });
};

// ── DELETE /business-units/:id — blocked while anything hangs off it
export const deleteBusinessUnit = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const bu = await prisma.businessUnit.findUnique({
    where: { id },
    select: {
      name: true,
      _count: { select: { childBUs: true, users: true, clientSpocs: true } },
    },
  });
  if (!bu) throw notFound("BU");

  const { childBUs, users, clientSpocs } = bu._count;
  const blockers = [
    childBUs && `${childBUs} child BU(s)`,
    users && `${users} user(s)`,
    clientSpocs && `${clientSpocs} SPOC(s)`,
  ].filter(Boolean);

  if (blockers.length) {
    throw ApiError(
      409,
      `Cannot delete — this BU has ${blockers.join(", ")}. Remove them first.`,
      "BU_IN_USE",
    );
  }

  await prisma.$transaction([
    prisma.businessUnit.delete({ where: { id } }),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "DELETE",
        module: "business_units",
        recordId: id,
        oldData: { name: bu.name },
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    }),
  ]);

  res.json({ success: true, message: "BU deleted" });
};
