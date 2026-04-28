import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
// import prisma from "@/lib/prisma";

/**
 * 🔒 Helper: enforce BU scope
 */
const getUserBU = (req: Request) => {
  const user = req.user as any;
  return {
    isSuperAdmin: user.isSuperAdmin,
    businessUnitId: user.businessUnitId,
    userId: user.id,
  };
};

/**
 * ─────────────────────────────────────────────
 * CREATE CLIENT
 * ─────────────────────────────────────────────
 */
export const createClient = async (req: Request, res: Response) => {
  const { isSuperAdmin, businessUnitId, userId } = getUserBU(req);

  const data = req.body;

  const client = await prisma.client.create({
    data: {
      ...data,
      businessUnitId: isSuperAdmin ? data.businessUnitId : businessUnitId,

      createdById: userId,
    },
  });

  res.json({ success: true, data: client });
};

/**
 * ─────────────────────────────────────────────
 * GET ALL CLIENTS (FILTERED)
 * ─────────────────────────────────────────────
 */
// import { Request, Response } from "express";
// import prisma from "@/utils/prisma/client";

/**
 * ─────────────────────────────────────────────
 * GET ALL CLIENTS (FIXED + SCOPE AWARE)
 * ─────────────────────────────────────────────
 */
export const getAllClients = async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      category,
      handlerId,
      teamId,
      hasActiveRequirements,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as any;

    // 🔥 Fix: convert to numbers
    const pageNum = Number(page);
    const limitNum = Number(limit);

    // 🔥 Base where
    const where: any = {
      deletedAt: null,
    };

    /**
     * ─────────────────────────────────────────
     * 🔒 APPLY SCOPE FILTER (VERY IMPORTANT)
     * ─────────────────────────────────────────
     */
    const scope = req.scopeFilter;

    if (scope.type === "BU") {
      where.businessUnitId = scope.businessUnitId;
    }

    if (scope.type === "OWN") {
      where.createdById = scope.userId;
    }

    if (scope.type === "TEAM" || scope.type === "MANAGER") {
      where.teamAssignments = {
        some: {
          teamId: { in: scope.teamIds || [] },
        },
      };
    }

    /**
     * ─────────────────────────────────────────
     * FILTERS
     * ─────────────────────────────────────────
     */

    if (status) where.status = status;
    if (category) where.category = category;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { industry: { contains: search, mode: "insensitive" } },
      ];
    }

    if (handlerId) {
      where.handlers = {
        some: {
          userId: handlerId,
          status: "ACTIVE",
        },
      };
    }

    if (teamId) {
      where.teamAssignments = {
        some: {
          teamId,
        },
      };
    }

    if (hasActiveRequirements) {
      where.requirements = {
        some: {
          status: "ACTIVE",
        },
      };
    }

    /**
     * ─────────────────────────────────────────
     * QUERY
     * ─────────────────────────────────────────
     */

    const [data, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          handlers: true,
          teamAssignments: true,
          _count: {
            select: {
              requirements: true,
            },
          },
        },
        orderBy: {
          [sortBy || "createdAt"]: sortOrder === "asc" ? "asc" : "desc",
        },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.client.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (err) {
    console.error("getAllClients error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch clients",
    });
  }
};

/**
 * ─────────────────────────────────────────────
 * GET SINGLE CLIENT (DEEP VIEW)
 * ─────────────────────────────────────────────
 */
export const getClientById = async (req: Request, res: Response) => {
  const { id } = req.params;

  const client = await prisma.client.findFirst({
    where: {
      id,
      deletedAt: null,
    },
    include: {
      contacts: {
        include: {
          handlers: {
            include: {
              user: true,
            },
          },
        },
      },
      handlers: {
        include: {
          user: true,
        },
      },
      teamAssignments: {
        include: {
          team: true,
        },
      },
      requirements: {
        take: 5, // 🔥 limit for performance
        orderBy: { createdAt: "desc" },
      },
      notes: true,
    },
  });

  res.json({ success: true, data: client });
};

/**
 * ─────────────────────────────────────────────
 * UPDATE CLIENT
 * ─────────────────────────────────────────────
 */
