// controller/client.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { clientScopeWhere } from "@/middleware/scopeFilter.middleware";

// ── GET /clients
export const getClients = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      buId,
      serviceLineId,
      page = "1",
      limit = "25",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100);

    const where: any = {
      ...clientScopeWhere(req.scopeFilter),
      deletedAt: null,
    };

    if (status) where.status = status;
    if (buId) where.businessUnitId = buId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { vmsName: { contains: search, mode: "insensitive" } },
        { industry: { contains: search, mode: "insensitive" } },
      ];
    }
    if (serviceLineId) {
      where.spocs = { some: { serviceLineId, isActive: true } };
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
          industry: true,
          status: true,
          createdAt: true,
          businessUnit: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          spocs: {
            where: { isActive: true },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              designation: true,
              isPrimary: true,
              handler: {
                select: { id: true, firstName: true, lastName: true },
              },
              serviceLine: { select: { id: true, name: true } },
            },
          },
          _count: { select: { requirements: true } },
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

// ── GET /clients/mine — clients where I handle at least one active spoc
export const getMyClients = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { search, limit = "200" } = req.query as Record<string, string>;

    const where: any = {
      deletedAt: null,
      status: "ACTIVE",
      spocs: { some: { handlerId: userId, isActive: true } },
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { vmsName: { contains: search, mode: "insensitive" } },
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        vmsName: true,
        industry: true,
        businessUnit: { select: { id: true, name: true } },
        spocs: {
          where: { handlerId: userId, isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            isPrimary: true,
            serviceLine: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
          },
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

// ── GET /clients/:id
export const getClientById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const client = await prisma.client.findFirst({
      where: { id, deletedAt: null, ...clientScopeWhere(req.scopeFilter) },
      select: {
        id: true,
        name: true,
        vmsName: true,
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
        spocs: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            designation: true,
            department: true,
            isPrimary: true,
            isActive: true,
            notes: true,
            createdAt: true,
            handler: { select: { id: true, firstName: true, lastName: true } },
            addedBy: { select: { id: true, firstName: true, lastName: true } },
            serviceLine: { select: { id: true, name: true } },
            businessUnit: { select: { id: true, name: true } },
          },
        },
        notes: {
          select: {
            id: true,
            content: true,
            createdAt: true,
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
        _count: { select: { requirements: true } },
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

// ── GET /clients/:id/spocs
export const getClientSpocs = async (req: Request, res: Response) => {
  try {
    const { id: clientId } = req.params;
    const { mine } = req.query as Record<string, string>;
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.isSuperAdmin;

    const client = await prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    const where: any = { clientId, isActive: true };

    // mine=true OR not superadmin → only spocs I handle
    if (mine === "true" || !isSuperAdmin) {
      where.handlerId = userId;
    }

    const spocs = await prisma.clientSpoc.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        designation: true,
        department: true,
        isPrimary: true,
        notes: true,
        handler: { select: { id: true, firstName: true, lastName: true } },
        serviceLine: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    res.json({ success: true, data: spocs });
  } catch (err) {
    console.error("getClientSpocs:", err);
    res.status(500).json({ success: false, message: "Failed to fetch spocs" });
  }
};

// ── POST /clients
export const createClient = async (req: Request, res: Response) => {
  try {
    const {
      name,
      vmsName,
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

// ── PUT /clients/:id
export const updateClient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      vmsName,
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

// ── PATCH /clients/:id/status
export const updateClientStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const actorId = req.user!.id;

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

// ── DELETE /clients/:id
export const deleteClient = async (req: Request, res: Response) => {
  try {
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

// ── POST /clients/:id/notes
export const addClientNote = async (req: Request, res: Response) => {
  try {
    const { id: clientId } = req.params;
    const { content } = req.body;
    const actorId = req.user!.id;

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

// ── DELETE /clients/:id/notes/:noteId
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

// ── POST /clients/:id/spocs
export const addSpoc = async (req: Request, res: Response) => {
  try {
    const { id: clientId } = req.params;
    const {
      firstName,
      lastName,
      email,
      phone,
      designation,
      department,
      handlerId,
      serviceLineId,
      businessUnitId,
      isPrimary,
      notes,
    } = req.body;
    const actorId = req.user!.id;

    const client = await prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    // duplicate check — same client + email + service line
    if (email) {
      const existing = await prisma.clientSpoc.findUnique({
        where: {
          clientId_email_serviceLineId: { clientId, email, serviceLineId },
        },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          message:
            "SPOC with this email already exists for this client + service line",
        });
        return;
      }
    }

    const spoc = await prisma.clientSpoc.create({
      data: {
        clientId,
        firstName,
        lastName,
        email: email ?? null,
        phone: phone ?? null,
        designation: designation ?? null,
        department: department ?? null,
        handlerId,
        serviceLineId,
        businessUnitId,
        isPrimary: isPrimary ?? false,
        isActive: true,
        notes: notes ?? null,
        addedById: actorId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        designation: true,
        department: true,
        isPrimary: true,
        isActive: true,
        notes: true,
        createdAt: true,
        handler: { select: { id: true, firstName: true, lastName: true } },
        serviceLine: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, message: "SPOC added", data: spoc });
  } catch (err) {
    console.error("addSpoc:", err);
    res.status(500).json({ success: false, message: "Failed to add SPOC" });
  }
};

// ── PATCH /clients/:id/spocs/:spocId
export const updateSpoc = async (req: Request, res: Response) => {
  try {
    const { id: clientId, spocId } = req.params;
    const {
      firstName,
      lastName,
      email,
      phone,
      designation,
      department,
      handlerId,
      isPrimary,
      notes,
    } = req.body;

    const existing = await prisma.clientSpoc.findFirst({
      where: { id: spocId, clientId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "SPOC not found" });
      return;
    }

    const updated = await prisma.clientSpoc.update({
      where: { id: spocId },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(designation !== undefined && { designation }),
        ...(department !== undefined && { department }),
        ...(handlerId !== undefined && { handlerId }),
        ...(isPrimary !== undefined && { isPrimary }),
        ...(notes !== undefined && { notes }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        designation: true,
        isPrimary: true,
        isActive: true,
        handler: { select: { id: true, firstName: true, lastName: true } },
        serviceLine: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, message: "SPOC updated", data: updated });
  } catch (err) {
    console.error("updateSpoc:", err);
    res.status(500).json({ success: false, message: "Failed to update SPOC" });
  }
};

// ── DELETE /clients/:id/spocs/:spocId
export const removeSpoc = async (req: Request, res: Response) => {
  try {
    const { id: clientId, spocId } = req.params;

    const existing = await prisma.clientSpoc.findFirst({
      where: { id: spocId, clientId, isActive: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "SPOC not found" });
      return;
    }

    await prisma.clientSpoc.update({
      where: { id: spocId },
      data: { isActive: false },
    });

    res.json({ success: true, message: "SPOC removed" });
  } catch (err) {
    console.error("removeSpoc:", err);
    res.status(500).json({ success: false, message: "Failed to remove SPOC" });
  }
};
