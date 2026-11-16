// File: csrProgram.controller.ts
// Path: src/controller/csrProgram.controller.ts
//
// CSR programmes a person adds or corrects. Saving locks the programme so the
// pipeline never overwrites it; isLocked: false hands it back to the pipeline.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { assertLookups } from "@/services/lookup.service";
import { logClientActivity } from "@/services/clientActivity.service";
import {
  CSR_PROGRAM_SELECT,
  csrNameKey,
  replaceProgramLinks,
  resolveCsrAgency,
} from "@/services/csrProgram.service";
import { findClientInScope } from "@/controller/client.controller";
import { ApiError, notFound } from "@/utils/httpError";
import type { CreateCsrProgramInput, UpdateCsrProgramInput } from "@/validators/client.validators";

type Db = Prisma.TransactionClient;

const assertSectors = async (ids?: string[]) => {
  if (ids?.length)
    await assertLookups(Object.fromEntries(ids.map((id, i) => [`sectorIds[${i}]`, [id, "PROGRAM_SECTOR"]])));
};

/** agency for the body: DIRECT clears it; an id must be this tenant's; else find / add by name */
const agencyFor = async (tx: Db, b: UpdateCsrProgramInput): Promise<string | null | undefined> => {
  if (b.mode === "DIRECT") return null;
  if (b.agencyId) {
    const found = await tx.csrAgency.findFirst({
      where: { id: b.agencyId },
      select: { id: true, registrationNo: true },
    });
    if (!found) throw ApiError(400, "Unknown implementing agency", "INVALID_REFERENCE");
    // a CSR-1 number typed for an agency that has none is learnt
    if (b.agencyRegistrationNo && !found.registrationNo) {
      const taken = await tx.csrAgency.findFirst({
        where: { registrationNo: b.agencyRegistrationNo },
        select: { name: true },
      });
      if (taken)
        throw ApiError(409, `${b.agencyRegistrationNo} already belongs to ${taken.name}`, "DUPLICATE_REGISTRATION");
      await tx.csrAgency.update({ where: { id: found.id }, data: { registrationNo: b.agencyRegistrationNo } });
    }
    return found.id;
  }
  if (b.agencyName || b.agencyRegistrationNo)
    return resolveCsrAgency(tx, { name: b.agencyName, registrationNo: b.agencyRegistrationNo });
  if (b.agencyId === null) return null;
  return undefined; // not touched
};

const sameNameTaken = async (tx: Db, clientId: string, fy: string, nameKey: string, exceptId?: string) => {
  const dup = await tx.clientCsrProgram.findFirst({
    where: { clientId, fy, nameKey, ...(exceptId && { id: { not: exceptId } }) },
    select: { name: true },
  });
  if (dup)
    throw ApiError(409, `FY ${fy} already has a programme called "${dup.name}"`, "DUPLICATE_PROGRAM");
};

// ── POST /clients/:id/csr-programs
export const createCsrProgram = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const b = req.validatedBody as CreateCsrProgramInput;
  await findClientInScope(req, id);
  await assertSectors(b.sectorIds);

  const nameKey = csrNameKey(b.name);
  const row = await prisma.$transaction(async (tx) => {
    await sameNameTaken(tx, id, b.fy, nameKey);
    const agencyId = await agencyFor(tx, b);
    const p = await tx.clientCsrProgram.create({
      data: {
        clientId: id,
        fy: b.fy,
        name: b.name,
        nameKey,
        sectorText: b.sectorText ?? null,
        isOngoing: b.isOngoing ?? null,
        duration: b.duration ?? null,
        isLocalArea: b.isLocalArea ?? null,
        locationNote: b.locationNote ?? null,
        budgetRs: b.budgetRs ?? null,
        spentRs: b.spentRs ?? null,
        unspentTransferredRs: b.unspentTransferredRs ?? null,
        mode: b.mode ?? (agencyId ? "AGENCY" : null),
        agencyId: agencyId ?? null,
        beneficiaries: b.beneficiaries ?? null,
        sdgs: b.sdgs ?? [],
        sourceUrl: b.sourceUrl ?? null,
        isLocked: true,
        updatedById: req.user.id,
      },
      select: { id: true },
    });
    await replaceProgramLinks(tx, p.id, { sectorIds: b.sectorIds, locations: b.locations });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "PROGRAMS_UPDATED",
      summary: `CSR programme "${b.name}" (FY ${b.fy}) added`,
    });
    return tx.clientCsrProgram.findUniqueOrThrow({ where: { id: p.id }, select: CSR_PROGRAM_SELECT });
  });

  res.status(201).json({ success: true, message: "Programme added", data: row });
};

