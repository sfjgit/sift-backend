// controller/client.controller.ts
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import { clientScopeWhere } from "@/middleware/scopeFilter.middleware";
import { CreateClientInput } from "@/validators/client.validators";

// ── GET /clients// File: client.controller.ts (getClients function only)
// Path: src/controller/client.controller.ts

// File: client.controller.ts (read paths — replace getClients, getMyClients, getClientById)
// Path: src/controller/client.controller.ts
//
// All three now select bands.value (NOT stringValue) so reads match the
// write paths (createClient / updateClient) and the Band model.

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

    const userId = req.user!.id;
    const scope = req.scopeFilter?.type; // "OWN" | "DEPARTMENT" | "BU" | "ALL"

    // ── Build scope-based client filter ───────────────────────────────────────
    let scopeClause: any = {};

    if (req.user!.isSuperAdmin || scope === "ALL") {
      scopeClause = {};
    } else if (scope === "DEPARTMENT") {
      const subordinates = await prisma.user.findMany({
        where: { reportingToId: userId, isActive: true },
        select: { id: true },
      });
      const handlerIds = [userId, ...subordinates.map((u) => u.id)];
      scopeClause = {
        spocs: { some: { handlerId: { in: handlerIds }, isActive: true } },
      };
    } else {
      scopeClause = {
        spocs: { some: { handlerId: userId, isActive: true } },
      };
    }

    const where: any = { ...scopeClause, deletedAt: null };

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
      if (where.spocs?.some) {
        where.spocs.some = { ...where.spocs.some, serviceLineId };
      } else {
        where.spocs = { some: { serviceLineId, isActive: true } };
      }
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
          website: true,
          country: true,
          state: true,
          city: true,
          address: true,
          status: true,
          createdAt: true,
          // pricing / agreement — needed by card + edit sheet
          agreementType: true,
          percentageValue: true,
          bands: {
            select: {
              id: true,
              name: true,
              code: true,
              rangeFrom: true,
              rangeTo: true,
              value: true,
              experience: true,
            },
          },
          businessUnit: { select: { id: true, name: true } },
          parentClient: { select: { id: true, name: true } },
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
        agreementType: true,
        percentageValue: true,
        bands: {
          select: {
            id: true,
            name: true,
            code: true,
            rangeFrom: true,
            rangeTo: true,
            value: true,
            experience: true,
          },
        },
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
        agreementType: true,
        percentageValue: true,
        bands: {
          select: {
            id: true,
            name: true,
            code: true,
            rangeFrom: true,
            rangeTo: true,
            value: true,
            experience: true,
          },
        },
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
            clientSpocDms: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                spocId: true,
                createdAt: true,
                dm: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    email: true,
                    role: { select: { id: true, name: true } },
                  },
                },
              },
            },
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

// ── GET /clients/mine — clients where I handle at least one active spoc
// export const getMyClients = async (req: Request, res: Response) => {
//   try {
//     const userId = req.user!.id;
//     const { search, limit = "200" } = req.query as Record<string, string>;

//     const where: any = {
//       deletedAt: null,
//       status: "ACTIVE",
//       spocs: { some: { handlerId: userId, isActive: true } },
//     };

//     if (search) {
//       where.OR = [
//         { name: { contains: search, mode: "insensitive" } },
//         { vmsName: { contains: search, mode: "insensitive" } },
//       ];
//     }

//     const clients = await prisma.client.findMany({
//       where,
//       select: {
//         id: true,
//         name: true,
//         vmsName: true,
//         industry: true,
//         agreementType: true,
//         percentageValue: true,
//         bands: {
//           select: {
//             id: true,
//             name: true,
//             rangeFrom: true,
//             rangeTo: true,
//             stringValue: true,
//             experience: true,
//             code: true,
//           },
//         },
//         businessUnit: { select: { id: true, name: true } },
//         spocs: {
//           where: { handlerId: userId, isActive: true },
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             designation: true,
//             isPrimary: true,
//             serviceLine: { select: { id: true, name: true } },
//             businessUnit: { select: { id: true, name: true } },
//           },
//         },
//       },
//       orderBy: { name: "asc" },
//       take: Math.min(parseInt(limit), 500),
//     });

//     res.json({ success: true, data: clients });
//   } catch (err) {
//     console.error("getMyClients:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Failed to fetch clients" });
//   }
// };

// // ── GET /clients/:id
// // File: client.controller.ts
// // Path: src/controller/client.controller.ts

// // ─────────────────────────────────────────────────────────────────────────────
// // getClientById — add clientSpocDms inside spocs select
// // ─────────────────────────────────────────────────────────────────────────────

