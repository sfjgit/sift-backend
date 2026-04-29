import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { reqScopeWhere } from "@/middleware/scopeFilter.middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clientScopeWhere(scopeFilter: any, userId: string) {
  if (!scopeFilter) return { deletedAt: null };

  switch (scopeFilter.type) {
    case "ALL":
      return { deletedAt: null };
    case "BU":
      return { deletedAt: null, businessUnitId: scopeFilter.businessUnitId };
    case "TEAM":
    case "MANAGER":
    case "OWN":
    default:
      // Sales / recruiters only see clients they handle or own contacts on
      return {
        deletedAt: null,
        OR: [
          { handlers: { some: { userId, status: "ACTIVE" } } },
          { contacts: { some: { ownerId: userId, status: "ACTIVE" } } },
        ],
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /clients
// ─────────────────────────────────────────────────────────────────────────────

export const getClients = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      category,
      industry,
      buId,
      handledByMe,
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const userId = req.user!.id;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const scopeWhere = clientScopeWhere(req.scopeFilter, userId);
    const where: any = { ...scopeWhere };

    if (status) where.status = status;
    if (category) where.category = category;
    if (buId) where.businessUnitId = buId;
    if (industry) where.industry = { contains: industry, mode: "insensitive" };
    if (handledByMe === "true") {
      where.handlers = { some: { userId, status: "ACTIVE" } };
    }
    if (search) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { vmsName: { contains: search, mode: "insensitive" } },
            { industry: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    const SORTABLE = ["name", "createdAt", "updatedAt", "status"];
    const orderBy = SORTABLE.includes(sortBy)
      ? { [sortBy]: sortDir as "asc" | "desc" }
      : { createdAt: "desc" as const };

    const [total, clients] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        select: {
          id: true,
          name: true,
          vmsName: true,
          category: true,
          industry: true,
          website: true,
          country: true,
          city: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          businessUnit: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
          handlers: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              role: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  employeeId: true,
                },
              },
            },
          },
          _count: {
            select: {
              contacts: true,
              requirements: true,
            },
          },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    res.json({
      success: true,
      data: clients,
      meta: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
      permissions: {
        canAdd: req.modulePermission.canAdd,
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getClients:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch clients" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /clients/mine  — only clients caller handles or owns contacts on
// ─────────────────────────────────────────────────────────────────────────────

export const getMyClients = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { search, limit = "200" } = req.query as Record<string, string>;

    const where: any = {
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        { handlers: { some: { userId, status: "ACTIVE" } } },
        { contacts: { some: { ownerId: userId, status: "ACTIVE" } } },
      ],
    };

    if (search) {
      where.AND = [
        { OR: where.OR },
        {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { vmsName: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
      delete where.OR;
    }

    const clients = await prisma.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        vmsName: true,
        industry: true,
        status: true,
        contacts: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            email: true,
            isPrimary: true,
          },
          orderBy: { isPrimary: "desc" },
        },
      },
      orderBy: { name: "asc" },
      take: Math.min(parseInt(limit), 500),
    });

    res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getMyClients:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch clients" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /clients/:id
// ─────────────────────────────────────────────────────────────────────────────

