// File: clientAddons.service.ts
// Path: src/services/clientAddons.service.ts
//
// Client = only what every client has; each topic is an optional add-on table (21 Nov 2026):
//   ClientRegistration  CIN, ownership, listing, market cap …
//   ClientCsr           CSR role, CSR eligible, foundation
//   ClientGovt          B2G body: tier, type, parent / nodal ministry, procurement
// The API keeps its old flat fields (client.cin, client.csrEligible …) — read from the add-ons here —
// and also returns the add-ons themselves (client.registration / .csr / .govt).

import { Prisma, type ClientOwnership, type GovtLevel } from "@prisma/client";
import { currentTenantId } from "@/utils/prisma/tenant";
import prisma from "@/utils/prisma/client";

const LOOKUP = { id: true, code: true, label: true } as const;
const REF = { id: true, name: true } as const;

/** add to any client select that feeds a response */
export const ADDON_SELECT = {
  groupName: true,
  registration: {
    select: {
      cin: true, ownership: true, companyClass: true, yearOfIncorporation: true,
      isListed: true, marketCapRs: true, subCategory: true, updatedAt: true,
    },
  },
  csr: { select: { csrRole: { select: LOOKUP }, csrEligible: true, foundationName: true, foundationWebsite: true, updatedAt: true } },
  govt: {
    select: {
      level: true, orgType: { select: LOOKUP }, parent: { select: REF }, nodalMinistry: { select: REF },
      ministryName: true, departmentName: true, stateSkillBody: true, sector: true, skillFamily: true,
      isNational: true, schemeType: true, estimatedBudget: true, tenderPortal: true, tenderAuthority: true,
      priority: true, digitalMaturity: true, updatedAt: true,
    },
  },
} as const satisfies Prisma.ClientSelect;

type AddonRow = {
  registration?: { cin: string | null; isListed: boolean | null; marketCapRs: Prisma.Decimal | null; subCategory: string | null } | null;
  csr?: { csrEligible: boolean | null; foundationName: string | null; foundationWebsite: string | null } | null;
};

/** the old flat fields, read from the add-ons — the shape every API caller already knows.
 *  serviceLines come from the active SPOCs (selected as spocs: distinct serviceLine) */
export function flattenClient<T extends AddonRow & { spocs?: { serviceLine: unknown }[] }>(c: T) {
  const { spocs, ...rest } = c;
  return {
    ...(rest as Omit<T, "spocs">),
    ...(spocs && { serviceLines: spocs.map((s) => ({ serviceLine: s.serviceLine })) }),
    cin: c.registration?.cin ?? null,
    isListed: c.registration?.isListed ?? null,
    marketCapRs: c.registration?.marketCapRs ?? null,
    subCategory: c.registration?.subCategory ?? null,
    csrEligible: c.csr?.csrEligible ?? null,
    foundationName: c.csr?.foundationName ?? null,
    foundationWebsite: c.csr?.foundationWebsite ?? null,
  };
}

// ── writes ──────────────────────────────────────────────────────────────────

export const REGISTRATION_KEYS = ["cin", "ownership", "companyClass", "yearOfIncorporation", "isListed", "marketCapRs", "subCategory"] as const;
export const CSR_KEYS = ["csrRoleId", "csrEligible", "foundationName", "foundationWebsite"] as const;
export const GOVT_KEYS = [
  "level", "orgTypeId", "parentClientId", "nodalMinistryId", "ministryName", "departmentName", "stateSkillBody", "sector",
  "skillFamily", "isNational", "schemeType", "estimatedBudget", "tenderPortal", "tenderAuthority", "priority", "digitalMaturity",
] as const;

export type AddonInput = Partial<{
  cin: string | null; ownership: ClientOwnership | null; companyClass: string | null; yearOfIncorporation: number | null;
  isListed: boolean | null; marketCapRs: number | null; subCategory: string | null;
  csrRoleId: string | null; csrEligible: boolean | null; foundationName: string | null; foundationWebsite: string | null;
  govt: Partial<Record<(typeof GOVT_KEYS)[number], unknown>> & { level?: GovtLevel | null };
}>;