// export const getClientById = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;

//     const client = await prisma.client.findFirst({
//       where: { id, deletedAt: null, ...clientScopeWhere(req.scopeFilter) },
//       select: {
//         id: true,
//         name: true,
//         vmsName: true,
//         industry: true,
//         website: true,
//         country: true,
//         state: true,
//         city: true,
//         address: true,
//         status: true,
//         createdAt: true,
//         updatedAt: true,
//         approvedAt: true,
//         agreementType: true,
//         percentageValue: true,
//         bands: {
//           select: {
//             id: true,
//             name: true,
//             rangeFrom: true,
//             rangeTo: true,
//             stringValue: true,
//             experience: true,
//             code: true,
//           },
//         },
//         businessUnit: { select: { id: true, name: true } },
//         parentClient: { select: { id: true, name: true } },
//         childClients: { select: { id: true, name: true, status: true } },
//         createdBy: { select: { id: true, firstName: true, lastName: true } },
//         approvedBy: { select: { id: true, firstName: true, lastName: true } },
//         spocs: {
//           orderBy: { createdAt: "desc" },
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             email: true,
//             phone: true,
//             designation: true,
//             department: true,
//             isPrimary: true,
//             isActive: true,
//             notes: true,
//             createdAt: true,
//             handler: { select: { id: true, firstName: true, lastName: true } },
//             addedBy: { select: { id: true, firstName: true, lastName: true } },
//             serviceLine: { select: { id: true, name: true } },
//             businessUnit: { select: { id: true, name: true } },
//             // ── DM tags ───────────────────────────────────────────────────
//             clientSpocDms: {
//               orderBy: { createdAt: "asc" },
//               select: {
//                 id: true,
//                 spocId: true,
//                 createdAt: true,
//                 dm: {
//                   select: {
//                     id: true,
//                     firstName: true,
//                     lastName: true,
//                     displayName: true,
//                     email: true,
//                     role: { select: { id: true, name: true } },
//                   },
//                 },
//               },
//             },
//           },
//         },
//         notes: {
//           select: {
//             id: true,
//             content: true,
//             createdAt: true,
//             author: { select: { id: true, firstName: true, lastName: true } },
//           },
//           orderBy: { createdAt: "desc" },
//         },
//         requirements: {
//           where: { deletedAt: null },
//           select: {
//             id: true,
//             reqCode: true,
//             title: true,
//             status: true,
//             priority: true,
//             totalOpenings: true,
//             createdAt: true,
//           },
//           orderBy: { createdAt: "desc" },
//           take: 20,
//         },
//         _count: { select: { requirements: true } },
//       },
//     });

//     if (!client) {
//       res.status(404).json({ success: false, message: "Client not found" });
//       return;
//     }

//     res.json({
//       success: true,
//       data: client,
//       permissions: {
//         canEdit: req.modulePermission.canEdit,
//         canDelete: req.modulePermission.canDelete,
//       },
//     });
//   } catch (err) {
//     console.error("getClientById:", err);
//     res.status(500).json({ success: false, message: "Failed to fetch client" });
//   }
// };

// ─────────────────────────────────────────────────────────────────────────────
// getClientSpocs — add clientSpocDms so the standalone spocs endpoint
// also returns DM tags (used by requirement forms / other places that call
// GET /clients/:id/spocs directly)
// ─────────────────────────────────────────────────────────────────────────────

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
        // ── DM tags ─────────────────────────────────────────────────────────
        clientSpocDms: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            spocId: true,
            createdAt: true,
            dm: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
                role: { select: { id: true, name: true } },
              },
            },
          },
        },
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
      agreementType,
      bands,
      percentage,
    } = req.body as CreateClientInput;

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

        agreementType: agreementType ?? "FIXED",

        percentageValue: agreementType === "FIXED" ? percentage ?? null : null,

        bands:
          agreementType === "BAND" && bands?.length
            ? {
                create: bands.map((band) => ({
                  name: band.name ?? null,
                  code: band.code,
                  // stringValue: band.stringValue,
                  rangeFrom: band.rangeFrom,
                  rangeTo: band.rangeTo,
                  value: band.value,
                  experience: band.experience ?? null,
                })),
              }
            : undefined,
      },

      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        bands: true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Client created",
      data: client,
    });
  } catch (err) {
    console.error("createClient:", err);

    res.status(500).json({
      success: false,
      message: "Failed to create client",
    });
  }
};

// File: client.controller.ts (updateClient — replace the existing PUT handler)
// Path: src/controller/client.controller.ts

