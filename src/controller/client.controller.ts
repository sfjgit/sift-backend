import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import {
  TCreateClientSchema,
  TGetAllClientsSchema,
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
        createdBy: req.user!.id,
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
      actorId: req.user.id,
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
    if (req.user!.role === "SALES") {
      where.createdBy = req.user!.id;
    }

    // delivery lead can only see clients in their BU
    if (req.user!.role === "DELIVERY_LEAD") {
      where.businessUnitId = req.user!.buId;
    }

    // admin sees all — no extra filter

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          category: true,
          status: true,
          businessUnit: { select: { id: true, name: true } },
          teamAssignments: {
            select: { teamId: true, team: { select: { name: true } } },
          },
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
