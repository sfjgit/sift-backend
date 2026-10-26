// File: search.controller.ts
// Path: src/controller/search.controller.ts
//
// Global search box. Each section runs only with its read permission, inside
// that permission's scope; a section the caller can't see comes back empty.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocScopeWhere, userScopeWhere } from "@/services/scope.service";
import { getUserPermissionMap } from "@/services/permission.service";
import { grantScope } from "@/services/grant.service";
import type { SearchQuery } from "@/validators/search.validators";

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

// ── GET /search?q=&limit=
export const globalSearch = async (req: Request, res: Response) => {
  const { q, limit } = req.validatedQuery as SearchQuery;
  const map = await getUserPermissionMap(req.user);
  const clientScope = grantScope(map, "clients.read");
  const spocScope = grantScope(map, "spocs.read");
  const userScope = grantScope(map, "users.read");
  const canSeeContact = !!map["spocs.view_contact"];

  const searchClients = async () => {
    if (!clientScope) return [];
    const rows = await prisma.client.findMany({
      where: {
        deletedAt: null,
        AND: [
          await clientScopeWhere(req.user, clientScope),
          { OR: [{ name: contains(q) }, { shortName: contains(q) }, { cin: contains(q) }] },
        ],
      },
      select: {
        id: true,
        name: true,
        shortName: true,
        status: true,
        locations: { where: { isPrimary: true, isActive: true }, select: { city: true }, take: 1 },
      },
      orderBy: { name: "asc" },
      take: limit,
    });
    return rows.map(({ locations, ...c }) => ({ ...c, city: locations[0]?.city ?? null }));
  };

  const searchSpocs = async () => {
    if (!spocScope) return [];
    // only match on email when the caller may see it — otherwise it leaks
    const fields = ["firstName", "lastName", "designation", ...(canSeeContact ? ["email"] : [])];
    const rows = await prisma.clientSpoc.findMany({
      where: {
        isActive: true,
        client: { deletedAt: null },
        AND: [
          await spocScopeWhere(req.user, spocScope),
          { OR: fields.map((f) => ({ [f]: contains(q) }) as Prisma.ClientSpocWhereInput) },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        email: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { firstName: "asc" },
      take: limit,
    });
    // same mask as toSpocResponse
    return rows.map((s) => (canSeeContact ? s : { ...s, email: null }));
  };

  const searchUsers = async () => {
    if (!userScope) return [];
    return prisma.user.findMany({
      where: {
        AND: [
          await userScopeWhere(req.user, userScope),
          {
            OR: (["firstName", "lastName", "email", "employeeId"] as const).map((f) => ({
              [f]: contains(q),
            })),
          },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        designation: { select: { name: true } },
      },
      orderBy: [{ isActive: "desc" }, { firstName: "asc" }],
      take: limit,
    });
  };

  const [clients, spocs, users] = await Promise.all([
    searchClients(),
    searchSpocs(),
    searchUsers(),
  ]);

  res.json({ success: true, data: { clients, spocs, users } });
};