export const getClientById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const scopeWhere = clientScopeWhere(req.scopeFilter, userId);

    const client = await prisma.client.findFirst({
      where: { id, ...scopeWhere },
      select: {
        id: true,
        name: true,
        vmsName: true,
        category: true,
        industry: true,
        website: true,
        country: true,
        state: true,
        city: true,
        address: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        businessUnit: { select: { id: true, name: true } },
        parentClient: { select: { id: true, name: true } },
        childClients: { select: { id: true, name: true, status: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        handlers: {
          orderBy: { assignedAt: "desc" },
          select: {
            id: true,
            role: true,
            status: true,
            assignedAt: true,
            removedAt: true,
            removedReason: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
                phone: true,
              },
            },
            assignedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        contacts: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            email: true,
            phone: true,
            linkedinUrl: true,
            isPrimary: true,
            status: true,
            createdAt: true,
            owner: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        teamAssignments: {
          select: {
            id: true,
            assignedAt: true,
            team: { select: { id: true, name: true, category: true } },
            assignedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        notes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            author: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
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
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: {
          select: { requirements: true, contacts: true },
        },
      },
    });

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    res.json({
      success: true,
      data: client,
      permissions: {
        canEdit: req.modulePermission.canEdit,
        canDelete: req.modulePermission.canDelete,
      },
    });
  } catch (err) {
    console.error("getClientById:", err);
    res.status(500).json({ success: false, message: "Failed to fetch client" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /clients
// ─────────────────────────────────────────────────────────────────────────────

export const createClient = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canAdd) {
      res
        .status(403)
        .json({ success: false, message: "No permission to create clients" });
      return;
    }

    const {
      name,
      vmsName,
      category,
      industry,
      website,
      country,
      state,
      city,
      address,
      businessUnitId,
      parentClientId,
    } = req.body;

    const actorId = req.user!.id;

    const client = await prisma.client.create({
      data: {
        name,
        vmsName: vmsName ?? null,
        category: category ?? null,
        industry: industry ?? null,
        website: website ?? null,
        country: country ?? null,
        state: state ?? null,
        city: city ?? null,
        address: address ?? null,
        businessUnitId: businessUnitId ?? null,
        parentClientId: parentClientId ?? null,
        status: "PENDING",
        createdById: actorId,
      },
      select: { id: true, name: true, status: true, createdAt: true },
    });

    res
      .status(201)
      .json({ success: true, message: "Client created", data: client });
  } catch (err) {
    console.error("createClient:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create client" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /clients/:id
// ─────────────────────────────────────────────────────────────────────────────

export const updateClient = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res
        .status(403)
        .json({ success: false, message: "No permission to edit clients" });
      return;
    }

    const { id } = req.params;
    const {
      name,
      vmsName,
      category,
      industry,
      website,
      country,
      state,
      city,
      address,
      businessUnitId,
      parentClientId,
    } = req.body;

    const existing = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(vmsName !== undefined && { vmsName }),
        ...(category !== undefined && { category }),
        ...(industry !== undefined && { industry }),
        ...(website !== undefined && { website }),
        ...(country !== undefined && { country }),
        ...(state !== undefined && { state }),
        ...(city !== undefined && { city }),
        ...(address !== undefined && { address }),
        ...(businessUnitId !== undefined && { businessUnitId }),
        ...(parentClientId !== undefined && { parentClientId }),
      },
      select: { id: true, name: true, status: true, updatedAt: true },
    });

    res.json({ success: true, message: "Client updated", data: updated });
  } catch (err) {
    console.error("updateClient:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update client" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /clients/:id/status
// ─────────────────────────────────────────────────────────────────────────────

export const updateClientStatus = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id } = req.params;
    const { status } = req.body;
    const actorId = req.user!.id;

    if (!["PENDING", "ACTIVE", "INACTIVE"].includes(status)) {
      res.status(400).json({ success: false, message: "Invalid status" });
      return;
    }

    const data: any = { status };
    if (status === "ACTIVE") {
      data.approvedById = actorId;
      data.approvedAt = new Date();
    }

    const updated = await prisma.client.update({
      where: { id },
      data,
      select: { id: true, name: true, status: true },
    });

    res.json({
      success: true,
      message: `Client ${status.toLowerCase()}`,
      data: updated,
    });
  } catch (err) {
    console.error("updateClientStatus:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /clients/:id  — soft delete
// ─────────────────────────────────────────────────────────────────────────────

export const deleteClient = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canDelete) {
      res
        .status(403)
        .json({ success: false, message: "No permission to delete clients" });
      return;
    }

    const { id } = req.params;

    const existing = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    await prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true, message: "Client deleted" });
  } catch (err) {
    console.error("deleteClient:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete client" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// POST /clients/:id/handlers
export const addHandler = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId } = req.params;
    const { userId, role = "PRIMARY" } = req.body;
    const actorId = req.user!.id;

    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required" });
      return;
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    // Check if this user is already an active handler
    const existing = await prisma.clientHandler.findFirst({
      where: { clientId, userId, status: "ACTIVE" },
    });

    if (existing) {
      res
        .status(409)
        .json({ success: false, message: "User is already an active handler" });
      return;
    }

    const handler = await prisma.clientHandler.create({
      data: {
        clientId,
        userId,
        role,
        status: "ACTIVE",
        assignedById: actorId,
      },
      select: {
        id: true,
        role: true,
        status: true,
        assignedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
          },
        },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Handler added", data: handler });
  } catch (err) {
    console.error("addHandler:", err);
    res.status(500).json({ success: false, message: "Failed to add handler" });
  }
};

