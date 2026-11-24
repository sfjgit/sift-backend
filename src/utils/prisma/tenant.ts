// File: tenant.ts
// Path: src/utils/prisma/tenant.ts
//
// Tenant isolation for every Prisma call. The signed-in user's tenant is held
// in AsyncLocalStorage for the whole request (authenticateUser), and the
// client extension in ./client.ts adds it to every query:
//   - tenant tables (tenantId column): where tenantId = X, and create sets it
//   - their children (no column): where <parent>.tenantId = X
// No context (scripts, seed, the pipeline reconciler between runs) = no filter.
// Platform routes run with tenantId null on purpose: they see every tenant.
// $queryRaw is never touched — raw SQL must filter by tenant itself.

import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

type TenantStore = { tenantId: string | null };

const store = new AsyncLocalStorage<TenantStore>();

/** the current tenant; null = platform / no context (unfiltered) */
export const currentTenantId = () => store.getStore()?.tenantId ?? null;

/** the current tenant for a create — throws outside one (the row would have no owner) */
export const tenantIdOrThrow = () => {
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("No tenant in context — wrap the call in runInTenant()");
  return tenantId;
};

/** run fn (and everything it awaits) as one tenant */
export const runInTenant = <T>(tenantId: string, fn: () => T): T => store.run({ tenantId }, fn);

/** run fn across all tenants — enterprise console only */
export const runAsPlatform = <T>(fn: () => T): T => store.run({ tenantId: null }, fn);

// tables with their own tenantId column
const TENANT_MODELS = new Set<string>([
  "User",
  "Role",
  "Lookup",
  "BusinessUnit",
  "ServiceLine",
  "Department",
  "Designation",
  "Client",
  "ClientSpoc",
  "StepRun",
  "RunQuota",
  "AuditLog",
  "SavedView",
  "Faq",
  "CsrAgency",
  "SystemAlert",
  // AI assistant (plain tenantId column, no FK)
  "AiModeSetting",
  "AiUserPreference",
  "AiQuotaPolicy",
  "AiUserQuotaOverride",
  "ReportTemplate",
  "AiAuditLog",
  // recycle bin (tenantId may be null for system writes outside a tenant)
  "ChangeLog",
  // support tickets
  "Ticket",
  // a human behind one or more client SPOC roles; a client's company registration (CIN unique per tenant)
  "Person",
  "ClientCompany",
]);

// tenantId may be null = platform row every tenant reads (not writes)
const SHARED_READ_MODELS = new Set<string>(["SystemAlert"]);

// children: the tenant is their parent's
const byClient = (t: string) => ({ client: { tenantId: t } });
const byUser = (t: string) => ({ user: { tenantId: t } });
const VIA_PARENT: Record<string, (t: string) => object> = {
  RolePermission: (t) => ({ role: { tenantId: t } }),
  UserBusinessUnit: byUser,
  UserServiceLine: byUser,
  AuthLogs: byUser,
  Notification: byUser,
  ImpersonationLog: (t) => ({ impersonator: { tenantId: t } }),
  ClientAssignment: byClient,
  ClientServiceLine: byClient,
  ClientCsr: byClient,
  ClientGovt: byClient,
  ClientLocation: byClient,
  ClientTechnology: byClient,
  ClientNote: byClient,
  ClientActivity: byClient,
  ClientDocument: byClient,
  ClientCsrFinancial: byClient,
  ClientCorporateFinancial: byClient,
  ClientCsrProgram: byClient,
  ClientCsrProgramSector: (t: string) => ({ program: { client: { tenantId: t } } }),
  ClientCsrProgramLocation: (t: string) => ({ program: { client: { tenantId: t } } }),
  OutreachPack: byClient,
  OutreachMessage: (t) => ({ pack: { client: { tenantId: t } } }),
  ClientSpocAssignment: (t) => ({ spoc: { tenantId: t } }),
  StepRunEvent: (t) => ({ run: { tenantId: t } }),
  TicketAttachment: (t) => ({ ticket: { tenantId: t } }),
  TicketEvent: (t) => ({ ticket: { tenantId: t } }),
};

const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const WHERE_OPS = new Set([
  ...READ_OPS,
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

// FK scalars per model: a create that sets any of them is "unchecked" and takes
// tenantId; one that only uses relation objects is "checked" and needs
// tenant: { connect }. Prisma rejects mixing the two styles.
const FK_FIELDS = new Map<string, Set<string>>(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Set(m.fields.flatMap((f) => f.relationFromFields ?? [])),
  ]),
);

type Data = Record<string, unknown>;

const withTenant = (model: string, data: Data, tenantId: string): Data => {
  if (!data || "tenantId" in data || "tenant" in data) return data;
  const fks = FK_FIELDS.get(model);
  const unchecked =
    !fks ||
    Object.keys(data).some((k) => fks.has(k)) ||
    // no FK scalar and no relation object either — scalar form is fine
    !Object.values(data).some(
      (v) => v !== null && typeof v === "object" && ("connect" in v || "connectOrCreate" in v),
    );
  return unchecked ? { ...data, tenantId } : { ...data, tenant: { connect: { id: tenantId } } };
};

const filterFor = (model: string, operation: string, tenantId: string): object | null => {
  if (TENANT_MODELS.has(model)) {
    return SHARED_READ_MODELS.has(model) && READ_OPS.has(operation)
      ? { OR: [{ tenantId }, { tenantId: null }] }
      : { tenantId };
  }
  return VIA_PARENT[model]?.(tenantId) ?? null;
};

/** args with the current tenant applied (unchanged when there is no tenant) */
export const scopeArgs = (model: string | undefined, operation: string, args: unknown): unknown => {
  const tenantId = currentTenantId();
  if (!tenantId || !model) return args;
  const a = { ...((args ?? {}) as Data) };

  if (WHERE_OPS.has(operation)) {
    const filter = filterFor(model, operation, tenantId);
    if (filter) {
      // AND keeps unique fields (findUnique / update) at the top level
      const where = (a.where ?? {}) as Data;
      const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
      a.where = { ...where, AND: [...and, filter] };
    }
  }

  if (TENANT_MODELS.has(model)) {
    if (operation === "create") a.data = withTenant(model, a.data as Data, tenantId);
    if (operation === "upsert") a.create = withTenant(model, a.create as Data, tenantId);
    if (operation === "createMany" || operation === "createManyAndReturn") {
      const rows = Array.isArray(a.data) ? a.data : [a.data];
      a.data = rows.map((r) => ((r as Data).tenantId ? r : { ...(r as Data), tenantId }));
    }
  }
  return a;
};
