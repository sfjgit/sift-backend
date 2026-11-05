// File: clientMap.controller.ts
// Path: src/controller/clientMap.controller.ts
//
// GET /clients/map[?clientId=] — the 3D office map:
//   points — every office with coordinates of the clients this user may see
//            (same scope as the clients list), with what the map can size or
//            colour by: SPOCs, CSR reports, CSR spend, company size, industry
//   spocs  — the SPOCs this user may see at those clients (spocs.read), placed at
//            their office, or at the client's main office when they have none
// clientId = one client only (the client page's map).

import { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocWhereForUserId } from "@/services/scope.service";

const MAX_POINTS = 20_000;
const MAX_SPOCS = 20_000;
const query = z.object({ clientId: z.string().uuid().optional() });

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const getClientMap = async (req: Request, res: Response) => {
  const { clientId } = query.parse(req.query);
  const perms = req.permissions ?? {};
  const canFigures = !!perms["client_financials.read"];
  const canSpocs = !!perms["spocs.read"];
  const clientWhere = { deletedAt: null, ...(clientId && { id: clientId }), ...(await clientScopeWhere(req.user, req.scope!)) };
  const where = { isActive: true, client: clientWhere };

  const [rows, withoutCoords, spocRows] = await Promise.all([
    prisma.clientLocation.findMany({
      where: { ...where, latitude: { not: null }, longitude: { not: null } },
      select: {
        id: true,
        name: true,
        city: true,
        district: true,
        state: true,
        latitude: true,
        longitude: true,
        isPrimary: true,
        type: { select: { code: true, label: true } },
        client: {
          select: {
            id: true,
            name: true,
            status: true,
            csrSpentRs: true,
            employeeCount: true,
            employeeSize: { select: { label: true } },
            industry: { select: { label: true } },
            _count: { select: { documents: true } },
          },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      take: MAX_POINTS,
    }),
    prisma.clientLocation.count({ where: { ...where, OR: [{ latitude: null }, { longitude: null }] } }),
    canSpocs
      ? prisma.clientSpoc.findMany({
          where: { isActive: true, client: clientWhere, ...(await spocWhereForUserId(req.user.id)) },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            approvalStatus: true,
            validationBand: true,
            clientId: true,
            locationId: true,
          },
          take: MAX_SPOCS,
        })
      : Promise.resolve([]),
  ]);

  // where a SPOC goes: their own office, else the client's main (first) mapped office
  const byId = new Map(rows.map((l) => [l.id, l]));
  const mainOf = new Map<string, (typeof rows)[number]>();
  for (const l of rows) if (!mainOf.has(l.client.id)) mainOf.set(l.client.id, l);

  const spocsAt = new Map<string, number>();
  const spocsOf = new Map<string, number>();
  const spocs = [];
  for (const s of spocRows) {
    spocsOf.set(s.clientId, (spocsOf.get(s.clientId) ?? 0) + 1);
    const own = s.locationId ? byId.get(s.locationId) : undefined;
    const at = own ?? mainOf.get(s.clientId);
    if (!at) continue;
    spocsAt.set(at.id, (spocsAt.get(at.id) ?? 0) + 1);
    spocs.push({
      id: s.id,
      name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
      designation: s.designation,
      approvalStatus: s.approvalStatus,
      validationBand: s.validationBand,
      clientId: s.clientId,
      client: at.client.name,
      officeId: at.id,
      atOwnOffice: !!own,
      lat: Number(at.latitude),
      lng: Number(at.longitude),
    });
  }

  res.json({
    success: true,
    data: {
      points: rows.map((l) => ({
        id: l.id,
        lat: Number(l.latitude),
        lng: Number(l.longitude),
        name: l.name,
        place: [l.city ?? l.district, l.state].filter(Boolean).join(", ") || null,
        state: l.state,
        isPrimary: l.isPrimary,
        // an untyped main office is the head office
        type: l.type?.code ?? (l.isPrimary ? "HQ" : "OFFICE"),
        typeLabel: l.type?.label ?? (l.isPrimary ? "Head office" : "Office"),
        clientId: l.client.id,
        client: l.client.name,
        status: l.client.status,
        industry: l.client.industry?.label ?? null,
        csrSpentRs: canFigures ? num(l.client.csrSpentRs) : null,
        employees: l.client.employeeCount,
        employeeSize: l.client.employeeSize?.label ?? null,
        reports: l.client._count.documents,
        spocsHere: spocsAt.get(l.id) ?? 0,
        clientSpocs: spocsOf.get(l.client.id) ?? 0,
      })),
      spocs,
      withoutCoords,
      capped: rows.length === MAX_POINTS,
      canSpocs,
    },
  });
};
