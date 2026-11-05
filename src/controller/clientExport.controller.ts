// File: clientExport.controller.ts
// Path: src/controller/clientExport.controller.ts
//
// POST /clients/export-details — the nested data behind an export of the
// clients table, for many clients in one call, so a download can carry extra
// sheets (branch offices, CSR figures for every year, reports, SPOCs).
// Read-only. Same visibility as the list: only clients the user may see, and
// each part only with its permission.

import { Request, Response } from "express";
import { z } from "zod";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocWhereForUserId } from "@/services/scope.service";

export const exportDetailsBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(10_000),
  parts: z.array(z.enum(["offices", "csr", "reports", "spocs"])).min(1),
});

const LOOKUP = { select: { code: true, label: true } } as const;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const getExportDetails = async (req: Request, res: Response) => {
  const { ids, parts } = exportDetailsBody.parse(req.body);
  const perms = req.permissions ?? {};
  const want = new Set(parts);
  const client = { id: { in: ids }, deletedAt: null, ...(await clientScopeWhere(req.user, req.scope!)) };
  const CLIENT = { select: { id: true, name: true } } as const;

  const [offices, csr, reports, spocs] = await Promise.all([
    want.has("offices")
      ? prisma.clientLocation.findMany({
          where: { isActive: true, client },
          select: {
            name: true,
            addressLine: true,
            city: true,
            district: true,
            state: true,
            country: true,
            pincode: true,
            isPrimary: true,
            type: LOOKUP,
            client: CLIENT,
          },
          orderBy: [{ clientId: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
        })
      : [],
    want.has("csr") && perms["client_financials.read"]
      ? prisma.clientCsrFinancial.findMany({
          where: { client },
          select: { fy: true, obligationRs: true, budgetRs: true, spentRs: true, unspentRs: true, client: CLIENT },
          orderBy: [{ clientId: "asc" }, { fy: "desc" }],
        })
      : [],
    want.has("reports") && perms["client_documents.read"]
      ? prisma.clientDocument.findMany({
          where: { client },
          select: { fy: true, fileName: true, sourceUrl: true, type: LOOKUP, client: CLIENT },
          orderBy: [{ clientId: "asc" }, { fy: "desc" }],
        })
      : [],
    want.has("spocs") && perms["spocs.read"]
      ? prisma.clientSpoc.findMany({
          where: { isActive: true, client, ...(await spocWhereForUserId(req.user.id)) },
          select: {
            firstName: true,
            lastName: true,
            designation: true,
            department: true,
            email: true,
            phone: true,
            linkedinUrl: true,
            approvalStatus: true,
            client: CLIENT,
          },
          orderBy: [{ clientId: "asc" }, { firstName: "asc" }],
        })
      : [],
  ]);

  res.json({
    success: true,
    data: {
      offices: offices.map(({ client: c, type, ...o }) => ({ clientId: c.id, client: c.name, type: type?.label ?? null, ...o })),
      csr: csr.map(({ client: c, ...f }) => ({
        clientId: c.id,
        client: c.name,
        fy: f.fy,
        obligationRs: num(f.obligationRs),
        budgetRs: num(f.budgetRs),
        spentRs: num(f.spentRs),
        unspentRs: num(f.unspentRs),
      })),
      reports: reports.map(({ client: c, type, ...d }) => ({ clientId: c.id, client: c.name, type: type?.label ?? null, ...d })),
      spocs: spocs.map(({ client: c, ...s }) => ({ clientId: c.id, client: c.name, ...s })),
    },
  });
};
