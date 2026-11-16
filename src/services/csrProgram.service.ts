// File: csrProgram.service.ts
// Path: src/services/csrProgram.service.ts
//
// CSR programmes — shared by the client API (a person's edits) and the pipeline
// ingest. A programme is identified per client + FY by its normalised name, so
// "Project Shiksha" and "project shiksha." are one programme, and the same
// programme can be followed across years. Implementing agencies are one list
// per tenant, matched by CSR registration number, else by normalised name.

import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";

type Db = Prisma.TransactionClient | typeof prisma;

/** lower-case, punctuation-free; same rule as the csr_programs migration */
export const csrNameKey = (name: string) => {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return key || name.trim().toLowerCase();
};

export const CSR_PROGRAM_SELECT = {
  id: true,
  fy: true,
  name: true,
  sectorText: true,
  sectors: { select: { sector: { select: { id: true, code: true, label: true } } } },
  isOngoing: true,
  duration: true,
  isLocalArea: true,
  locations: {
    select: { id: true, state: true, district: true, city: true, latitude: true, longitude: true },
  },
  locationNote: true,
  budgetRs: true,
  spentRs: true,
  unspentTransferredRs: true,
  mode: true,
  agency: { select: { id: true, name: true, registrationNo: true, website: true } },
  beneficiaries: true,
  sdgs: true,
  sourceUrl: true,
  isLocked: true,
  updatedAt: true,
} as const satisfies Prisma.ClientCsrProgramSelect;

export type ProgramLocationInput = {
  state: string;
  district?: string | null | undefined;
  city?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
};

/**
 * The tenant's agency for this name / registration number — found, else created.
 * A registration number learnt later is added to the existing agency.
 */
export const resolveCsrAgency = async (
  db: Db,
  input: { name?: string | null | undefined; registrationNo?: string | null | undefined },
) => {
  const name = input.name?.trim();
  const regNo = input.registrationNo?.trim().toUpperCase() || null;
  if (!name && !regNo) return null;

  const byReg = regNo ? await db.csrAgency.findFirst({ where: { registrationNo: regNo } }) : null;
  if (byReg) return byReg.id;
  if (!name) return null; // a number alone doesn't make an agency

  const nameKey = csrNameKey(name);
  const byName = await db.csrAgency.findFirst({ where: { nameKey } });
  if (byName) {
    if (regNo && !byName.registrationNo)
      await db.csrAgency.update({ where: { id: byName.id }, data: { registrationNo: regNo } });
    return byName.id;
  }
  const created = await db.csrAgency.create({
    data: { tenantId: tenantIdOrThrow(), name, nameKey, registrationNo: regNo },
  });
  return created.id;
};

/** replace a programme's sectors and locations with these lists */
export const replaceProgramLinks = async (
  db: Db,
  programId: string,
  links: { sectorIds?: string[] | undefined; locations?: ProgramLocationInput[] | undefined },
) => {
  if (links.sectorIds) {
    await db.clientCsrProgramSector.deleteMany({ where: { programId } });
    if (links.sectorIds.length)
      await db.clientCsrProgramSector.createMany({
        data: [...new Set(links.sectorIds)].map((sectorId) => ({ programId, sectorId })),
        skipDuplicates: true,
      });
  }
  if (links.locations) {
    await db.clientCsrProgramLocation.deleteMany({ where: { programId } });
    if (links.locations.length)
      await db.clientCsrProgramLocation.createMany({
        data: links.locations.map((l) => ({
          programId,
          state: l.state.trim(),
          district: l.district?.trim() || null,
          city: l.city?.trim() || null,
          latitude: l.latitude ?? null,
          longitude: l.longitude ?? null,
        })),
      });
  }
};