// DELETE /clients/:id/handlers/:handlerId
export const removeHandler = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId, handlerId } = req.params;
    const { reason } = req.body;

    const handler = await prisma.clientHandler.findFirst({
      where: { id: handlerId, clientId, status: "ACTIVE" },
    });

    if (!handler) {
      res.status(404).json({ success: false, message: "Handler not found" });
      return;
    }

    await prisma.clientHandler.update({
      where: { id: handlerId },
      data: {
        status: "REMOVED",
        removedAt: new Date(),
        removedReason: reason ?? null,
      },
    });

    res.json({ success: true, message: "Handler removed" });
  } catch (err) {
    console.error("removeHandler:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove handler" });
  }
};

// PATCH /clients/:id/handlers/:handlerId  — change role
export const updateHandlerRole = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId, handlerId } = req.params;
    const { role } = req.body;

    if (!["PRIMARY", "SECONDARY", "BACKUP"].includes(role)) {
      res.status(400).json({ success: false, message: "Invalid role" });
      return;
    }

    const handler = await prisma.clientHandler.findFirst({
      where: { id: handlerId, clientId, status: "ACTIVE" },
    });

    if (!handler) {
      res.status(404).json({ success: false, message: "Handler not found" });
      return;
    }

    const updated = await prisma.clientHandler.update({
      where: { id: handlerId },
      data: { role },
      select: { id: true, role: true, status: true },
    });

    res.json({ success: true, message: "Handler role updated", data: updated });
  } catch (err) {
    console.error("updateHandlerRole:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update handler role" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── CONTACTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /clients/:id/contacts
export const getContacts = async (req: Request, res: Response) => {
  try {
    const { id: clientId } = req.params;
    const { status } = req.query as Record<string, string>;

    const contacts = await prisma.clientContact.findMany({
      where: {
        clientId,
        ...(status ? { status } : { status: { not: "REMOVED" } }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        isPrimary: true,
        status: true,
        createdAt: true,
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    res.json({ success: true, data: contacts });
  } catch (err) {
    console.error("getContacts:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch contacts" });
  }
};

// POST /clients/:id/contacts
export const addContact = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId } = req.params;
    const {
      firstName,
      lastName,
      designation,
      email,
      phone,
      linkedinUrl,
      isPrimary,
      ownerId,
    } = req.body;
    const actorId = req.user!.id;

    if (!firstName || !email) {
      res
        .status(400)
        .json({ success: false, message: "firstName and email are required" });
      return;
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    const contact = await prisma.$transaction(async (tx) => {
      // If marking as primary, unset existing primary
      if (isPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId, isPrimary: true, status: "ACTIVE" },
          data: { isPrimary: false },
        });
      }

      return tx.clientContact.create({
        data: {
          clientId,
          firstName,
          lastName: lastName ?? null,
          designation: designation ?? null,
          email,
          phone: phone ?? null,
          linkedinUrl: linkedinUrl ?? null,
          isPrimary: isPrimary ?? false,
          status: "ACTIVE",
          ownerId: ownerId ?? actorId, // defaults to creator
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          email: true,
          phone: true,
          isPrimary: true,
          status: true,
          createdAt: true,
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });

    res
      .status(201)
      .json({ success: true, message: "Contact added", data: contact });
  } catch (err) {
    console.error("addContact:", err);
    res.status(500).json({ success: false, message: "Failed to add contact" });
  }
};

// PUT /clients/:id/contacts/:contactId
export const updateContact = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId, contactId } = req.params;
    const {
      firstName,
      lastName,
      designation,
      email,
      phone,
      linkedinUrl,
      isPrimary,
      ownerId,
    } = req.body;

    const existing = await prisma.clientContact.findFirst({
      where: { id: contactId, clientId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (isPrimary && !existing.isPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId, isPrimary: true, status: "ACTIVE" },
          data: { isPrimary: false },
        });
      }

      return tx.clientContact.update({
        where: { id: contactId },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(designation !== undefined && { designation }),
          ...(email !== undefined && { email }),
          ...(phone !== undefined && { phone }),
          ...(linkedinUrl !== undefined && { linkedinUrl }),
          ...(isPrimary !== undefined && { isPrimary }),
          ...(ownerId !== undefined && { ownerId }),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          email: true,
          phone: true,
          isPrimary: true,
          status: true,
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });

    res.json({ success: true, message: "Contact updated", data: updated });
  } catch (err) {
    console.error("updateContact:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update contact" });
  }
};

