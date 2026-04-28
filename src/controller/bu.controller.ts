import { Request, Response } from "express";
import prisma from "@/utils/prisma/client";
import type { CreateBUInput, UpdateBUInput } from "@/validators/bu.validator";

// ─────────────────────────────────────────
// LIST BUSINESS UNITS
// GET /business-units
// Returns full tree — each BU with its children nested
// ─────────────────────────────────────────

export const listBusinessUnits = async (req: Request, res: Response) => {
  try {
    // Fetch all BUs flat with counts
    const all = await prisma.businessUnit.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        parentBUId: true,
        createdAt: true,
        _count: {
          select: {
            users: true,
            teams: true,
            clients: true,
            requirements: true,
          },
        },
      },
    });

    // Build tree client-side — group children under parents
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
    console.error("listBusinessUnits error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch business units" });
  }
};

// ─────────────────────────────────────────
// GET BU BY ID
// GET /business-units/:id
// ─────────────────────────────────────────

// import { Request, Response } from "express";
// import { prisma } from "../lib/prisma";

export const getBusinessUnitById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const bu = await prisma.businessUnit.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,

        // ── Parent chain (for breadcrumb) ──────────────────────
        parentBU: {
          select: {
            id: true,
            name: true,
            isActive: true,
            parentBU: {
              select: { id: true, name: true, isActive: true },
            },
          },
        },

        // ── Child BUs ──────────────────────────────────────────
        childBUs: {
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: { select: { users: true, teams: true, clients: true } },
            // grandchildren count only — no infinite nesting
            childBUs: {
              select: {
                id: true,
                name: true,
                isActive: true,
                _count: { select: { users: true } },
              },
              orderBy: { name: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },

        // ── Teams with members ─────────────────────────────────
        teams: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            category: true,
            nodeType: true,
            parentTeamId: true, // needed for recursive team tree on the frontend
            _count: {
              select: {
                members: { where: { isActive: true } },
              },
            },
            members: {
              where: { isActive: true },
              select: {
                id: true,
                teamRole: true,
                joinedAt: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    employeeId: true,
                  },
                },
              },
              orderBy: [
                // LEAD first, then CO_LEAD, then MEMBER
                { teamRole: "asc" },
                { joinedAt: "asc" },
              ],
            },
          },
          orderBy: { name: "asc" },
        },

        // ── Users with their team memberships ─────────────────
        users: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
            teamMemberships: {
              where: { isActive: true },
              select: {
                teamRole: true,
                team: { select: { id: true, name: true, category: true } },
              },
            },
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          take: 50,
        },

        // ── Clients with handler + open requirement count ──────
        clients: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            category: true,
            industry: true,
            status: true,
            handlers: {
              where: { status: "ACTIVE" },
              select: {
                role: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
              take: 3,
            },
            _count: {
              select: {
                requirements: {
                  where: { status: "ACTIVE", deletedAt: null },
                },
              },
            },
          },
          orderBy: { name: "asc" },
          take: 25,
        },

        // ── Requirements breakdown ─────────────────────────────
        requirements: {
          where: { deletedAt: null },
          select: {
            id: true,
            reqCode: true,
            title: true,
            status: true,
            priority: true,
            totalOpenings: true,
            filledOpenings: true,
            salaryMin: true,
            salaryMax: true,
            salaryType: true,
            respondBy: true,
            isRespondByBreached: true,
            client: { select: { id: true, name: true } },
          },
          orderBy: [
            // active/hot first
            { isRespondByBreached: "desc" },
            { updatedAt: "desc" },
          ],
          take: 20,
        },

        // ── Counts ────────────────────────────────────────────
        _count: {
          select: {
            users: true,
            teams: true,
            clients: { where: { deletedAt: null } },
            requirements: { where: { deletedAt: null } },
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

    // ── Requirements breakdown by status ──────────────────────
    const reqStatusCounts = await prisma.requirement.groupBy({
      by: ["status"],
      where: { businessUnitId: id, deletedAt: null },
      _count: { _all: true },
    });

    const reqBreakdown = Object.fromEntries(
      reqStatusCounts.map((r) => [r.status, r._count._all])
    );

    res.json({
      success: true,
      data: {
        ...bu,
        reqBreakdown, // { ACTIVE: 18, DRAFT: 7, ON_HOLD: 4, CLOSED: 9, ... }
      },
    });
  } catch (err) {
    console.error("getBusinessUnitById error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch business unit" });
  }
};

// ─────────────────────────────────────────
// CREATE BU
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
        .json({ success: false, message: "Business Unit name already exists" });
      return;
    }

    // Validate parent exists if provided
    if (body.parentBUId) {
      const parent = await prisma.businessUnit.findUnique({
        where: { id: body.parentBUId },
      });
      if (!parent) {
        res
          .status(404)
          .json({ success: false, message: "Parent Business Unit not found" });
        return;
      }
    }

    const bu = await prisma.businessUnit.create({
      data: {
        name: body.name,
        parentBUId: body.parentBUId ?? null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        parentBU: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "CREATE",
        module: "business_units",
        recordId: bu.id,
        newData: { name: bu.name },
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res
      .status(201)
      .json({ success: true, data: bu, message: "Business Unit created" });
  } catch (err) {
    console.error("createBusinessUnit error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create business unit" });
  }
};

// ─────────────────────────────────────────
// UPDATE BU
// PUT /business-units/:id
// ─────────────────────────────────────────

export const updateBusinessUnit = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as UpdateBUInput;
    const actorId = req.user!.id;

    const existing = await prisma.businessUnit.findUnique({ where: { id } });
    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Business Unit not found" });
      return;
    }

    // Name uniqueness if changing
    if (body.name && body.name !== existing.name) {
      const clash = await prisma.businessUnit.findUnique({
        where: { name: body.name },
      });
      if (clash) {
        res.status(409).json({
          success: false,
          message: "Business Unit name already exists",
        });
        return;
      }
    }

    // Prevent circular parent — can't set parent to self or own child
    if (body.parentBUId && body.parentBUId === id) {
      res
        .status(400)
        .json({ success: false, message: "A BU cannot be its own parent" });
      return;
    }

    const updated = await prisma.businessUnit.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.parentBUId !== undefined
          ? { parentBUId: body.parentBUId }
          : {}),
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        parentBU: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
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

    res.json({
      success: true,
      data: updated,
      message: "Business Unit updated",
    });
  } catch (err) {
    console.error("updateBusinessUnit error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update business unit" });
  }
};

// ─────────────────────────────────────────
// DELETE BU
// DELETE /business-units/:id
// Blocked if has users, teams, clients, or child BUs
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
            users: true,
            teams: true,
            clients: true,
            childBUs: true,
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

    const blockers = [];
    if (bu._count.users > 0) blockers.push(`${bu._count.users} user(s)`);
    if (bu._count.teams > 0) blockers.push(`${bu._count.teams} team(s)`);
    if (bu._count.clients > 0) blockers.push(`${bu._count.clients} client(s)`);
    if (bu._count.childBUs > 0)
      blockers.push(`${bu._count.childBUs} child BU(s)`);

    if (blockers.length > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete — this BU has ${blockers.join(
          ", "
        )}. Remove them first.`,
      });
      return;
    }

    await prisma.businessUnit.delete({ where: { id } });

    await prisma.auditLog.create({
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

    res.json({ success: true, message: "Business Unit deleted" });
  } catch (err) {
    console.error("deleteBusinessUnit error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete business unit" });
  }
};
