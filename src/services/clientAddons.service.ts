// File: clientAddons.service.ts
// Path: src/services/clientAddons.service.ts
//
// Client = only what EVERY client has (24 Nov 2026); everything else is an optional add-on:
//   ClientCompany  company details: CIN, ownership, listing, market cap, industry, category, employees, group
//   ClientCsr      CSR role, CSR eligible, foundation, latest CSR year / spent (cache)
//   ClientGovt     government body: tier, type, ministry / department, procurement
// Client.hasCompany / isCsr / isGovt and ClientServiceLine are kept by database triggers.
// The API keeps its flat fields (client.cin, client.industry, client.csrSpentRs …) — read from the
// add-ons here — and also returns the add-ons (client.company / .csr / .govt; .registration = .company).

import { Prisma, type ClientOwnership, type GovtLevel } from "@prisma/client";
import { currentTenantId } from "@/utils/prisma/tenant";
import prisma from "@/utils/prisma/client";

const LOOKUP = { id: true, code: true, label: true } as const;
const REF = { id: true, name: true } as const;

/** add to any client select that feeds a response */
export const ADDON_SELECT = {
  hasCompany: true,
  isCsr: true,
  isGovt: true,
  company: {
    select: {
      cin: true, ownership: true, companyClass: true, yearOfIncorporation: true,
      isListed: true, marketCapRs: true, subCategory: true,
      industry: { select: LOOKUP }, category: { select: LOOKUP },
      employeeCount: true, employeeSize: { select: LOOKUP }, linkedinEmployees: true, groupName: true,
      updatedAt: true,
    },
  },
  csr: {
    select: {
      csrRole: { select: LOOKUP }, csrEligible: true, foundationName: true, foundationWebsite: true,
      latestFy: true, latestSpentRs: true, updatedAt: true,
    },
  },
  govt: {
    select: {
      level: true, orgType: { select: LOOKUP }, parent: { select: REF }, nodalMinistry: { select: REF },
      ministryName: true, departmentName: true, stateSkillBody: true, sector: true, skillFamily: true,
      isNational: true, schemeType: true, estimatedBudget: true, tenderPortal: true, tenderAuthority: true,
      priority: true, digitalMaturity: true, updatedAt: true,
    },
  },
} as const satisfies Prisma.ClientSelect;

type Lk = { id: string; code: string; label: string } | null;
type AddonRow = {
  company?: {
    cin: string | null; isListed: boolean | null; marketCapRs: Prisma.Decimal | null; subCategory: string | null;
    industry: Lk; category: Lk; employeeCount: number | null; employeeSize: Lk; linkedinEmployees: number | null; groupName: string | null;
  } | null;
  csr?: { csrEligible: boolean | null; foundationName: string | null; foundationWebsite: string | null; latestFy: string | null; latestSpentRs: Prisma.Decimal | null } | null;
};

/** the flat fields every API caller already knows, read from the add-ons */
export function flattenClient<T extends AddonRow>(c: T) {
  const co = c.company;
  return {
    ...c,
    // the add-on under its old name too (web / phone builds before 24 Nov read client.registration)
    registration: co ?? null,
    cin: co?.cin ?? null,
    isListed: co?.isListed ?? null,
    marketCapRs: co?.marketCapRs ?? null,
    subCategory: co?.subCategory ?? null,
    industry: co?.industry ?? null,
    category: co?.category ?? null,
    employeeCount: co?.employeeCount ?? null,
    employeeSize: co?.employeeSize ?? null,
    linkedinEmployees: co?.linkedinEmployees ?? null,
    groupName: co?.groupName ?? null,
    csrEligible: c.csr?.csrEligible ?? null,
    foundationName: c.csr?.foundationName ?? null,
    foundationWebsite: c.csr?.foundationWebsite ?? null,
    csrFy: c.csr?.latestFy ?? null,
    csrSpentRs: c.csr?.latestSpentRs ?? null,
  };
}

// ── writes ──────────────────────────────────────────────────────────────────

