// File: changes.ts
// Path: src/utils/prisma/changes.ts
//
// Recycle bin & undo (14 Nov 2026). The Prisma extension in ./client.ts sends
// every write here: the row as it was BEFORE is kept in ChangeLog, so a delete
// can be put back and a change can be reversed — field by field, to exactly
// what it was. Writes of one request (or one AI action) share a batchId, so
// "undo" can put back everything that request did in one go.
//
// Nothing is removed from ChangeLog. Busy bookkeeping tables (logs, sessions,
// the AI's own notes) are not tracked — they are history already.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { currentTenantId } from "./tenant";

type ChangeCtx = { actorId: string | null; batchId: string; source: string };
const store = new AsyncLocalStorage<ChangeCtx>();

export const currentChange = () => store.getStore() ?? null;

/** run fn (and everything it awaits) as one undoable batch */
export const runWithChanges = <T>(ctx: Partial<ChangeCtx>, fn: () => T): T =>
  store.run({ actorId: ctx.actorId ?? null, batchId: ctx.batchId ?? randomUUID(), source: ctx.source ?? "web" }, fn);

// history already, or churn with no value to restore
const SKIP = new Set([
  "ChangeLog", "RefreshToken", "AuthLogs", "ImpersonationLog", "AuditLog", "ClientActivity", "Notification",
  "StepRunEvent", "TicketAttachment", "TicketEvent", "AiAuditLog", "AiThread", "AiTurn", "AiAnswerMemory", "Tenant", "SystemAlert",
]);
export const isTracked = (model: string | undefined) => !!model && !SKIP.has(model);

const CATEGORY: Record<string, string> = {
  Client: "Clients", ClientSpoc: "SPOCs", ClientNote: "Comments", WorkTask: "Tasks & meetings", ClientDocument: "Documents",
  ClientLocation: "Offices", ClientTechnology: "Technology", ClientAssignment: "Assignments", ClientSpocAssignment: "Assignments",
  ClientKeyAccount: "Key accounts", ClientServiceLine: "Service lines", ClientRegistration: "Clients", ClientCsr: "Clients",
  ClientGovt: "Clients", Person: "SPOCs", ClientCsrFinancial: "CSR figures",
  ClientCorporateFinancial: "Financials", ClientCsrProgram: "CSR programmes", ClientCsrProgramSector: "CSR programmes",
  ClientCsrProgramLocation: "CSR programmes", OutreachPack: "Outreach", OutreachMessage: "Outreach", User: "Users",
  UserBusinessUnit: "Users", UserServiceLine: "Users", Role: "Roles & permissions", RolePermission: "Roles & permissions",
  Lookup: "Pick-lists", BusinessUnit: "Organisation", ServiceLine: "Organisation", Department: "Organisation",
  Designation: "Organisation", SavedView: "Saved views", Faq: "Help", CsrAgency: "CSR agencies", PipelineStep: "Pipeline",
  StepRun: "Pipeline runs", RunQuota: "Pipeline", ExternalService: "Integrations", ReportTemplate: "AI", AiModeSetting: "AI",
  AiUserPreference: "AI", AiQuotaPolicy: "AI", AiUserQuotaOverride: "AI", AiModelPricing: "AI", CommandTemplate: "AI", Ticket: "Support tickets",
};
export const categoryOf = (model: string) => CATEGORY[model] ?? model.replace(/([a-z])([A-Z])/g, "$1 $2");

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
/** primary-key fields of a model (["id"], or a compound key) */
export const keyFields = (model: string): string[] => {
  const m = MODELS.get(model);
  if (!m) return ["id"];
  if (m.primaryKey?.fields.length) return [...m.primaryKey.fields];
  const id = m.fields.find((f) => f.isId);
  return id ? [id.name] : ["id"];
};
const fieldsOf = (model: string) => MODELS.get(model)?.fields ?? [];
/** plain columns (not relations) */
export const scalarNames = (model: string) => new Set(fieldsOf(model).filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name));
export const jsonNames = (model: string) => new Set(fieldsOf(model).filter((f) => f.type === "Json").map((f) => f.name));
/** relation field → the FK columns it sets ("salesStatus" → ["salesStatusId"]) */
const relationFks = (model: string) =>
  new Map(fieldsOf(model).filter((f) => f.kind === "object" && f.relationFromFields?.length).map((f) => [f.name, [...f.relationFromFields!]]));

// secrets never go into history (password hashes, tokens, keys)
const SECRET = /password|passwd|secret|token|apikey|api_key|hash|otp|privatekey|credential/i;
const stripSecrets = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET.test(k)));

const lcfirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const toJson = (v: unknown) => toJsonRaw(v && typeof v === "object" && !Array.isArray(v) ? stripSecrets(v as Row) : v);
const toJsonRaw = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val))) as Prisma.InputJsonValue;
const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

export const labelOf = (row: Record<string, unknown> | null | undefined): string | null => {
  if (!row) return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const person = s(row.firstName) ? `${row.firstName} ${s(row.lastName) ?? ""}`.trim() : null;
  const text = s(row.name) ?? person ?? s(row.title) ?? s(row.label) ?? s(row.content) ?? s(row.code) ?? s(row.fy) ?? s(row.email);
  return text ? text.slice(0, 120) : null;
};

