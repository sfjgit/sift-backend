// File: tenant.service.ts
// Path: src/services/tenant.service.ts
//
// Tenants: starting one (role, first admin, pick-lists, help), the seat limit,
// and the guard that ids sent by a client belong to the caller's tenant —
// foreign keys alone can't tell, ids are unique across tenants.

import crypto from "crypto";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError } from "@/utils/httpError";
import { DEFAULT_LOOKUPS, SYSTEM_LOOKUPS, type DefaultLookup } from "@/config/lookups";

type Db = Prisma.TransactionClient | typeof prisma;

// ── pick-lists ───────────────────────────────────────────────────────────────

const lookupRows = (
  tenantId: string,
  set: Partial<Record<string, DefaultLookup[]>>,
  isSystem: boolean,
): Prisma.LookupCreateManyInput[] =>
  Object.entries(set).flatMap(([type, rows]) =>
    (rows ?? []).map((r, i) => ({
      tenantId,
      type,
      code: r.code,
      label: r.label,
      order: i + 1,
      isSystem,
      ...(r.meta && { meta: r.meta }),
    })),
  );

/** the pick-lists the CRM needs; existing rows (and admin edits) are kept */
export const ensureTenantLookups = async (db: Db, tenantId: string) => {
  const { count: system } = await db.lookup.createMany({
    data: lookupRows(tenantId, SYSTEM_LOOKUPS, true),
    skipDuplicates: true,
  });
  const { count: defaults } = await db.lookup.createMany({
    data: lookupRows(tenantId, DEFAULT_LOOKUPS, false),
    skipDuplicates: true,
  });
  return system + defaults;
};

/** every active pick-list row of another tenant (industries, categories…) */
const copyLookups = async (db: Db, fromTenantId: string, toTenantId: string) => {
  const rows = await db.lookup.findMany({
    where: { tenantId: fromTenantId, isActive: true },
    select: { type: true, code: true, label: true, order: true, isSystem: true, meta: true },
  });
  const { count } = await db.lookup.createMany({
    data: rows.map((r) => ({
      ...r,
      tenantId: toTenantId,
      meta: r.meta === null ? Prisma.DbNull : (r.meta as Prisma.InputJsonValue),
    })),
    skipDuplicates: true,
  });
  return count;
};

const copyFaqs = async (db: Db, fromTenantId: string, toTenantId: string) => {
  const rows = await db.faq.findMany({
    where: { tenantId: fromTenantId, isPublished: true },
    select: { question: true, answer: true, category: true, module: true, order: true },
  });
  const { count } = await db.faq.createMany({ data: rows.map((r) => ({ ...r, tenantId: toTenantId })) });
  return count;
};

// ── new tenant ───────────────────────────────────────────────────────────────

export type ProvisionInput = {
  name: string;
  slug: string;
  legalName?: string | null;
  plan?: string;
  maxUsers?: number | null;
  admin: { email: string; firstName: string; lastName: string };
  /** copy pick-lists + help from this tenant (usually SFJBS); none = defaults only */
  templateTenantId?: string | null;
};

const SETUP_LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Tenant + its Super Admin role + first admin (sets a password from the mailed
 * link) + pick-lists + help, in one transaction. Call as platform (no tenant).
 */
export const provisionTenant = async (input: ProvisionInput, actorId: string) => {
  const setupToken = crypto.randomBytes(32).toString("hex");
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);

  return prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.name,
          slug: input.slug,
          legalName: input.legalName ?? null,
          plan: input.plan ?? "STANDARD",
          maxUsers: input.maxUsers ?? null,
        },
      });

      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: "Super Admin",
          description: "Full access inside this company",
          isSystem: true,
        },
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.admin.email,
          firstName: input.admin.firstName,
          lastName: input.admin.lastName,
          passwordHash: placeholderHash,
          isSuperAdmin: true,
          roleId: role.id,
          resetPasswordToken: setupToken,
          resetPasswordExpires: new Date(Date.now() + SETUP_LINK_TTL_MS),
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      const copied = input.templateTenantId
        ? {
            lookups: await copyLookups(tx, input.templateTenantId, tenant.id),
            faqs: await copyFaqs(tx, input.templateTenantId, tenant.id),
          }
        : { lookups: 0, faqs: 0 };
      const lookups = copied.lookups + (await ensureTenantLookups(tx, tenant.id));

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId,
          action: "TENANT_CREATED",
          module: "platform",
          recordId: tenant.id,
          newData: { ...input, admin: input.admin.email },
        },
      });

      return { tenant, admin, setupToken, seeded: { lookups, faqs: copied.faqs } };
    },
    { timeout: 30_000 },
  );
};

// ── guards ───────────────────────────────────────────────────────────────────

/** one more active user must fit the tenant's seats */
export const assertSeatAvailable = async (tenantId: string) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { maxUsers: true },
  });
  if (tenant.maxUsers === null) return;
  const active = await prisma.user.count({ where: { tenantId, isActive: true } });
  if (active >= tenant.maxUsers) {
    throw ApiError(
      409,
      `Your plan allows ${tenant.maxUsers} active users. Deactivate someone or ask for more seats.`,
      "SEAT_LIMIT",
    );
  }
};

type RefModel = "role" | "department" | "designation" | "user" | "businessUnit" | "serviceLine";

/**
 * Ids from the request must be rows of the caller's tenant. Counts run through
 * the tenant-scoped client, so another tenant's id simply isn't found.
 */
export const assertOwnRefs = async (refs: Partial<Record<RefModel, (string | null | undefined)[]>>) => {
  for (const [model, raw] of Object.entries(refs) as [RefModel, (string | null | undefined)[]][]) {
    const ids = [...new Set(raw.filter((v): v is string => !!v))];
    if (!ids.length) continue;
    const where = { id: { in: ids } };
    const found =
      model === "role"
        ? await prisma.role.count({ where })
        : model === "department"
          ? await prisma.department.count({ where })
          : model === "designation"
            ? await prisma.designation.count({ where })
            : model === "user"
              ? await prisma.user.count({ where })
              : model === "businessUnit"
                ? await prisma.businessUnit.count({ where })
                : await prisma.serviceLine.count({ where });
    if (found !== ids.length) throw ApiError(400, `Unknown ${model}`, "INVALID_REFERENCE");
  }
};