export const updateClient = async (req: Request, res: Response) => {
  const { id } = req.params;

  const updated = await prisma.client.update({
    where: { id },
    data: req.body,
  });

  res.json({ success: true, data: updated });
};

/**
 * ─────────────────────────────────────────────
 * DELETE (SOFT)
 * ─────────────────────────────────────────────
 */
export const deleteClient = async (req: Request, res: Response) => {
  const { id } = req.params;

  await prisma.client.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  res.json({ success: true });
};

/**
 * ─────────────────────────────────────────────
 * APPROVE CLIENT
 * ─────────────────────────────────────────────
 */
export const approveClient = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId } = getUserBU(req);

  const updated = await prisma.client.update({
    where: { id },
    data: {
      status: "ACTIVE",
      approvedById: userId,
      approvedAt: new Date(),
    },
  });

  res.json({ success: true, data: updated });
};

/**
 * ─────────────────────────────────────────────
 * CONTACTS (SPOC)
 * ─────────────────────────────────────────────
 */

export const addClientContact = async (req: Request, res: Response) => {
  const { id } = req.params;

  const contact = await prisma.clientContact.create({
    data: {
      ...req.body,
      clientId: id,
    },
  });

  res.json({ success: true, data: contact });
};

export const updateClientContact = async (req: Request, res: Response) => {
  const { contactId } = req.params;

  const updated = await prisma.clientContact.update({
    where: { id: contactId },
    data: req.body,
  });

  res.json({ success: true, data: updated });
};

export const removeClientContact = async (req: Request, res: Response) => {
  const { contactId } = req.params;

  await prisma.clientContact.update({
    where: { id: contactId },
    data: { status: "REMOVED" },
  });

  res.json({ success: true });
};

/**
 * ─────────────────────────────────────────────
 * CONTACT HANDLERS
 * ─────────────────────────────────────────────
 */

export const assignContactHandler = async (req: Request, res: Response) => {
  const { contactId } = req.params;
  const { userId, role } = req.body;

  const handler = await prisma.clientHandler.create({
    data: {
      clientId: undefined as any, // ⚠️ depends on your design (if shared or not)
      userId,
      role,
      assignedById: (req.user as any).id,
    },
  });

  res.json({ success: true, data: handler });
};

export const removeContactHandler = async (req: Request, res: Response) => {
  const { handlerId } = req.params as any;

  await prisma.clientHandler.update({
    where: { id: handlerId },
    data: {
      status: "REMOVED",
      removedAt: new Date(),
    },
  });

  res.json({ success: true });
};

/**
 * ─────────────────────────────────────────────
 * CLIENT HANDLERS
 * ─────────────────────────────────────────────
 */

export const assignClientHandler = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId, role } = req.body;

  const handler = await prisma.clientHandler.create({
    data: {
      clientId: id,
      userId,
      role,
      assignedById: (req.user as any).id,
    },
  });

  res.json({ success: true, data: handler });
};

export const removeClientHandler = async (req: Request, res: Response) => {
  const { handlerId } = req.params as any;

  await prisma.clientHandler.update({
    where: { id: handlerId },
    data: {
      status: "REMOVED",
      removedAt: new Date(),
    },
  });

  res.json({ success: true });
};

/**
 * ─────────────────────────────────────────────
 * CLIENT ↔ TEAM
 * ─────────────────────────────────────────────
 */

export const assignClientToTeam = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { teamId } = req.body;

  const assignment = await prisma.clientTeamAssignment.create({
    data: {
      clientId: id,
      teamId,
      assignedById: (req.user as any).id,
    },
  });

  res.json({ success: true, data: assignment });
};

export const removeClientFromTeam = async (req: Request, res: Response) => {
  const { id, teamId } = req.params;

  await prisma.clientTeamAssignment.delete({
    where: {
      clientId_teamId: {
        clientId: id,
        teamId,
      },
    },
  });

  res.json({ success: true });
};

/**
 * ─────────────────────────────────────────────
 * NOTES
 * ─────────────────────────────────────────────
 */

export const addClientNote = async (req: Request, res: Response) => {
  const { id } = req.params;

  const note = await prisma.clientNote.create({
    data: {
      clientId: id,
      authorId: (req.user as any).id,
      content: req.body.content,
    },
  });

  res.json({ success: true, data: note });
};
