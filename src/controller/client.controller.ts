import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import {
  TAssignContactHandlerSchema,
  TClientNoteSchema,
  TClientsIdSchema,
  TContactHandlerParamsSchema,
  TCreateClientSchema,
  TGetAllClientsSchema,
  TspocContactSchema,
} from "@/validators/client.validators";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";

export const createClient = async (req: Request, res: Response) => {
  try {
    const {
      name,
      vmsName,
      category,
      industry,
      website,
      country,
      state,
      city,
      businessUnitId,
    } = req.validatedBody as TCreateClientSchema;
    const existingClient = await prisma.client.findFirst({
      where: { name },
    });
    if (existingClient) {
      return res
        .status(400)
        .json({ success: false, message: "Client already exist" });
    }
    const addClient = await prisma.client.create({
      data: {
        name,
        createdById: req.user!.id,
        ...(vmsName !== undefined && { vmsName }),
        ...(category !== undefined && { category }),
        ...(industry !== undefined && { industry }),
        ...(website !== undefined && { website }),
        ...(country !== undefined && { country }),
        ...(state !== undefined && { state }),
        ...(city !== undefined && { city }),
        ...(businessUnitId !== undefined && { businessUnitId }),
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "CREATE",
      module: "CLIENT",
      recordId: addClient.id,
    });
    return res.status(201).json({
      success: true,
      message: "Client Created Successfully",
      data: addClient,
    });
  } catch (error) {
    console.error("Error creating client", error);
    return res
      .status(500)
      .json({ success: false, message: "Error in creating client" });
  }
};

export const getAllClients = async (req: Request, res: Response) => {
  try {
    const { name, status, category, buId, page, limit } =
      req.validatedQuery as TGetAllClientsSchema;

    const skip = (page - 1) * limit;

    // role-scoped filtering
    const where: Prisma.ClientWhereInput = {
      ...(name !== undefined && {
        name: { contains: name, mode: "insensitive" },
      }),
      ...(status !== undefined && { status }),
      ...(category !== undefined && { category }),
      ...(buId !== undefined && { businessUnitId: buId }),
    };

    // sales can only see clients they created
    // if (req.user!.role === "SALES") {
    //   where.createdBy = req.user!.id;
    // }

    // delivery lead can only see clients in their BU
    // if (req.user!.role === "DELIVERY_LEAD") {
    //   where.businessUnitId = req.user!.buId;
    // }

    // admin sees all — no extra filter

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        // select: {
        //   id: true,
        //   name: true,
        //   category: true,
        //   status: true,
        //   businessUnit: { select: { id: true, name: true } },
        //   teamAssignments: {
        //     select: { teamId: true, team: { select: { name: true } } },
        //   },
        // },
        include: {
          businessUnit: true,
          teamAssignments: true,
          contacts: true,
          handlers: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.client.count({ where }),
    ]);
    // await createAuditLog({
    //   actorId: req.user.id,
    //   action: "GET",
    //   module: "CLIENT",
    //   recordId: getAllClients,
    // });
    return res.status(200).json({
      success: true,
      data: clients,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

export const approveClients = async (req: Request, res: Response) => {
  try {
    // const { id } = req.validateParams;
    const { id } = req.validatedParams as TClientsIdSchema;
    const existingClient = await prisma.client.findUnique({
      where: { id },
    });
    if (!existingClient) {
      return res
        .status(400)
        .json({ success: false, message: "Client doesn't exist" });
    }
    if (existingClient.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Only pending clients can be approved",
      });
    }
    const approval = await prisma.client.update({
      where: { id },
      data: {
        status: "ACTIVE",
        approvedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        status: true,
        approvedAt: true,
      },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "APPROVE",
      module: "CLIENT",
      recordId: id,
    });
    return res.status(200).json({
      success: true,
      message: "Client got approved successfully",
      data: approval,
    });
  } catch (error) {
    console.error("Error approving client", error);
    return res
      .status(500)
      .json({ success: true, message: "Internal server error" });
  }
};

export const getSingleClientDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams as TClientsIdSchema;
    const existing = await prisma.client.findUnique({
      where: { id },
      include: {
        parentClient: true,
        childClients: true,
        contacts: true,
        handlers: true,
        teamAssignments: true,
        requirements: true,
        notes: true,
      },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Client doesn not exist" });
    }
    if (req.user!.role === "SALES" && existing.createdById !== req.user!.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (
      req.user!.role === "DELIVERY_LEAD" &&
      existing.businessUnitId !== req.user!.id
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const client = await prisma.client.findMany({
      where: { id },
      select: {
        id: true,
        name: true,
        vmsName: true,
        category: true,
        industry: true,
        website: true,
        country: true,
        state: true,
        status: true,
        businessUnit: { select: { id: true, name: true } },
        contacts: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true,
            isPrimary: true,
          },
        },
        handlers: {
          select: {
            id: true,
            userId: true,
            role: true,
            assignedAt: true,
          },
        },
        teamAssignments: {
          select: {
            id: true,
            teamId: true,
            team: { select: { id: true, name: true } },
            assignedAt: true,
          },
        },
        requirements: {
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    return res.status(200).json({ success: true, data: client });
  } catch (error) {
    console.error("Error fetching client details:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

//Add a SPOC to the client.
export const spocContact = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams as TClientsIdSchema;
    const {
      firstName,
      lastName,
      designation,
      email,
      phone,
      linkedinUrl,
      isPrimary,
    } = req.validatedBody as TspocContactSchema;

    const existingClient = await prisma.client.findUnique({ where: { id } });
    if (!existingClient) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    const existingContact = await prisma.clientContact.findFirst({
      where: { clientId: id, email },
    });
    if (existingContact) {
      return res.status(400).json({
        success: false,
        message: "Contact with this email already exists",
      });
    }

    // unset previous primary if new one is primary
    if (isPrimary) {
      await prisma.clientContact.updateMany({
        where: { clientId: id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const newContact = await prisma.clientContact.create({
      data: {
        clientId: id,
        firstName,
        email,
        ...(lastName !== undefined && { lastName }),
        ...(designation !== undefined && { designation }),
        ...(phone !== undefined && { phone }),
        ...(linkedinUrl !== undefined && { linkedinUrl }),
        ...(isPrimary !== undefined && { isPrimary }),
      } as Prisma.ClientContactUncheckedCreateInput,
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        designation: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        isPrimary: true,
        isActive: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: "CREATE",
      module: "CLIENT_CONTACT",
      recordId: newContact.id,
    });

    return res.status(201).json({
      success: true,
      message: "SPOC created successfully",
      data: newContact,
    });
  } catch (error) {
    console.error("Error creating SPOC:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Assign a user to handle a specific SPOC
export const assignContactHandler = async (req: Request, res: Response) => {
  try {
    const { id, contactId } =
      req.validatedParams as TContactHandlerParamsSchema;
    const { userId } = req.validatedBody as TAssignContactHandlerSchema;

    // check client exists
    const existingClient = await prisma.client.findUnique({ where: { id } });
    if (!existingClient) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    // check contact exists and belongs to this client
    const existingContact = await prisma.clientContact.findFirst({
      where: { id: contactId, clientId: id },
    });
    if (!existingContact) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }

    // check user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existingUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // check if already assigned
    const alreadyAssigned = await prisma.contactHandler.findUnique({
      where: { contactId_userId: { contactId, userId } },
    });
    if (alreadyAssigned) {
      return res.status(400).json({
        success: false,
        message: "User already assigned to this contact",
      });
    }

    const handler = await prisma.contactHandler.create({
      data: {
        contactId,
        userId,
        assignedById: req.user!.id,
      } as Prisma.ContactHandlerUncheckedCreateInput,
      select: {
        id: true,
        contactId: true,
        userId: true,
        assignedBy: true,
        assignedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: "CREATE",
      module: "CONTACT_HANDLER",
      recordId: handler.id,
    });

    return res.status(201).json({
      success: true,
      message: "Handler assigned to contact successfully",
      data: handler,
    });
  } catch (error) {
    console.error("Error assigning contact handler:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Add a note to the client.
export const clientNote = async (req: Request, res: Response) => {
  try {
    const { id } = req.validatedParams as TClientsIdSchema;
    const { content } = req.validatedBody as TClientNoteSchema;
    const existingClient = await prisma.client.findUnique({ where: { id } });
    if (!existingClient) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }
    const notes = await prisma.clientNote.create({
      data: {
        clientId: id,
        authorId: req.user!.id,
        content,
      } as Prisma.ClientNoteUncheckedCreateInput,
      select: {
        id: true,
        clientId: true,
        authorId: true,
        content: true,
        createdAt: true,
      },
    });
    await createAuditLog({
      actorId: req.user!.id,
      action: "CREATE",
      module: "CLIENT_NOTE",
      recordId: notes.id,
    });
    return res.status(201).json({
      success: true,
      message: "Added a note successfully",
      data: notes,
    });
  } catch (error) {
    console.error("Error Adding note to client");
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};