const pick = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** split a client body into the core client fields and each add-on's fields */
export function splitClientInput<T extends Record<string, unknown>>(body: T) {
  const { govt, ...rest } = body as T & { govt?: Record<string, unknown> };
  const registration = pick(rest, REGISTRATION_KEYS);
  const csr = pick(rest, CSR_KEYS);
  const core = Object.fromEntries(
    Object.entries(rest).filter(([k]) => !(REGISTRATION_KEYS as readonly string[]).includes(k) && !(CSR_KEYS as readonly string[]).includes(k)),
  );
  return { core, registration, csr, govt: govt ? pick(govt, GOVT_KEYS) : {} };
}

/** CIN's company-type letters → ownership (GOI = central govt, SGC = state govt) */
export function ownershipFromCin(cin?: string | null): ClientOwnership | null {
  const m = cin?.trim().toUpperCase().match(/^[LU]\d{5}[A-Z]{2}\d{4}([A-Z]{3})\d{6}$/);
  if (!m) return null;
  return m[1] === "GOI" ? "CENTRAL_GOVT" : m[1] === "SGC" ? "STATE_GOVT" : "PRIVATE";
}
export const yearFromCin = (cin?: string | null) => {
  const m = cin?.trim().toUpperCase().match(/^[LU]\d{5}[A-Z]{2}(\d{4})[A-Z]{3}\d{6}$/);
  return m ? Number(m[1]) : null;
};

const pickDefined = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** upsert the add-ons that have something to save (inside the caller's transaction) */
export async function saveAddons(
  tx: Prisma.TransactionClient,
  clientId: string,
  parts: ReturnType<typeof splitClientInput>,
  userId: string,
) {
  const reg = { ...parts.registration } as Record<string, unknown>;
  if (typeof reg.cin === "string") {
    reg.cin = (reg.cin as string).trim().toUpperCase() || null;
    if (reg.ownership === undefined && reg.cin) reg.ownership = ownershipFromCin(reg.cin as string) ?? undefined;
    if (reg.yearOfIncorporation === undefined && reg.cin) reg.yearOfIncorporation = yearFromCin(reg.cin as string) ?? undefined;
  }
  if (reg.marketCapRs !== undefined && reg.marketCapRs !== null) reg.marketCapRs = new Prisma.Decimal(reg.marketCapRs as number);
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  if (Object.keys(clean(reg)).length) {
    const data = { ...clean(reg), updatedById: userId };
    await tx.clientRegistration.upsert({
      where: { clientId },
      create: { clientId, tenantId: currentTenantId() ?? (await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { tenantId: true } })).tenantId, ...data } as Prisma.ClientRegistrationUncheckedCreateInput,
      update: data,
    });
  }
  // expand phase: mirror into the old Client columns (the deployed build + any old reader still see them).
  // Remove with those columns (migration "drop client legacy columns").
  const mirror = {
    ...pickDefined(reg, ["cin", "isListed", "marketCapRs", "subCategory"]),
    ...pickDefined(parts.csr, ["csrEligible", "foundationName", "foundationWebsite"]),
  };
  if (Object.keys(mirror).length) await tx.client.update({ where: { id: clientId }, data: mirror as Prisma.ClientUpdateInput, select: { id: true } });
  if (Object.keys(clean(parts.csr)).length) {
    const data = { ...clean(parts.csr), updatedById: userId };
    await tx.clientCsr.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
  }
  if (Object.keys(clean(parts.govt)).length) {
    const data = { ...clean(parts.govt), updatedById: userId };
    await tx.clientGovt.upsert({ where: { clientId }, create: { clientId, ...data } as never, update: data as never });
  }
}

/** the flat "before" values of a client (core + add-ons), for the edit-lock rule */
export async function clientValuesForLock(clientId: string) {
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    include: { registration: true, csr: true, govt: true },
  });
  if (!c) return null;
  const { registration, csr, govt, ...core } = c;
  return {
    core: core as Record<string, unknown>,
    registration: (registration ?? {}) as Record<string, unknown>,
    csr: (csr ?? {}) as Record<string, unknown>,
    govt: (govt ?? {}) as Record<string, unknown>,
  };
}
