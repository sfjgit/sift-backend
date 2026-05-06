// controller/bu.controller.ts
import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import type { CreateBUInput, UpdateBUInput } from "@/validators/bu.validator";

// ─────────────────────────────────────────
// ancestorIds maintenance
// call this on create/update whenever parentBUId changes
// ─────────────────────────────────────────

async function resolveAncestorIds(
  parentBUId: string | null | undefined
): Promise<string[]> {
  if (!parentBUId) return [];

  const parent = await prisma.businessUnit.findUnique({
    where: { id: parentBUId },
    select: { id: true, ancestorIds: true },
  });

  if (!parent) return [];

  // parent's ancestors + parent itself
  return [...parent.ancestorIds, parent.id];
}

// ─────────────────────────────────────────
// GET /business-units
// returns flat list + nested tree both
// ─────────────────────────────────────────

export const listBusinessUnits = async (req: Request, res: Response) => {
  try {
    const all = await prisma.businessUnit.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        parentBUId: true,
        ancestorIds: true,
        createdAt: true,
        _count: {
          select: {
            clients: true,
            // requirements: true,
          },
        },
      },
    });

    // build tree in memory
    const map = new Map<string, any>();
    all.forEach((bu) => map.set(bu.id, { ...bu, children: [] }));

    const roots: any[] = [];
    all.forEach((bu) => {
      if (bu.parentBUId && map.has(bu.parentBUId)) {
        map.get(bu.parentBUId).children.push(map.get(bu.id));
      } else {
        roots.push(map.get(bu.id));
      }
    });

    res.json({ success: true, data: roots, flat: all });
  } catch (err) {
    console.error("listBusinessUnits:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch business units" });
  }
};

// ─────────────────────────────────────────
// GET /business-units/:id
// ─────────────────────────────────────────

export const getBusinessUnitById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const bu = await prisma.businessUnit.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        ancestorIds: true,
        createdAt: true,

        // parent chain for breadcrumb
        parentBU: {
          select: {
            id: true,
            name: true,
            isActive: true,
            parentBU: { select: { id: true, name: true } },
          },
        },

        // child BUs
        childBUs: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
            _count: { select: { clients: true } },
            childBUs: {
              select: { id: true, name: true, isActive: true },
              orderBy: { name: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },

        // clients under this BU
        clients: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            industry: true,
            status: true,
            spocs: {
              where: { isActive: true },
              select: {
                isPrimary: true,
                user: { select: { id: true, firstName: true, lastName: true } },
                serviceLine: { select: { id: true, name: true } },
              },
              take: 2,
            },
            _count: {
              select: {
                requirements: { where: { status: "ACTIVE", deletedAt: null } },
              },
            },
          },
          orderBy: { name: "asc" },
          take: 25,
        },

        // top requirements
        requirementsBU: {
          where: { deletedAt: null },
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            filledOpenings: true,
            respondBy: true,
            isRespondByBreached: true,
            client: { select: { id: true, name: true } },
            serviceLine: { select: { id: true, name: true } },
          },
          orderBy: [{ isRespondByBreached: "desc" }, { updatedAt: "desc" }],
          take: 20,
        },

        _count: {
          select: {
            clients: { where: { deletedAt: null } },
            requirementsBU: { where: { deletedAt: null } },
            clientSpocs: { where: { isActive: true } },
          },
        },
      },
    });

    if (!bu) {
      res
        .status(404)
        .json({ success: false, message: "Business Unit not found" });
      return;
    }

    // requirement breakdown by status for this BU
    // uses ancestorIds — catches sub-BU requirements too
    const allBUIds = [id];
    const children = await prisma.businessUnit.findMany({
      where: { ancestorIds: { has: id } },
      select: { id: true },
    });
    children.forEach((c) => allBUIds.push(c.id));

    const reqStatusCounts = await prisma.requirement.groupBy({
      by: ["status"],
      where: { businessUnitId: { in: allBUIds }, deletedAt: null },
      _count: { _all: true },
    });

    const reqBreakdown = Object.fromEntries(
      reqStatusCounts.map((r) => [r.status, r._count._all])
    );

    res.json({
      success: true,
      data: { ...bu, reqBreakdown },
    });
  } catch (err) {
    console.error("getBusinessUnitById:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch business unit" });
  }
};

// ─────────────────────────────────────────
// POST /business-units
// ─────────────────────────────────────────