/** the columns a write sets (relation connects count as their FK columns) */
const writtenFields = (model: string, data: unknown): string[] => {
  if (!data || typeof data !== "object") return [];
  const scalars = scalarNames(model);
  const fks = relationFks(model);
  const out = new Set<string>();
  for (const k of Object.keys(data as object)) {
    if (scalars.has(k)) out.add(k);
    else fks.get(k)?.forEach((f) => out.add(f));
  }
  out.delete("updatedAt");
  // a secret changing is not something to show or put back from history
  return [...out].filter((f) => !SECRET.test(f));
};

type Row = Record<string, unknown>;
type Delegate = {
  findUnique: (a: object) => Promise<Row | null>;
  findMany: (a: object) => Promise<Row[]>;
};
const MANY_CAP = 20_000;

/**
 * Run one write and keep what it changed. Reading the "before" happens just
 * before the write (outside any open transaction: the last committed state);
 * the log is written after it, without holding the request up.
 */
export const trackedWrite = async (
  base: PrismaClient,
  model: string,
  operation: string,
  args: Record<string, unknown>,
  run: (a: unknown) => Promise<unknown>,
) => {
  const d = (base as unknown as Record<string, Delegate>)[lcfirst(model)];
  if (!d) return run(args);
  const keys = keyFields(model);
  const unique = operation === "update" || operation === "delete" || operation === "upsert";
  const many = operation === "updateMany" || operation === "deleteMany" || operation === "updateManyAndReturn";

  // bulk inserts don't say which rows they made: give each row its id up front,
  // then keep exactly the rows that now exist (skipDuplicates may drop some)
  // (inside a transaction they can't be read back yet, so they're kept from the
  // data written; one skipped as a duplicate has an id that never existed, and
  // undoing it is a no-op)
  let made: Row[] = [];
  if (operation === "createMany" && keys.length === 1 && keys[0] === "id") {
    const rows = (Array.isArray(args.data) ? args.data : [args.data]) as Row[];
    made = rows.map((r) => ({ ...r, id: (r.id as string | undefined) ?? randomUUID() }));
    args = { ...args, data: made };
  }

  let before: Row[] = [];
  try {
    if (unique) {
      const r = await d.findUnique({ where: args.where });
      before = r ? [r] : [];
    } else if (many) before = await d.findMany({ where: args.where ?? {}, take: MANY_CAP });
  } catch {
    before = []; // can't read it — still do the write
  }

  const result = await run(args);

  const ctx = currentChange();
  const tenantId = currentTenantId();
  const common = { actorId: ctx?.actorId ?? null, batchId: ctx?.batchId ?? randomUUID(), source: ctx?.source ?? "system", model, category: categoryOf(model) };
  const entries: Prisma.ChangeLogCreateManyInput[] = [];
  const keyOf = (r: Row) => toJson(pick(r, keys));

  if (operation === "delete" || operation === "deleteMany") {
    for (const r of before) entries.push({ ...common, tenantId: tenantId ?? (r.tenantId as string | null) ?? null, op: "DELETE", label: labelOf(r), recordKey: keyOf(r), before: toJson(r) });
  } else if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn" || (operation === "upsert" && before.length)) {
    const data = operation === "upsert" ? args.update : args.data;
    const fields = writtenFields(model, data);
    if (fields.length) {
      for (const r of before) {
        const changed = fields.filter((f) => JSON.stringify(r[f] ?? null) !== JSON.stringify((data as Row)[f] ?? null) || !(f in (data as Row)));
        if (!changed.length) continue;
        entries.push({
          ...common,
          tenantId: tenantId ?? (r.tenantId as string | null) ?? null,
          op: "UPDATE",
          label: labelOf(r),
          recordKey: keyOf(r),
          before: toJson(pick(r, changed)),
          after: toJson({ fields: changed, data: pick((data ?? {}) as Row, changed.filter((f) => f in (data as Row))) }),
        });
      }
    }
  } else if (operation === "createMany" && made.length) {
    for (const r of made.slice(0, MANY_CAP))
      entries.push({ ...common, tenantId: tenantId ?? (r.tenantId as string | null) ?? null, op: "CREATE", label: labelOf(r), recordKey: keyOf(r), after: toJson(r) });
  } else if (operation === "create" || operation === "upsert" || operation === "createManyAndReturn") {
    const rows = (Array.isArray(result) ? result : [result]) as Row[];
    for (const r of rows) {
      if (!r || keys.some((k) => !(k in r))) continue; // a select without the key can't be undone
      entries.push({ ...common, tenantId: tenantId ?? (r.tenantId as string | null) ?? null, op: "CREATE", label: labelOf(r), recordKey: keyOf(r), after: toJson(r) });
    }
  }

  if (entries.length) {
    void (base as unknown as { changeLog: { createMany: (a: object) => Promise<unknown> } }).changeLog
      .createMany({ data: entries })
      .catch((e: unknown) => console.error("[changes] could not keep history", model, operation, (e as Error).message));
  }
  return result;
};

export const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