// ── PATCH /clients/:id
// Full client edit: scalars + agreement type + percentage + bands + status.
// Partial by design — only fields present in the body are touched.
export const updateClient1 = async (req: Request, res: Response) => {
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
      status,
      agreementType,
      percentage,
      bands,
    } = req.body as Partial<CreateClientInput> & {
      status?: "PENDING" | "ACTIVE" | "INACTIVE";
    };

    const actorId = req.user!.id;

    const existing = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, agreementType: true, approvedById: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    // The agreement type that will be in effect after this update.
    const effectiveType = agreementType ?? existing.agreementType ?? "FIXED";

    // Only rewrite pricing/bands when the request actually carries pricing intent.
    const touchesPricing =
      agreementType !== undefined ||
      percentage !== undefined ||
      bands !== undefined;

    const data: any = {
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
    };

    // Status change — stamp approval metadata on first activation only,
    // mirroring updateClientStatus so this path can't silently skip it.
    if (status !== undefined) {
      data.status = status;
      if (status === "ACTIVE" && !existing.approvedById) {
        data.approvedById = actorId;
        data.approvedAt = new Date();
      }
    }

    if (agreementType !== undefined) data.agreementType = agreementType;

    // percentageValue is only meaningful for FIXED; null it out otherwise.
    if (touchesPricing) {
      data.percentageValue =
        effectiveType === "FIXED" ? percentage ?? null : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id }, data });

      // Bands: form rows carry no stable id, so replace wholesale.
      // Runs when agreement type changed OR bands were sent.
      if (touchesPricing) {
        await tx.band.deleteMany({ where: { clientId: id } });

        if (effectiveType === "BAND" && bands?.length) {
          await tx.band.createMany({
            data: bands.map((b) => ({
              clientId: id,
              name: b.name ?? null,
              code: b.code,
              rangeFrom: b.rangeFrom ?? null,
              rangeTo: b.rangeTo ?? null,
              value: b.value ?? null, // ⚠ column name — see note in reply
              experience: b.experience ?? null,
            })),
          });
        }
      }

      return tx.client.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          agreementType: true,
          percentageValue: true,
          bands: {
            select: {
              id: true,
              name: true,
              code: true,
              rangeFrom: true,
              rangeTo: true,
              value: true,
              experience: true,
            },
          },
        },
      });
    });

    res.json({ success: true, message: "Client updated", data: updated });
  } catch (err) {
    console.error("updateClient:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update client" });
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
      status,
      agreementType,
      percentage,
      bands,
    } = req.body as Partial<CreateClientInput> & {
      status?: "PENDING" | "ACTIVE" | "INACTIVE";
    };

    const actorId = req.user!.id;

    const existing = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, agreementType: true, approvedById: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    // The agreement type that will be in effect after this update.
    const effectiveType = agreementType ?? existing.agreementType ?? "FIXED";

    // Only rewrite pricing/bands when the request actually carries pricing intent.
    const touchesPricing =
      agreementType !== undefined ||
      percentage !== undefined ||
      bands !== undefined;

    const data: any = {
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
    };

    // Status change — stamp approval metadata on first activation only,
    // mirroring updateClientStatus so this path can't silently skip it.
    if (status !== undefined) {
      data.status = status;
      if (status === "ACTIVE" && !existing.approvedById) {
        data.approvedById = actorId;
        data.approvedAt = new Date();
      }
    }

    if (agreementType !== undefined) data.agreementType = agreementType;

    // percentageValue is only meaningful for FIXED; null it out otherwise.
    if (touchesPricing) {
      data.percentageValue =
        effectiveType === "FIXED" ? percentage ?? null : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id }, data });

      // Bands: form rows carry no stable id, so replace wholesale.
      // Runs when agreement type changed OR bands were sent.
      if (touchesPricing) {
        await tx.band.deleteMany({ where: { clientId: id } });

        if (effectiveType === "BAND" && bands?.length) {
          await tx.band.createMany({
            data: bands.map((b) => ({
              clientId: id,
              name: b.name ?? null,
              code: b.code,
              rangeFrom: b.rangeFrom ?? null,
              rangeTo: b.rangeTo ?? null,
              value: b.value ?? null, // ⚠ column name — see note in reply
              experience: b.experience ?? null,
            })),
          });
        }
      }

      return tx.client.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          agreementType: true,
          percentageValue: true,
          bands: {
            select: {
              id: true,
              name: true,
              code: true,
              rangeFrom: true,
              rangeTo: true,
              value: true,
              experience: true,
            },
          },
        },
      });
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

// File: client.controller.ts  (append these functions)
// Path: src/controller/client.controller.ts