export const createBusinessUnit = async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateBUInput;
    const actorId = req.user!.id;

    const existing = await prisma.businessUnit.findUnique({
      where: { name: body.name },
    });

    if (existing) {
      res
        .status(409)
        .json({ success: false, message: "BU name already exists" });
      return;
    }

    if (body.code) {
      const codeConflict = await prisma.businessUnit.findUnique({
        where: { code: body.code },
      });
      if (codeConflict) {
        res
          .status(409)
          .json({ success: false, message: "BU code already exists" });
        return;
      }
    }

    if (body.parentBUId) {
      const parent = await prisma.businessUnit.findUnique({
        where: { id: body.parentBUId },
        select: { id: true },
      });
      if (!parent) {
        res
          .status(404)
          .json({ success: false, message: "Parent BU not found" });
        return;
      }
    }

    // resolve ancestorIds before creating
    const ancestorIds = await resolveAncestorIds(body.parentBUId);

    const bu = await prisma.$transaction(async (tx) => {
      const created = await tx.businessUnit.create({
        data: {
          name: body.name,
          code: body.code ?? null,
          parentBUId: body.parentBUId ?? null,
          ancestorIds,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          ancestorIds: true,
          createdAt: true,
          parentBU: { select: { id: true, name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "CREATE",
          module: "business_units",
          recordId: created.id,
          newData: { name: created.name, code: created.code },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return created;
    });

    res.status(201).json({ success: true, message: "BU created", data: bu });
  } catch (err) {
    console.error("createBusinessUnit:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create business unit" });
  }
};

// ─────────────────────────────────────────
// PUT /business-units/:id
// ─────────────────────────────────────────

export const updateBusinessUnit = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateBUInput;
    const actorId = req.user!.id;

    const existing = await prisma.businessUnit.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        parentBUId: true,
      },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "BU not found" });
      return;
    }

    if (body.name && body.name !== existing.name) {
      const clash = await prisma.businessUnit.findUnique({
        where: { name: body.name },
      });
      if (clash) {
        res
          .status(409)
          .json({ success: false, message: "BU name already exists" });
        return;
      }
    }

    if (body.code && body.code !== existing.code) {
      const codeClash = await prisma.businessUnit.findUnique({
        where: { code: body.code },
      });
      if (codeClash) {
        res
          .status(409)
          .json({ success: false, message: "BU code already exists" });
        return;
      }
    }

    if (body.parentBUId === id) {
      res
        .status(400)
        .json({ success: false, message: "A BU cannot be its own parent" });
      return;
    }

    // if parentBUId changed — recalculate ancestorIds
    // and cascade update to all children
    const parentChanged =
      body.parentBUId !== undefined && body.parentBUId !== existing.parentBUId;
    const newAncestorIds = parentChanged
      ? await resolveAncestorIds(body.parentBUId)
      : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.businessUnit.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.code !== undefined && { code: body.code }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.parentBUId !== undefined && { parentBUId: body.parentBUId }),
          ...(newAncestorIds !== undefined && { ancestorIds: newAncestorIds }),
        },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          ancestorIds: true,
          parentBU: { select: { id: true, name: true } },
        },
      });

      // cascade ancestorIds update to all children
      if (parentChanged) {
        const children = await tx.businessUnit.findMany({
          where: { ancestorIds: { has: id } },
          select: { id: true, ancestorIds: true },
        });

        for (const child of children) {
          // rebuild child's ancestorIds:
          // everything before this BU in its chain + new chain for this BU + this BU
          const idxInChild = child.ancestorIds.indexOf(id);
          const suffix = child.ancestorIds.slice(idxInChild); // keeps id + anything below
          const newChildAncestors = [...newAncestorIds, ...suffix];

          await tx.businessUnit.update({
            where: { id: child.id },
            data: { ancestorIds: newChildAncestors },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE",
          module: "business_units",
          recordId: id,
          oldData: { name: existing.name, isActive: existing.isActive },
          newData: body,
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });

      return u;
    });

    res.json({ success: true, message: "BU updated", data: updated });
  } catch (err) {
    console.error("updateBusinessUnit:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update business unit" });
  }
};

// ─────────────────────────────────────────
// DELETE /business-units/:id
// blocked if has clients, child BUs, requirements
// ─────────────────────────────────────────

export const deleteBusinessUnit = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actorId = req.user!.id;

    const bu = await prisma.businessUnit.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            clients: true,
            childBUs: true,
            requirementsBU: true,
          },
        },
      },
    });

    if (!bu) {
      res.status(404).json({ success: false, message: "BU not found" });
      return;
    }

    const blockers: string[] = [];
    if (bu._count.childBUs > 0)
      blockers.push(`${bu._count.childBUs} child BU(s)`);
    if (bu._count.clients > 0) blockers.push(`${bu._count.clients} client(s)`);
    if (bu._count.requirementsBU > 0)
      blockers.push(`${bu._count.requirementsBU} requirement(s)`);

    if (blockers.length > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — this BU has ${blockers.join(
          ", "
        )}. Remove them first.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.businessUnit.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "DELETE",
          module: "business_units",
          recordId: id,
          oldData: { name: bu.name },
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        },
      });
    });

    res.json({ success: true, message: "BU deleted" });
  } catch (err) {
    console.error("deleteBusinessUnit:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete business unit" });
  }
};