// DELETE /clients/:id/contacts/:contactId  — soft delete (REMOVED status)
export const removeContact = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId, contactId } = req.params;

    const existing = await prisma.clientContact.findFirst({
      where: { id: contactId, clientId, status: { not: "REMOVED" } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    await prisma.clientContact.update({
      where: { id: contactId },
      data: { status: "REMOVED" },
    });

    res.json({ success: true, message: "Contact removed" });
  } catch (err) {
    console.error("removeContact:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove contact" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── NOTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /clients/:id/notes
export const addClientNote = async (req: Request, res: Response) => {
  try {
    const { id: clientId } = req.params;
    const { content } = req.body;
    const actorId = req.user!.id;

    if (!content?.trim()) {
      res.status(400).json({ success: false, message: "Content is required" });
      return;
    }

    const note = await prisma.clientNote.create({
      data: { clientId, authorId: actorId, content: content.trim() },
      select: {
        id: true,
        content: true,
        createdAt: true,
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    console.error("addClientNote:", err);
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

// DELETE /clients/:id/notes/:noteId
export const deleteClientNote = async (req: Request, res: Response) => {
  try {
    const { id: clientId, noteId } = req.params;
    const actorId = req.user!.id;

    const note = await prisma.clientNote.findFirst({
      where: { id: noteId, clientId, authorId: actorId },
    });

    if (!note) {
      res
        .status(404)
        .json({ success: false, message: "Note not found or not yours" });
      return;
    }

    await prisma.clientNote.delete({ where: { id: noteId } });
    res.json({ success: true, message: "Note deleted" });
  } catch (err) {
    console.error("deleteClientNote:", err);
    res.status(500).json({ success: false, message: "Failed to delete note" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── TEAM ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────

// POST /clients/:id/teams
export const assignTeam = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId } = req.params;
    const { teamId } = req.body;
    const actorId = req.user!.id;

    if (!teamId) {
      res.status(400).json({ success: false, message: "teamId is required" });
      return;
    }

    const existing = await prisma.clientTeamAssignment.findUnique({
      where: { clientId_teamId: { clientId, teamId } },
    });

    if (existing) {
      res
        .status(409)
        .json({
          success: false,
          message: "Team already assigned to this client",
        });
      return;
    }

    const assignment = await prisma.clientTeamAssignment.create({
      data: { clientId, teamId, assignedById: actorId },
      select: {
        id: true,
        assignedAt: true,
        team: { select: { id: true, name: true, category: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Team assigned", data: assignment });
  } catch (err) {
    console.error("assignTeam:", err);
    res.status(500).json({ success: false, message: "Failed to assign team" });
  }
};

// DELETE /clients/:id/teams/:assignmentId
export const removeTeamAssignment = async (req: Request, res: Response) => {
  try {
    if (!req.modulePermission.canEdit) {
      res.status(403).json({ success: false, message: "No permission" });
      return;
    }

    const { id: clientId, assignmentId } = req.params;

    const existing = await prisma.clientTeamAssignment.findFirst({
      where: { id: assignmentId, clientId },
    });

    if (!existing) {
      res
        .status(404)
        .json({ success: false, message: "Team assignment not found" });
      return;
    }

    await prisma.clientTeamAssignment.delete({ where: { id: assignmentId } });
    res.json({ success: true, message: "Team removed from client" });
  } catch (err) {
    console.error("removeTeamAssignment:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove team assignment" });
  }
};