// import prisma from "@/utils/prisma/client";
// import { Request, Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// SPOC DM MANAGEMENT
// ClientSpocDM — junction between ClientSpoc and User (the delivery manager)
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /clients/:id/spocs/:spocId/dms
// Returns all DMs currently tagged on this SPOC
export const getSpocDMs = async (req: Request, res: Response) => {
  try {
    const { id: clientId, spocId } = req.params;

    const spoc = await prisma.clientSpoc.findFirst({
      where: { id: spocId, clientId, isActive: true },
      select: { id: true },
    });

    if (!spoc) {
      res.status(404).json({ success: false, message: "SPOC not found" });
      return;
    }

    const dms = await prisma.clientSpocDM.findMany({
      where: { spocId },
      select: {
        id: true,
        spocId: true,
        createdAt: true,
        dm: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            employeeId: true,
            role: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ success: true, data: dms });
  } catch (err) {
    console.error("getSpocDMs:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch SPOC DMs" });
  }
};

// ── POST /clients/:id/spocs/:spocId/dms
// Tag one or more DMs on a SPOC (idempotent — skips duplicates)
export const addSpocDMs = async (req: Request, res: Response) => {
  try {
    const { id: clientId, spocId } = req.params;
    // Accept a single dmId or an array for bulk tagging
    const { dmId, dmIds } = req.body as { dmId?: string; dmIds?: string[] };

    const spoc = await prisma.clientSpoc.findFirst({
      where: { id: spocId, clientId, isActive: true },
      select: { id: true },
    });

    if (!spoc) {
      res.status(404).json({ success: false, message: "SPOC not found" });
      return;
    }

    // Normalise to array — accept single dmId or dmIds[]
    const ids: string[] = dmIds?.length ? dmIds : dmId ? [dmId] : [];

    if (!ids.length) {
      res
        .status(400)
        .json({ success: false, message: "dmId or dmIds required" });
      return;
    }

    // Verify all provided IDs are real, active users
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });

    if (users.length !== ids.length) {
      res.status(400).json({
        success: false,
        message: "One or more user IDs are invalid or inactive",
      });
      return;
    }

    // Find already-tagged DMs to skip duplicates without an error
    const existing = await prisma.clientSpocDM.findMany({
      where: { spocId, dmId: { in: ids } },
      select: { dmId: true },
    });
    const existingSet = new Set(existing.map((e) => e.dmId));
    const toInsert = ids.filter((id) => !existingSet.has(id));

    let created: { id: string; dmId: string }[] = [];
    if (toInsert.length) {
      // createMany doesn't return records in Prisma by default — use a transaction
      await prisma.$transaction(
        toInsert.map((id) =>
          prisma.clientSpocDM.create({
            data: { spocId, dmId: id },
            select: { id: true, dmId: true },
          })
        )
      );

      // Re-fetch to return full shape
      created = await prisma.clientSpocDM
        .findMany({
          where: { spocId, dmId: { in: toInsert } },
          select: {
            id: true,
            dmId: true,
            createdAt: true,
            dm: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
                role: { select: { id: true, name: true } },
              },
            },
          },
        })
        .then((rows) => rows as any[]);
    }

    res.status(201).json({
      success: true,
      message: toInsert.length
        ? `${toInsert.length} DM(s) tagged`
        : "All DMs already tagged — no changes made",
      data: created,
      skipped: existing.map((e) => e.dmId),
    });
  } catch (err) {
    console.error("addSpocDMs:", err);
    res.status(500).json({ success: false, message: "Failed to tag DM(s)" });
  }
};

// ── DELETE /clients/:id/spocs/:spocId/dms/:spocDmId
// Remove a single DM tag by the ClientSpocDM row id (not the dmId)
export const removeSpocDM = async (req: Request, res: Response) => {
  try {
    const { id: clientId, spocId, spocDmId } = req.params;

    // Confirm SPOC belongs to this client
    const spoc = await prisma.clientSpoc.findFirst({
      where: { id: spocId, clientId, isActive: true },
      select: { id: true },
    });

    if (!spoc) {
      res.status(404).json({ success: false, message: "SPOC not found" });
      return;
    }

    const entry = await prisma.clientSpocDM.findFirst({
      where: { id: spocDmId, spocId },
    });

    if (!entry) {
      res.status(404).json({ success: false, message: "DM tag not found" });
      return;
    }

    await prisma.clientSpocDM.delete({ where: { id: spocDmId } });

    res.json({ success: true, message: "DM untagged from SPOC" });
  } catch (err) {
    console.error("removeSpocDM:", err);
    res.status(500).json({ success: false, message: "Failed to untag DM" });
  }
};