// ── PATCH /clients/:id/csr-programs/:programId
export const updateCsrProgram = async (req: Request, res: Response) => {
  const { id, programId } = req.validatedParams;
  const b = req.validatedBody as UpdateCsrProgramInput;
  await findClientInScope(req, id);
  await assertSectors(b.sectorIds);

  const cur = await prisma.clientCsrProgram.findFirst({
    where: { id: programId, clientId: id },
    select: { fy: true, name: true },
  });
  if (!cur) throw notFound("Programme");

  const fy = b.fy ?? cur.fy;
  const name = b.name ?? cur.name;
  const nameKey = csrNameKey(name);
  const row = await prisma.$transaction(async (tx) => {
    if (b.fy !== undefined || b.name !== undefined) await sameNameTaken(tx, id, fy, nameKey, programId);
    const agencyId = await agencyFor(tx, b);
    const { sectorIds, locations, agencyName: _n, agencyRegistrationNo: _r, isLocked, ...fields } = b;
    await tx.clientCsrProgram.update({
      where: { id: programId },
      data: {
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        fy,
        name,
        nameKey,
        ...(agencyId !== undefined && { agencyId }),
        ...(agencyId && b.mode === undefined && { mode: "AGENCY" as const }),
        // any edit is a person's correction; only an explicit false unlocks
        isLocked: isLocked ?? true,
        updatedById: req.user.id,
      },
    });
    await replaceProgramLinks(tx, programId, { sectorIds, locations });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "PROGRAMS_UPDATED",
      summary:
        isLocked === false
          ? `CSR programme "${name}" (FY ${fy}) handed back to the pipeline`
          : `CSR programme "${name}" (FY ${fy}) updated`,
    });
    return tx.clientCsrProgram.findUniqueOrThrow({ where: { id: programId }, select: CSR_PROGRAM_SELECT });
  });

  res.json({ success: true, message: "Programme saved", data: row });
};

// ── DELETE /clients/:id/csr-programs/:programId
export const removeCsrProgram = async (req: Request, res: Response) => {
  const { id, programId } = req.validatedParams;
  await findClientInScope(req, id);

  const row = await prisma.clientCsrProgram.findFirst({
    where: { id: programId, clientId: id },
    select: { fy: true, name: true },
  });
  if (!row) throw notFound("Programme");
  await prisma.$transaction(async (tx) => {
    await tx.clientCsrProgram.delete({ where: { id: programId } });
    await logClientActivity(tx, {
      clientId: id,
      actorId: req.user.id,
      type: "PROGRAMS_UPDATED",
      summary: `CSR programme "${row.name}" (FY ${row.fy}) removed`,
    });
  });
  res.json({ success: true, message: "Programme removed" });
};

// ── GET /csr-agencies?search= — the picker in the programme form
export const listCsrAgencies = async (req: Request, res: Response) => {
  const search = (req.validatedQuery as { search?: string }).search;
  const agencies = await prisma.csrAgency.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { registrationNo: { startsWith: search.toUpperCase() } },
          ],
        }
      : {},
    select: { id: true, name: true, registrationNo: true, website: true, _count: { select: { programs: true } } },
    orderBy: { name: "asc" },
    take: 25,
  });
  res.json({ success: true, data: agencies });
};