export const COMPANY_KEYS = [
  "cin", "ownership", "companyClass", "yearOfIncorporation", "isListed", "marketCapRs", "subCategory",
  "industryId", "categoryId", "employeeCount", "employeeSizeId", "linkedinEmployees", "groupName",
] as const;
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
  const company = pick(rest, COMPANY_KEYS);
  const csr = pick(rest, CSR_KEYS);
  const core = Object.fromEntries(
    Object.entries(rest).filter(([k]) => !(COMPANY_KEYS as readonly string[]).includes(k) && !(CSR_KEYS as readonly string[]).includes(k)),
  );
  return { core, company, csr, govt: govt ? pick(govt, GOVT_KEYS) : {} };
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

/** upsert the add-ons that have something to save (inside the caller's transaction) */
export async function saveAddons(
  tx: Prisma.TransactionClient,
  clientId: string,
  parts: ReturnType<typeof splitClientInput>,
  userId: string,
) {
  const co = { ...parts.company } as Record<string, unknown>;
  if (typeof co.cin === "string") {
    co.cin = (co.cin as string).trim().toUpperCase() || null;
    if (co.ownership === undefined && co.cin) co.ownership = ownershipFromCin(co.cin as string) ?? undefined;
    if (co.yearOfIncorporation === undefined && co.cin) co.yearOfIncorporation = yearFromCin(co.cin as string) ?? undefined;
  }
  if (co.marketCapRs !== undefined && co.marketCapRs !== null) co.marketCapRs = new Prisma.Decimal(co.marketCapRs as number);
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  // an add-on row (and its Client flag) only appears when there is something real to keep —
  // all-blank values just clear an existing row (a ministry saved with empty company fields stays non-company)
  const real = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== null && v !== undefined && v !== "");
  if (Object.keys(clean(co)).length && !real(clean(co))) {
    await tx.clientCompany.updateMany({ where: { clientId }, data: { ...clean(co), updatedById: userId } });
  } else if (Object.keys(clean(co)).length) {
    const data = { ...clean(co), updatedById: userId };
    await tx.clientCompany.upsert({
      where: { clientId },
      create: { clientId, tenantId: currentTenantId() ?? (await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { tenantId: true } })).tenantId, ...data } as Prisma.ClientCompanyUncheckedCreateInput,
      update: data,
    });
  }
  if (Object.keys(clean(parts.csr)).length) {
    const data = { ...clean(parts.csr), updatedById: userId };
    if (real(clean(parts.csr))) await tx.clientCsr.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
    else await tx.clientCsr.updateMany({ where: { clientId }, data });
  }
  if (Object.keys(clean(parts.govt)).length) {
    const data = { ...clean(parts.govt), updatedById: userId };
    if (real(clean(parts.govt))) await tx.clientGovt.upsert({ where: { clientId }, create: { clientId, ...data } as never, update: data as never });
    else await tx.clientGovt.updateMany({ where: { clientId }, data: data as never });
  }
}

/** the "before" values of a client (core + add-ons), for the edit-lock rule */
export async function clientValuesForLock(clientId: string) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, include: { company: true, csr: true, govt: true } });
  if (!c) return null;
  const { company, csr, govt, ...core } = c;
  return {
    core: core as Record<string, unknown>,
    company: (company ?? {}) as Record<string, unknown>,
    csr: (csr ?? {}) as Record<string, unknown>,
    govt: (govt ?? {}) as Record<string, unknown>,
  };
}

/** list filters on fields that live in an add-on: query key → where on Client */
export const addonWhere = {
  industryId: (ids: string[]): Prisma.ClientWhereInput => ({ company: { industryId: { in: ids } } }),
  categoryId: (ids: string[]): Prisma.ClientWhereInput => ({ company: { categoryId: { in: ids } } }),
  employeeSizeId: (ids: string[]): Prisma.ClientWhereInput => ({ company: { employeeSizeId: { in: ids } } }),
  groupName: (v: string[]): Prisma.ClientWhereInput => ({ company: { groupName: { in: v } } }),
  cin: (q: string): Prisma.ClientWhereInput => ({ company: { cin: { contains: q, mode: "insensitive" } } }),
};
