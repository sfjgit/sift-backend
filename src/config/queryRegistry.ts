// File: queryRegistry.ts
// Path: src/config/queryRegistry.ts
//
// CANVAS mode — named, parameterised, READ-ONLY queries (spec §7). The LLM only
// picks a query name + params from this catalog; it never sees a row. Every
// query:
//   • runs through aiDb (read-only Prisma + ai_readonly Postgres role),
//   • is limited to what the user may see (clientScopeWhere & co — the same
//     rules as the list pages),
//   • declares its permission and its return type (single / series / rows), so
//     the validator can check the component fits.
// `llm: false` queries (AI usage dashboard) are never offered to the LLM.

import { z } from "zod";
import { $Enums, Prisma } from "@prisma/client";
import type { PermissionKey } from "@/config/permissions.registry";
import type { PermissionMap } from "@/services/permission.service";
import type { AuthUser } from "@/types/express";
import type { AiDb } from "@/config/aiDb";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { clientScopeWhere, spocScopeWhere, stepRunScopeWhere } from "@/services/scope.service";
import { buildOrgTree, visibleUserIds, type OrgTreeNode } from "@/services/org.service";
import { FREE_ROW_CAP, runFreeSql } from "@/services/ai/sql.service";

export type ReturnType = "single" | "series" | "rows" | "tree";
export type ValueFormat = "number" | "money" | "percent";

export interface SingleResult {
  kind: "single";
  value: number | null;
  format: ValueFormat;
  hint?: string;
}
export interface SeriesResult {
  kind: "series";
  format: ValueFormat;
  /** series keys + labels; single-series charts use [{ key: "value" }] */
  series: { key: string; label: string }[];
  points: ({ label: string } & Record<string, number | string>)[];
}
export interface Column {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "date" | "percent";
}
export interface RowsResult {
  kind: "rows";
  columns: Column[];
  rows: Record<string, string | number | null>[];
  total: number;
}
/** a reporting tree (org chart) */
export interface TreeResult {
  kind: "tree";
  root: OrgTreeNode;
  total: number;
}
export type QueryResult = SingleResult | SeriesResult | RowsResult | TreeResult;

export interface QueryCtx {
  user: AuthUser;
  perms: PermissionMap;
  /** business tables, read-only */
  db: AiDb;
  /** AI-owned tables (usage dashboard), read-only */
  aiTables: AiDb;
  /** row cap for tables: screen = canvasTableRows, export = exportRowCap */
  rowCap: number;
}

export interface QueryDef<P extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  label: string;
  /** one line for the LLM catalog */
  description: string;
  permission: PermissionKey;
  returns: ReturnType;
  params: P;
  /** params, as the LLM should read them */
  paramDoc: string;
  llm: boolean;
  run: (ctx: QueryCtx, params: z.infer<P>) => Promise<QueryResult>;
}

// ── shared param pieces (values arrive already resolved: ids, {from,to}, "2024-25") ──

const id = z.string().uuid();
const ids = z.union([id, z.array(id).max(20)]).transform((v) => (Array.isArray(v) ? v : [v]));
const range = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const fy = z.string().regex(/^\d{4}-\d{2}$/);
const top = z.number().int().min(1).max(50);
/** a place name as the user said it ("Bengaluru", "Maharashtra") — matched with its other spellings */
const place = z.string().trim().min(2).max(60);

const clientFilter = {
  status: z.enum(Object.values($Enums.ClientStatus) as [string, ...string[]]).optional(),
  industryId: ids.optional(),
  categoryId: ids.optional(),
  businessUnitId: ids.optional(),
  entityType: z.enum(Object.values($Enums.ClientEntityType) as [string, ...string[]]).optional(),
  added: range.optional(),
  /** me = assigned to the asking user; team = them + the people who report to them */
  owner: z.enum(["me", "team"]).optional(),
  assignedToId: ids.optional(),
  state: place.optional(),
  city: place.optional(),
};
const CLIENT_FILTER_DOC =
  "status (PENDING|ACTIVE|INACTIVE), industryId ({industry_N}), categoryId ({client_category_N}), businessUnitId ({business_unit_N}), entityType (COMPANY|GOVERNMENT|INSTITUTION), added ({date_range_N}), owner (me = assigned to me | team = me and my team), assignedToId ({user_N}), state (office state, as the user said it), city (office city, as the user said it)";

type ClientFilter = { [K in keyof typeof clientFilter]?: z.infer<(typeof clientFilter)[K]> };

const day = (s: string, end = false) => new Date(`${s}T${end ? "23:59:59.999" : "00:00:00"}`);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const grantOf = (ctx: QueryCtx, key: PermissionKey) => {
  const g = ctx.perms[key];
  return g === undefined ? null : g;
};

// other spellings of the same place, so "Bangalore" finds "Bengaluru Urban"
const PLACE_ALIASES: string[][] = [
  ["bengaluru", "bangalore", "bengalooru", "bangaluru"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["gurugram", "gurgaon"],
  ["pune", "poona"],
  ["mysuru", "mysore"],
  ["mangaluru", "mangalore"],
  ["thiruvananthapuram", "trivandrum"],
  ["kerala", "keralam"],
  ["odisha", "orissa"],
  ["puducherry", "pondicherry"],
];
const spellings = (v: string) => {
  const t = v.trim().toLowerCase();
  return PLACE_ALIASES.find((g) => g.includes(t)) ?? [t];
};
const placeMatch = (field: "state" | "city" | "district", v: string) =>
  spellings(v).map((x) => ({ [field]: { contains: x, mode: "insensitive" as const } }));

/**
 * The asking user + everyone below them, all the way down the chain (people who
 * report to them, the people who report to those, …) via reportingTo / teamLead.
 */
export const teamIdsOf = async (db: AiDb, rootId: string) => {
  const seen = new Set<string>([rootId]);
  let level = [rootId];
  for (let depth = 0; depth < 12 && level.length; depth++) {
    const next = await db.user.findMany({
      where: { isActive: true, OR: [{ teamLeadId: { in: level } }, { reportingToId: { in: level } }], id: { notIn: [...seen] } },
      select: { id: true },
      take: 2_000,
    });
    level = next.map((u) => u.id).filter((id) => !seen.has(id));
    level.forEach((id) => seen.add(id));
  }
  return [...seen];
};
const teamIds = (ctx: QueryCtx) => teamIdsOf(ctx.db, ctx.user.id);

/** clients the user may see + the block's filters */
const clientWhere = async (ctx: QueryCtx, f: ClientFilter): Promise<Prisma.ClientWhereInput> => {
  const g = grantOf(ctx, "clients.read");
  if (!g) return { id: { in: [] } };
  const scope = g === true ? {} : await clientScopeWhere(ctx.user, g);
  return {
    AND: [
      scope,
      { deletedAt: null },
      f.status ? { status: f.status as $Enums.ClientStatus } : {},
      f.industryId ? { industryId: { in: f.industryId } } : {},
      f.categoryId ? { categoryId: { in: f.categoryId } } : {},
      f.businessUnitId ? { businessUnitId: { in: f.businessUnitId } } : {},
      f.entityType ? { entityType: f.entityType as $Enums.ClientEntityType } : {},
      f.added ? { createdAt: { gte: day(f.added.from), lte: day(f.added.to, true) } } : {},
      f.owner === "me" ? { assignments: { some: { userId: ctx.user.id, endedAt: null } } } : {},
      f.owner === "team" ? { assignments: { some: { userId: { in: await teamIds(ctx) }, endedAt: null } } } : {},
      f.assignedToId ? { assignments: { some: { userId: { in: f.assignedToId }, endedAt: null } } } : {},
      f.state ? { locations: { some: { isActive: true, OR: placeMatch("state", f.state) } } } : {},
      f.city ? { locations: { some: { isActive: true, OR: [...placeMatch("city", f.city), ...placeMatch("district", f.city)] } } } : {},
    ],
  };
};

/** SPOC filters shared by the SPOC queries */
const spocFilter = {
  clientId: id.optional(),
  /** me = SPOCs I handle; team = me and the people who report to me */
  owner: z.enum(["me", "team"]).optional(),
  handlerId: ids.optional(),
  state: place.optional(),
  city: place.optional(),
};
const SPOC_FILTER_DOC =
  "clientId ({client_N}), owner (me = SPOCs I handle | team = me and my team), handlerId ({user_N}), state (as the user said it), city (as the user said it)";
type SpocFilter = { [K in keyof typeof spocFilter]?: z.infer<(typeof spocFilter)[K]> };

const spocFilterWhere = async (ctx: QueryCtx, f: SpocFilter): Promise<Prisma.ClientSpocWhereInput> => ({
  AND: [
    f.clientId ? { clientId: f.clientId } : {},
    f.owner === "me" ? { handlerId: ctx.user.id } : {},
    f.owner === "team" ? { handlerId: { in: await teamIds(ctx) } } : {},
    f.handlerId ? { handlerId: { in: f.handlerId } } : {},
    // the SPOC's own address, or else its client's offices
    f.state ? { OR: [...placeMatch("state", f.state), { client: { locations: { some: { isActive: true, OR: placeMatch("state", f.state) } } } }] } : {},
    f.city
      ? { OR: [...placeMatch("city", f.city), ...placeMatch("district", f.city), { client: { locations: { some: { isActive: true, OR: [...placeMatch("city", f.city), ...placeMatch("district", f.city)] } } } }] }
      : {},
  ],
});

const spocWhere = async (ctx: QueryCtx): Promise<Prisma.ClientSpocWhereInput> => {
  const g = grantOf(ctx, "spocs.read");
  if (!g) return { id: { in: [] } };
  return { AND: [g === true ? {} : await spocScopeWhere(ctx.user, g), { isActive: true }] };
};

const runWhere = async (ctx: QueryCtx): Promise<Prisma.StepRunWhereInput> => {
  const g = grantOf(ctx, "step_runs.read");
  if (!g) return { id: { in: [] } };
  return g === true ? {} : stepRunScopeWhere(ctx.user, g);
};

/** count occurrences of a key, label them, biggest first */
const countBy = async (
  values: (string | null)[],
  labelOf: (keys: string[]) => Promise<Map<string, string>> | Map<string, string>,
  topN = 15,
): Promise<SeriesResult> => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v ?? "", (counts.get(v ?? "") ?? 0) + 1);
  const labels = await labelOf([...counts.keys()].filter(Boolean));
  const points = [...counts.entries()]
    .map(([k, value]) => ({ label: k ? (labels.get(k) ?? k) : "Not set", value }))
    .sort((a, b) => b.value - a.value);
  const head = points.slice(0, topN);
  const rest = points.slice(topN).reduce((s, p) => s + p.value, 0);
  if (rest) head.push({ label: "Others", value: rest });
  return { kind: "series", format: "number", series: [{ key: "value", label: "Count" }], points: head };
};

const lookupLabels = (db: AiDb) => async (keys: string[]) =>
  new Map((await db.lookup.findMany({ where: { id: { in: keys } }, select: { id: true, label: true } })).map((l) => [l.id, l.label]));
const enumLabels = (keys: string[]) => new Map(keys.map((k) => [k, k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " ")]));
const userLabels = (db: AiDb) => async (keys: string[]) =>
  new Map(
    (await db.user.findMany({ where: { id: { in: keys } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [
      u.id,
      `${u.firstName} ${u.lastName}`.trim(),
    ]),
  );

/** month buckets "2026-03" between two dates */
const months = (from: Date, to: Date) => {
  const out: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= to && out.length < 60) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lastNDays = (n: number) => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (n - 1));
  return { from: dayKey(from), to: dayKey(to) };
};

const latestFy = async (ctx: QueryCtx, client: Prisma.ClientWhereInput) =>
  (await ctx.db.clientCsrFinancial.findFirst({ where: { client }, orderBy: { fy: "desc" }, select: { fy: true } }))?.fy ?? null;

// ── business queries (offered to the LLM) ────────────────────────────────────

const q = <P extends z.ZodTypeAny>(d: QueryDef<P>) => d;

const BUSINESS = [
  q({
    name: "clients_count",
    label: "Number of clients",
    description: "How many clients (companies) match the filters.",
    permission: "clients.read",
    returns: "single",
    params: z.object(clientFilter).strict(),
    paramDoc: CLIENT_FILTER_DOC,
    llm: true,
    run: async (ctx, p) => ({ kind: "single", format: "number", value: await ctx.db.client.count({ where: await clientWhere(ctx, p) }) }),
  }),
  q({
    name: "clients_missing",
    label: "Clients missing data",
    description: "How many clients have no SPOCs / no approved SPOC / no website / no CSR figures / no reports.",
    permission: "clients.read",
    returns: "single",
    params: z.object({ what: z.enum(["spocs", "approved", "website", "figures", "reports"]).optional(), ...clientFilter }).strict(),
    paramDoc: `what (spocs|approved|website|figures|reports, default spocs), ${CLIENT_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const what = p.what ?? "spocs";
      const missing: Prisma.ClientWhereInput =
        what === "spocs"
          ? { spocs: { none: { isActive: true } } }
          : what === "approved"
            ? { spocs: { none: { isActive: true, approvalStatus: "APPROVED" } } }
            : what === "website"
              ? { OR: [{ website: null }, { website: "" }] }
              : what === "figures"
                ? { csrFinancials: { none: {} } }
                : { documents: { none: {} } };
      return { kind: "single", format: "number", value: await ctx.db.client.count({ where: { AND: [await clientWhere(ctx, p), missing] } }) };
    },
  }),
  q({
    name: "clients_by",
    label: "Clients grouped",
    description: "Clients counted per status / industry / category / business unit / organisation type / employee size.",
    permission: "clients.read",
    returns: "series",
    params: z
      .object({ by: z.enum(["status", "industry", "category", "business_unit", "entity_type", "employee_size"]), top: top.optional(), ...clientFilter })
      .strict(),
    paramDoc: `by (required: status|industry|category|business_unit|entity_type|employee_size), top (1-50), ${CLIENT_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const where = await clientWhere(ctx, p);
      const field = {
        status: "status",
        industry: "industryId",
        category: "categoryId",
        business_unit: "businessUnitId",
        entity_type: "entityType",
        employee_size: "employeeSizeId",
      }[p.by] as "status" | "industryId" | "categoryId" | "businessUnitId" | "entityType" | "employeeSizeId";
      const rows = await ctx.db.client.findMany({ where, select: { [field]: true }, take: 50_000 });
      const values = rows.map((r) => (r as unknown as Record<string, string | null>)[field] ?? null);
      const labelOf =
        p.by === "status" || p.by === "entity_type"
          ? enumLabels
          : p.by === "business_unit"
            ? async (keys: string[]) =>
                new Map((await ctx.db.businessUnit.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]))
            : lookupLabels(ctx.db);
      return countBy(values, labelOf, p.top ?? 15);
    },
  }),
  q({
    name: "clients_added_trend",
    label: "Clients added per month",
    description: "New clients added per month (default: last 12 months).",
    permission: "clients.read",
    returns: "series",
    params: z.object(clientFilter).strict(),
    paramDoc: `${CLIENT_FILTER_DOC} — 'added' sets the period`,
    llm: true,
    run: async (ctx, p) => {
      const to = p.added ? day(p.added.to, true) : new Date();
      const from = p.added ? day(p.added.from) : new Date(to.getFullYear(), to.getMonth() - 11, 1);
      const rows = await ctx.db.client.findMany({
        where: { AND: [await clientWhere(ctx, { ...p, added: undefined }), { createdAt: { gte: from, lte: to } }] },
        select: { createdAt: true },
        take: 50_000,
      });
      const buckets = new Map(months(from, to).map((m) => [m, 0]));
      for (const r of rows) {
        const k = `${r.createdAt.getFullYear()}-${String(r.createdAt.getMonth() + 1).padStart(2, "0")}`;
        if (buckets.has(k)) buckets.set(k, buckets.get(k)! + 1);
      }
      return {
        kind: "series",
        format: "number",
        series: [{ key: "value", label: "Clients added" }],
        points: [...buckets.entries()].map(([label, value]) => ({ label, value })),
      };
    },
  }),
  q({
    name: "clients_list",
    label: "Clients",
    description: "A table of clients matching the filters (name, who they are assigned to, status, industry, business unit, latest CSR spent, added on).",
    permission: "clients.read",
    returns: "rows",
    params: z.object({ sort: z.enum(["name", "newest", "csr_spent"]).optional(), limit: z.number().int().min(1).max(10_000).optional(), ...clientFilter }).strict(),
    paramDoc: `sort (name|newest|csr_spent), limit, ${CLIENT_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const where = await clientWhere(ctx, p);
      const take = Math.min(p.limit ?? ctx.rowCap, ctx.rowCap);
      const showMoney = Boolean(ctx.perms["client_financials.read"]);
      const [total, rows] = await Promise.all([
        ctx.db.client.count({ where }),
        ctx.db.client.findMany({
          where,
          take,
          orderBy:
            p.sort === "newest" ? { createdAt: "desc" } : p.sort === "csr_spent" && showMoney ? { csrSpentRs: { sort: "desc", nulls: "last" } } : { name: "asc" },
          select: {
            name: true,
            status: true,
            csrFy: true,
            csrSpentRs: true,
            createdAt: true,
            industry: { select: { label: true } },
            businessUnit: { select: { name: true } },
            assignments: { where: { endedAt: null }, select: { user: { select: { firstName: true, lastName: true } } }, take: 10 },
          },
        }),
      ]);
      const columns: Column[] = [
        { key: "name", label: "Client", type: "text" },
        { key: "assignedTo", label: "Assigned to", type: "text" },
        { key: "status", label: "Status", type: "text" },
        { key: "industry", label: "Industry", type: "text" },
        { key: "businessUnit", label: "Business unit", type: "text" },
        ...(showMoney
          ? ([
              { key: "csrFy", label: "CSR FY", type: "text" },
              { key: "csrSpent", label: "CSR spent", type: "money" },
            ] as Column[])
          : []),
        { key: "addedOn", label: "Added on", type: "date" },
      ];
      return {
        kind: "rows",
        columns,
        total,
        rows: rows.map((r) => ({
          name: r.name,
          assignedTo: r.assignments.map((a) => `${a.user.firstName} ${a.user.lastName ?? ""}`.trim()).join(", ") || "Nobody",
          status: r.status,
          industry: r.industry?.label ?? null,
          businessUnit: r.businessUnit?.name ?? null,
          ...(showMoney ? { csrFy: r.csrFy, csrSpent: num(r.csrSpentRs) } : {}),
          addedOn: dayKey(r.createdAt),
        })),
      };
    },
  }),
  q({
    name: "csr_by_fy",
    label: "CSR figures by FY",
    description: "Total CSR obligation, budget and spent per financial year across the filtered clients.",
    permission: "client_financials.read",
    returns: "series",
    params: z.object({ ...clientFilter }).strict(),
    paramDoc: CLIENT_FILTER_DOC,
    llm: true,
    run: async (ctx, p) => {
      const rows = await ctx.db.clientCsrFinancial.findMany({
        where: { client: await clientWhere(ctx, p) },
        select: { fy: true, obligationRs: true, budgetRs: true, spentRs: true },
        take: 100_000,
      });
      const by = new Map<string, { obligation: number; budget: number; spent: number }>();
      for (const r of rows) {
        const b = by.get(r.fy) ?? { obligation: 0, budget: 0, spent: 0 };
        b.obligation += num(r.obligationRs) ?? 0;
        b.budget += num(r.budgetRs) ?? 0;
        b.spent += num(r.spentRs) ?? 0;
        by.set(r.fy, b);
      }
      return {
        kind: "series",
        format: "money",
        series: [
          { key: "obligation", label: "Obligation" },
          { key: "budget", label: "Budget" },
          { key: "spent", label: "Spent" },
        ],
        points: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v })),
      };
    },
  }),
  q({
    name: "csr_same_clients",
    label: "CSR spent, same clients each FY",
    description:
      "Like-for-like CSR spent: totals per FY for only the clients that reported spent in EVERY one of the last completed FYs (fair year-on-year trend).",
    permission: "client_financials.read",
    returns: "series",
    params: z.object({ years: z.number().int().min(2).max(5).optional(), ...clientFilter }).strict(),
    paramDoc: `years (2-5, default 3), ${CLIENT_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const now = new Date();
      const runningStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY
      const rows = await ctx.db.clientCsrFinancial.findMany({
        where: { client: await clientWhere(ctx, p), spentRs: { gt: 0 } },
        select: { clientId: true, fy: true, spentRs: true },
        take: 100_000,
      });
      const done = rows.filter((r) => Number(r.fy.slice(0, 4)) < runningStart);
      const fys = [...new Set(done.map((r) => r.fy))].sort().slice(-(p.years ?? 3));
      const byClient = new Map<string, Map<string, number>>();
      for (const r of done) {
        if (!fys.includes(r.fy)) continue;
        const m = byClient.get(r.clientId) ?? new Map<string, number>();
        m.set(r.fy, (m.get(r.fy) ?? 0) + (num(r.spentRs) ?? 0));
        byClient.set(r.clientId, m);
      }
      const both = [...byClient.values()].filter((m) => fys.every((f) => m.has(f)));
      return {
        kind: "series",
        format: "money",
        series: [
          { key: "value", label: "CSR spent" },
          { key: "clients", label: "Clients compared" },
        ],
        points: fys.map((fy) => ({ label: fy, value: both.reduce((n, m) => n + (m.get(fy) ?? 0), 0), clients: both.length })),
      };
    },
  }),
  q({
    name: "csr_total",
    label: "CSR total",
    description: "One CSR total (spent / budget / obligation / unspent) for a financial year (default: latest FY).",
    permission: "client_financials.read",
    returns: "single",
    params: z.object({ metric: z.enum(["spent", "budget", "obligation", "unspent"]), fy: fy.optional(), ...clientFilter }).strict(),
    paramDoc: `metric (required: spent|budget|obligation|unspent), fy ({fy_N}), ${CLIENT_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const client = await clientWhere(ctx, p);
      const year = p.fy ?? (await latestFy(ctx, client));
      if (!year) return { kind: "single", format: "money", value: null, hint: "No CSR figures yet" };
      const field = `${p.metric}Rs` as "spentRs" | "budgetRs" | "obligationRs" | "unspentRs";
      const agg = await ctx.db.clientCsrFinancial.aggregate({ where: { client, fy: year }, _sum: { [field]: true } });
      return { kind: "single", format: "money", value: num((agg._sum as Record<string, unknown>)[field]) ?? 0, hint: `FY ${year}` };
    },
  }),
  q({
    name: "top_clients_by_csr",
    label: "Top clients by CSR",
    description: "Clients ranked by a CSR figure for a financial year (default: latest FY, top 10).",
    permission: "client_financials.read",
    returns: "rows",
    params: z.object({ metric: z.enum(["spent", "budget", "obligation", "unspent"]).optional(), fy: fy.optional(), top: top.optional(), ...clientFilter }).strict(),
    paramDoc: `metric (spent|budget|obligation|unspent, default spent), fy ({fy_N}), top (1-50), ${CLIENT_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const client = await clientWhere(ctx, p);
      const year = p.fy ?? (await latestFy(ctx, client));
      const field = `${p.metric ?? "spent"}Rs` as "spentRs" | "budgetRs" | "obligationRs" | "unspentRs";
      const rows = year
        ? await ctx.db.clientCsrFinancial.findMany({
            where: { client, fy: year, [field]: { not: null } },
            orderBy: { [field]: "desc" },
            take: Math.min(p.top ?? 10, ctx.rowCap),
            select: { fy: true, obligationRs: true, budgetRs: true, spentRs: true, unspentRs: true, client: { select: { name: true } } },
          })
        : [];
      return {
        kind: "rows",
        total: rows.length,
        columns: [
          { key: "client", label: "Client", type: "text" },
          { key: "fy", label: "FY", type: "text" },
          { key: "obligation", label: "Obligation", type: "money" },
          { key: "budget", label: "Budget", type: "money" },
          { key: "spent", label: "Spent", type: "money" },
          { key: "unspent", label: "Unspent", type: "money" },
        ],
        rows: rows.map((r) => ({
          client: r.client.name,
          fy: r.fy,
          obligation: num(r.obligationRs),
          budget: num(r.budgetRs),
          spent: num(r.spentRs),
          unspent: num(r.unspentRs),
        })),
      };
    },
  }),
  q({
    name: "spocs_count",
    label: "Number of SPOCs",
    description: "How many active SPOCs (client contacts) the user can see, optionally for one client.",
    permission: "spocs.read",
    returns: "single",
    params: z.object({ ...spocFilter, approvalStatus: z.enum(Object.values($Enums.SpocApprovalStatus) as [string, ...string[]]).optional() }).strict(),
    paramDoc: `${SPOC_FILTER_DOC}, approvalStatus (PENDING|APPROVED|REJECTED)`,
    llm: true,
    run: async (ctx, p) => ({
      kind: "single",
      format: "number",
      value: await ctx.db.clientSpoc.count({
        where: {
          AND: [await spocWhere(ctx), await spocFilterWhere(ctx, p), p.approvalStatus ? { approvalStatus: p.approvalStatus as $Enums.SpocApprovalStatus } : {}],
        },
      }),
    }),
  }),
  q({
    name: "spocs_by",
    label: "SPOCs grouped",
    description: "Active SPOCs counted per sales status / approval / email status / validation / handler / business unit.",
    permission: "spocs.read",
    returns: "series",
    params: z
      .object({
        by: z.enum(["sales_status", "approval_status", "email_status", "validation_band", "handler", "business_unit"]),
        top: top.optional(),
        ...spocFilter,
      })
      .strict(),
    paramDoc: `by (required: sales_status|approval_status|email_status|validation_band|handler|business_unit), top, ${SPOC_FILTER_DOC}`,
    llm: true,
    run: async (ctx, p) => {
      const field = {
        sales_status: "salesStatusId",
        approval_status: "approvalStatus",
        email_status: "emailStatus",
        validation_band: "validationBand",
        handler: "handlerId",
        business_unit: "businessUnitId",
      }[p.by] as "salesStatusId" | "approvalStatus" | "emailStatus" | "validationBand" | "handlerId" | "businessUnitId";
      const rows = await ctx.db.clientSpoc.findMany({
        where: { AND: [await spocWhere(ctx), await spocFilterWhere(ctx, p)] },
        select: { [field]: true },
        take: 100_000,
      });
      const labelOf =
        p.by === "sales_status"
          ? lookupLabels(ctx.db)
          : p.by === "handler"
            ? userLabels(ctx.db)
            : p.by === "business_unit"
              ? async (keys: string[]) =>
                  new Map((await ctx.db.businessUnit.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]))
              : enumLabels;
      return countBy(
        rows.map((r) => (r as unknown as Record<string, string | null>)[field] ?? null),
        labelOf,
        p.top ?? 15,
      );
    },
  }),
  q({
    name: "spocs_list",
    label: "SPOCs",
    description: "A table of SPOCs: name, designation, client, sales status, approval, email status, handler (no contact details).",
    permission: "spocs.read",
    returns: "rows",
    params: z
      .object({
        ...spocFilter,
        approvalStatus: z.enum(Object.values($Enums.SpocApprovalStatus) as [string, ...string[]]).optional(),
        salesStatusId: ids.optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
      })
      .strict(),
    paramDoc: `${SPOC_FILTER_DOC}, approvalStatus (PENDING|APPROVED|REJECTED), salesStatusId ({sales_status_N}), limit`,
    llm: true,
    run: async (ctx, p) => {
      const where: Prisma.ClientSpocWhereInput = {
        AND: [
          await spocWhere(ctx),
          await spocFilterWhere(ctx, p),
          p.approvalStatus ? { approvalStatus: p.approvalStatus as $Enums.SpocApprovalStatus } : {},
          p.salesStatusId ? { salesStatusId: { in: p.salesStatusId } } : {},
        ],
      };
      const [total, rows] = await Promise.all([
        ctx.db.clientSpoc.count({ where }),
        ctx.db.clientSpoc.findMany({
          where,
          take: Math.min(p.limit ?? ctx.rowCap, ctx.rowCap),
          orderBy: [{ client: { name: "asc" } }, { firstName: "asc" }],
          select: {
            firstName: true,
            lastName: true,
            designation: true,
            approvalStatus: true,
            emailStatus: true,
            client: { select: { name: true } },
            salesStatus: { select: { label: true } },
            handler: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);
      return {
        kind: "rows",
        total,
        columns: [
          { key: "name", label: "SPOC", type: "text" },
          { key: "designation", label: "Designation", type: "text" },
          { key: "client", label: "Client", type: "text" },
          { key: "salesStatus", label: "Sales status", type: "text" },
          { key: "approval", label: "Approval", type: "text" },
          { key: "emailStatus", label: "Email", type: "text" },
          { key: "handler", label: "Handler", type: "text" },
        ],
        rows: rows.map((r) => ({
          name: `${r.firstName} ${r.lastName ?? ""}`.trim(),
          designation: r.designation,
          client: r.client.name,
          salesStatus: r.salesStatus?.label ?? null,
          approval: r.approvalStatus,
          emailStatus: r.emailStatus,
          handler: `${r.handler.firstName} ${r.handler.lastName}`.trim(),
        })),
      };
    },
  }),
  // ── free hand (super admin only — services/ai/sql.service.ts) ─────────────
  q({
    name: "free_sql",
    label: "Custom query",
    description: "A read-only query the assistant wrote for a super admin.",
    permission: "ai_assistant.canvas_use",
    returns: "rows",
    params: z
      .object({
        sql: z.string().min(6).max(4_000),
        args: z.array(z.union([z.string().max(200), z.number()])).max(20).optional(),
        shape: z.enum(["rows", "series", "single"]).default("rows"),
        label: z.string().max(80).optional(),
        values: z.array(z.string().max(80)).max(5).optional(),
        format: z.enum(["number", "money", "percent"]).optional(),
      })
      .strict(),
    paramDoc: "",
    llm: false,
    run: async (ctx, p) => {
      const { rows, capped } = await runFreeSql(ctx.user, p.sql, p.args ?? []);
      const keys = rows.length ? Object.keys(rows[0]!) : [];
      const isNum = (k: string) => rows.some((r) => typeof r[k] === "number") && rows.every((r) => r[k] === null || typeof r[k] === "number");
      const isDate = (k: string) => rows.some((r) => typeof r[k] === "string") && rows.every((r) => r[k] === null || /^\d{4}-\d{2}-\d{2}T/.test(String(r[k])));
      const fmt = p.format ?? "number";
      if (p.shape === "single") {
        const k = keys.find(isNum);
        return { kind: "single", format: fmt, value: k ? (rows[0]![k] as number) : null };
      }
      if (p.shape === "series") {
        const label = p.label && keys.includes(p.label) ? p.label : (keys.find((k) => !isNum(k)) ?? keys[0]!);
        const values = (p.values ?? []).filter((v) => keys.includes(v) && isNum(v));
        const nums = values.length ? values : keys.filter((k) => k !== label && isNum(k)).slice(0, 5);
        return {
          kind: "series",
          format: fmt,
          series: nums.map((k) => ({ key: k, label: k.replace(/_/g, " ") })),
          points: rows.map((r) => ({ label: String(r[label] ?? "—"), ...Object.fromEntries(nums.map((k) => [k, Number(r[k] ?? 0)])) })),
        };
      }
      const columns: Column[] = keys.map((k) => ({ key: k, label: k.replace(/_/g, " "), type: isNum(k) ? (fmt === "money" && /amount|spent|budget|value|rs|inr|revenue|csr/i.test(k) ? "money" : "number") : isDate(k) ? "date" : "text" }));
      return { kind: "rows", columns, rows: rows.slice(0, Math.min(ctx.rowCap, FREE_ROW_CAP)), total: capped ? FREE_ROW_CAP + 1 : rows.length };
    },
  }),

  // ── people ─────────────────────────────────────────────────────────────────
  q({
    name: "org_tree",
    label: "Org chart",
    description:
      "An org chart: the reporting tree of who reports to whom, each person with clients, SPOCs and tasks. Use ONLY when the user asks for structure — org chart, hierarchy, reporting line, team tree, who reports to whom.",
    permission: "users.read",
    returns: "tree",
    params: z.object({ team: z.boolean().optional(), rootUserId: id.optional() }).strict(),
    paramDoc: "team (true = start from me: my reporting line), rootUserId ({user_N} — start from that person)",
    llm: true,
    run: async (ctx, p) => {
      const visible = await visibleUserIds(ctx.user, ctx.perms);
      const { root, total } = await buildOrgTree(ctx.db as never, { visible, rootId: p.rootUserId ?? (p.team ? ctx.user.id : null) });
      return { kind: "tree", root, total };
    },
  }),
  q({
    name: "users_count",
    label: "Number of people",
    description: "How many active CRM users (people / team members) there are, optionally only my team (everyone under me in the reporting chain).",
    permission: "users.read",
    returns: "single",
    params: z.object({ team: z.boolean().optional() }).strict(),
    paramDoc: "team (true = only me and everyone under me)",
    llm: true,
    run: async (ctx, p) => ({
      kind: "single",
      format: "number",
      value: await ctx.db.user.count({ where: { isActive: true, ...(p.team && { id: { in: await teamIds(ctx) } }) } }),
    }),
  }),
  q({
    name: "users_by",
    label: "People grouped",
    description: "Active users (people / team members) counted per role / department / designation / team lead / reporting manager.",
    permission: "users.read",
    returns: "series",
    params: z.object({ by: z.enum(["role", "department", "designation", "team_lead", "reporting_to"]), team: z.boolean().optional(), top: top.optional() }).strict(),
    paramDoc: "by (required: role|department|designation|team_lead|reporting_to), team (true = only my team), top",
    llm: true,
    run: async (ctx, p) => {
      const field = { role: "roleId", department: "departmentId", designation: "designationId", team_lead: "teamLeadId", reporting_to: "reportingToId" }[p.by] as
        | "roleId" | "departmentId" | "designationId" | "teamLeadId" | "reportingToId";
      const rows = await ctx.db.user.findMany({
        where: { isActive: true, ...(p.team && { id: { in: await teamIds(ctx) } }) },
        select: { id: true, roleId: true, departmentId: true, designationId: true, teamLeadId: true, reportingToId: true },
        take: 10_000,
      });
      const named = (model: "role" | "department" | "designation") => async (keys: string[]) => {
        const list =
          model === "role"
            ? await ctx.db.role.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } })
            : model === "department"
              ? await ctx.db.department.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } })
              : await ctx.db.designation.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } });
        return new Map(list.map((x) => [x.id, x.name]));
      };
      const labelOf = p.by === "role" ? named("role") : p.by === "department" ? named("department") : p.by === "designation" ? named("designation") : userLabels(ctx.db);
      return countBy(rows.map((r) => r[field] ?? null), labelOf, p.top ?? 15);
    },
  }),
  q({
    name: "users_workload",
    label: "Workload per person",
    description: "A table of people with how much each one handles: clients assigned, SPOCs handled, open tasks and overdue tasks. Optionally only my team.",
    permission: "users.read",
    returns: "rows",
    params: z.object({ team: z.boolean().optional(), limit: z.number().int().min(1).max(10_000).optional() }).strict(),
    paramDoc: "team (true = only me and everyone under me), limit",
    llm: true,
    run: async (ctx, p) => {
      const users = await ctx.db.user.findMany({
        where: { isActive: true, ...(p.team && { id: { in: await teamIds(ctx) } }) },
        select: { id: true, firstName: true, lastName: true, roleId: true, reportingToId: true },
        take: 5_000,
      });
      const ids = users.map((u) => u.id);
      const [assigned, handled, open, overdue, roles] = await Promise.all([
        ctx.db.clientAssignment.groupBy({ by: ["userId"], where: { userId: { in: ids }, endedAt: null, client: { deletedAt: null } }, _count: true }),
        ctx.db.clientSpoc.groupBy({ by: ["handlerId"], where: { handlerId: { in: ids }, isActive: true }, _count: true }),
        ctx.db.workTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { not: "DONE" } }, _count: true }),
        ctx.db.workTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { not: "DONE" }, dueAt: { lt: new Date() } }, _count: true }),
        ctx.db.role.findMany({ where: { id: { in: [...new Set(users.map((u) => u.roleId).filter(Boolean) as string[])] } }, select: { id: true, name: true } }),
      ]);
      const m = (rows: { _count: number }[], key: (r: never) => string) => new Map(rows.map((r) => [key(r as never), r._count]));
      const a = m(assigned, (r: { userId: string }) => r.userId);
      const h = m(handled, (r: { handlerId: string }) => r.handlerId);
      const o = m(open, (r: { assigneeId: string }) => r.assigneeId);
      const od = m(overdue, (r: { assigneeId: string }) => r.assigneeId);
      const roleName = new Map(roles.map((r) => [r.id, r.name]));
      const byId = new Map(users.map((u) => [u.id, u]));
      const rows = users
        .map((u) => ({
          name: `${u.firstName} ${u.lastName ?? ""}`.trim(),
          role: (u.roleId && roleName.get(u.roleId)) ?? null,
          reportsTo: u.reportingToId && byId.get(u.reportingToId) ? `${byId.get(u.reportingToId)!.firstName} ${byId.get(u.reportingToId)!.lastName ?? ""}`.trim() : null,
          clients: a.get(u.id) ?? 0,
          spocs: h.get(u.id) ?? 0,
          openTasks: o.get(u.id) ?? 0,
          overdue: od.get(u.id) ?? 0,
        }))
        .sort((x, y) => y.clients + y.spocs - (x.clients + x.spocs));
      return {
        kind: "rows",
        total: rows.length,
        columns: [
          { key: "name", label: "Person", type: "text" },
          { key: "role", label: "Role", type: "text" },
          { key: "reportsTo", label: "Reports to", type: "text" },
          { key: "clients", label: "Clients assigned", type: "number" },
          { key: "spocs", label: "SPOCs handled", type: "number" },
          { key: "openTasks", label: "Open tasks", type: "number" },
          { key: "overdue", label: "Overdue", type: "number" },
        ],
        rows: rows.slice(0, Math.min(p.limit ?? ctx.rowCap, ctx.rowCap)),
      };
    },
  }),
  q({
    name: "users_load_by",
    label: "Load per person",
    description: "Per person: how many clients are assigned to each user (clients by assigned user / owner), SPOCs each one handles, or open tasks each one has — a chart of who carries how much. Optionally only my team.",
    permission: "users.read",
    returns: "series",
    params: z.object({ metric: z.enum(["clients", "spocs", "open_tasks"]), team: z.boolean().optional(), top: top.optional() }).strict(),
    paramDoc: "metric (required: clients|spocs|open_tasks), team (true = only my team), top",
    llm: true,
    run: async (ctx, p) => {
      const scope = p.team ? { in: await teamIds(ctx) } : undefined;
      const values: string[] =
        p.metric === "clients"
          ? (await ctx.db.clientAssignment.findMany({ where: { endedAt: null, client: { deletedAt: null }, ...(scope && { userId: scope }) }, select: { userId: true }, take: 100_000 })).map((r) => r.userId)
          : p.metric === "spocs"
            ? (await ctx.db.clientSpoc.findMany({ where: { isActive: true, ...(scope && { handlerId: scope }) }, select: { handlerId: true }, take: 100_000 })).map((r) => r.handlerId)
            : (await ctx.db.workTask.findMany({ where: { status: { not: "DONE" }, ...(scope && { assigneeId: scope }) }, select: { assigneeId: true }, take: 100_000 })).map((r) => r.assigneeId);
      return countBy(values, userLabels(ctx.db), p.top ?? 15);
    },
  }),
  q({
    name: "runs_by",
    label: "Pipeline runs grouped",
    description: "Pipeline runs counted per status / step / person who started them (default: last 30 days).",
    permission: "step_runs.read",
    returns: "series",
    params: z.object({ by: z.enum(["status", "step", "requested_by"]), period: range.optional(), top: top.optional() }).strict(),
    paramDoc: "by (required: status|step|requested_by), period ({date_range_N}), top",
    llm: true,
    run: async (ctx, p) => {
      const period = p.period ?? lastNDays(30);
      const field = { status: "status", step: "stepId", requested_by: "requestedById" }[p.by] as "status" | "stepId" | "requestedById";
      const rows = await ctx.db.stepRun.findMany({
        where: { AND: [await runWhere(ctx), { createdAt: { gte: day(period.from), lte: day(period.to, true) } }] },
        select: { [field]: true },
        take: 100_000,
      });
      const labelOf =
        p.by === "status"
          ? enumLabels
          : p.by === "requested_by"
            ? userLabels(ctx.db)
            : async (keys: string[]) =>
                new Map((await ctx.db.pipelineStep.findMany({ where: { id: { in: keys } }, select: { id: true, label: true } })).map((s) => [s.id, s.label]));
      return countBy(
        rows.map((r) => (r as unknown as Record<string, string | null>)[field] ?? null),
        labelOf,
        p.top ?? 15,
      );
    },
  }),
  q({
    name: "runs_trend",
    label: "Pipeline runs per day",
    description: "Pipeline runs started per day (default: last 30 days), optionally only one status.",
    permission: "step_runs.read",
    returns: "series",
    params: z.object({ period: range.optional(), status: z.enum(Object.values($Enums.StepRunStatus) as [string, ...string[]]).optional() }).strict(),
    paramDoc: "period ({date_range_N}), status (QUEUED|RUNNING|DONE|EMPTY|FAILED|STOPPED|DISPATCH_FAILED|TIMED_OUT)",
    llm: true,
    run: async (ctx, p) => {
      const period = p.period ?? lastNDays(30);
      const from = day(period.from);
      const to = day(period.to, true);
      const rows = await ctx.db.stepRun.findMany({
        where: { AND: [await runWhere(ctx), { createdAt: { gte: from, lte: to } }, p.status ? { status: p.status as $Enums.StepRunStatus } : {}] },
        select: { createdAt: true },
        take: 100_000,
      });
      const buckets = new Map<string, number>();
      for (let d = new Date(from); d <= to && buckets.size < 400; d.setDate(d.getDate() + 1)) buckets.set(dayKey(d), 0);
      for (const r of rows) {
        const k = dayKey(r.createdAt);
        if (buckets.has(k)) buckets.set(k, buckets.get(k)! + 1);
      }
      return {
        kind: "series",
        format: "number",
        series: [{ key: "value", label: "Runs" }],
        points: [...buckets.entries()].map(([label, value]) => ({ label, value })),
      };
    },
  }),
  q({
    name: "outreach_by_status",
    label: "Outreach by status",
    description: "Outreach packs counted per status (draft, reviewed, sent, replied, no reply, bounced).",
    permission: "outreach.read",
    returns: "series",
    params: z.object({ ...clientFilter }).strict(),
    paramDoc: CLIENT_FILTER_DOC,
    llm: true,
    run: async (ctx, p) => {
      const rows = await ctx.db.outreachPack.findMany({ where: { client: await clientWhere(ctx, p) }, select: { status: true }, take: 100_000 });
      return countBy(rows.map((r) => r.status), enumLabels);
    },
  }),
];

// ── AI usage dashboard queries (Super Admin; never offered to the LLM) ────────

const usageFilter = z
  .object({
    period: range.optional(),
    roleId: id.optional(),
    buId: id.optional(),
    mode: z.enum(["COMMAND", "CANVAS", "EXPORT"]).optional(),
  })
  .strict();
type UsageFilter = z.infer<typeof usageFilter>;

const thisMonth = () => {
  const n = new Date();
  return { from: dayKey(new Date(n.getFullYear(), n.getMonth(), 1)), to: dayKey(n) };
};

const usageRows = async (ctx: QueryCtx, f: UsageFilter) => {
  const period = f.period ?? thisMonth();
  return ctx.aiTables.aiAuditLog.findMany({
    where: {
      createdAt: { gte: day(period.from), lte: day(period.to, true) },
      ...(f.roleId ? { roleId: f.roleId } : {}),
      ...(f.buId ? { buId: f.buId } : {}),
      ...(f.mode ? { usageMode: f.mode } : {}),
    },
    select: { userId: true, roleId: true, mode: true, usageMode: true, tier: true, outcome: true, costInr: true, createdAt: true, countsToQuota: true, input: true, action: true },
    take: 200_000,
  });
};

const isCommandResolved = (r: { usageMode: string | null; outcome: string; tier: string }) =>
  r.usageMode === "COMMAND" && !r.outcome.startsWith("rejected") && ["local", "template", "llm", "fallback"].includes(r.tier);

const usage = (d: Omit<QueryDef<typeof usageFilter>, "params" | "paramDoc" | "llm" | "permission">) =>
  q({ ...d, params: usageFilter, paramDoc: "period, roleId, buId, mode", llm: false, permission: "ai_assistant.usage_view" as const });

const sumInr = (rows: { costInr: unknown }[]) => rows.reduce((s, r) => s + (num(r.costInr) ?? 0), 0);

const USAGE = [
  usage({
    name: "ai_total_commands",
    label: "Commands",
    description: "Commands resolved in the period.",
    returns: "single",
    run: async (ctx, p) => ({ kind: "single", format: "number", value: (await usageRows(ctx, p)).filter(isCommandResolved).length }),
  }),
  usage({
    name: "ai_llm_calls",
    label: "LLM calls",
    description: "Requests that went to the LLM.",
    returns: "single",
    run: async (ctx, p) => ({ kind: "single", format: "number", value: (await usageRows(ctx, p)).filter((r) => r.tier === "llm").length }),
  }),
  usage({
    name: "ai_template_hit_rate",
    label: "Template hit rate",
    description: "Share of resolved commands answered without the LLM (maturity).",
    returns: "single",
    run: async (ctx, p) => {
      const done = (await usageRows(ctx, p)).filter(isCommandResolved);
      return {
        kind: "single",
        format: "percent",
        value: done.length ? Math.round((done.filter((r) => r.tier === "template" || r.tier === "local").length / done.length) * 1000) / 10 : null,
        hint: `target ≥ ${AI_DEFAULTS.maturityAlert.minHitRatePct}% after ${AI_DEFAULTS.maturityAlert.afterDays} days`,
      };
    },
  }),
  usage({
    name: "ai_cost",
    label: "Cost",
    description: "Total cost in the period.",
    returns: "single",
    run: async (ctx, p) => ({ kind: "single", format: "money", value: Math.round(sumInr(await usageRows(ctx, p)) * 100) / 100 }),
  }),
  usage({
    name: "ai_projected_month_end",
    label: "Projected month-end",
    description: "This month's cost so far, projected to the end of the month.",
    returns: "single",
    run: async (ctx, p) => {
      const n = new Date();
      const spent = sumInr(await usageRows(ctx, { ...p, period: thisMonth() }));
      const daysIn = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
      return { kind: "single", format: "money", value: Math.round((spent / n.getDate()) * daysIn * 100) / 100 };
    },
  }),
  usage({
    name: "ai_avg_cost_per_command",
    label: "Avg cost per command",
    description: "Average cost of a resolved command.",
    returns: "single",
    run: async (ctx, p) => {
      const done = (await usageRows(ctx, p)).filter(isCommandResolved);
      return { kind: "single", format: "money", value: done.length ? Math.round((sumInr(done) / done.length) * 10_000) / 10_000 : null };
    },
  }),
  usage({
    name: "ai_cost_by_day",
    label: "Daily cost",
    description: "Cost per day (should trend down as templates are learned).",
    returns: "series",
    run: async (ctx, p) => {
      const period = p.period ?? thisMonth();
      const buckets = new Map<string, number>();
      for (let d = day(period.from); d <= day(period.to, true) && buckets.size < 400; d.setDate(d.getDate() + 1)) buckets.set(dayKey(d), 0);
      for (const r of await usageRows(ctx, p)) {
        const k = dayKey(r.createdAt);
        if (buckets.has(k)) buckets.set(k, buckets.get(k)! + (num(r.costInr) ?? 0));
      }
      return {
        kind: "series",
        format: "money",
        series: [{ key: "value", label: "Cost (₹)" }],
        points: [...buckets.entries()].map(([label, v]) => ({ label, value: Math.round(v * 100) / 100 })),
      };
    },
  }),
  usage({
    name: "ai_tier_split",
    label: "How commands were answered",
    description: "Per day: template / LLM / fallback / guard — the maturity curve.",
    returns: "series",
    run: async (ctx, p) => {
      const tiers = ["local", "template", "llm", "fallback", "guard"] as const;
      const by = new Map<string, Record<string, number>>();
      for (const r of await usageRows(ctx, { ...p, mode: p.mode ?? "COMMAND" })) {
        const k = dayKey(r.createdAt);
        const b = by.get(k) ?? Object.fromEntries(tiers.map((t) => [t, 0]));
        if (tiers.includes(r.tier as (typeof tiers)[number])) b[r.tier] = (b[r.tier] ?? 0) + 1;
        by.set(k, b);
      }
      return {
        kind: "series",
        format: "number",
        series: [
          { key: "local", label: "In browser (free)" },
          { key: "template", label: "Template (free)" },
          { key: "llm", label: "LLM" },
          { key: "fallback", label: "Fallback search" },
          { key: "guard", label: "Blocked by guard" },
        ],
        points: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v })),
      };
    },
  }),
  usage({
    name: "ai_cost_by_role",
    label: "Cost by role",
    description: "Cost per role.",
    returns: "series",
    run: async (ctx, p) => {
      const by = new Map<string, number>();
      for (const r of await usageRows(ctx, p)) by.set(r.roleId ?? "", (by.get(r.roleId ?? "") ?? 0) + (num(r.costInr) ?? 0));
      const roles = new Map(
        (await ctx.aiTables.role.findMany({ where: { id: { in: [...by.keys()].filter(Boolean) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]),
      );
      return {
        kind: "series",
        format: "money",
        series: [{ key: "value", label: "Cost (₹)" }],
        points: [...by.entries()].map(([k, v]) => ({ label: roles.get(k) ?? "No role", value: Math.round(v * 100) / 100 })).sort((a, b) => b.value - a.value),
      };
    },
  }),
  usage({
    name: "ai_top_users",
    label: "Top 10 users by cost",
    description: "The ten users with the highest cost.",
    returns: "series",
    run: async (ctx, p) => {
      const by = new Map<string, number>();
      for (const r of await usageRows(ctx, p)) by.set(r.userId, (by.get(r.userId) ?? 0) + (num(r.costInr) ?? 0));
      const topTen = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const names = await userLabels(ctx.aiTables)(topTen.map(([k]) => k));
      return {
        kind: "series",
        format: "money",
        series: [{ key: "value", label: "Cost (₹)" }],
        points: topTen.map(([k, v]) => ({ label: names.get(k) ?? "Unknown", value: Math.round(v * 100) / 100 })),
      };
    },
  }),
  usage({
    name: "ai_usage_by_mode",
    label: "Usage by mode",
    description: "Requests per mode: command / canvas / export.",
    returns: "series",
    run: async (ctx, p) =>
      countBy(
        (await usageRows(ctx, p)).map((r) => r.usageMode ?? r.mode),
        enumLabels,
      ),
  }),
  usage({
    name: "ai_rejected",
    label: "Rejected attempts",
    description: "Requests the assistant refused (destructive, permission, scope, quota).",
    returns: "rows",
    run: async (ctx, p) => {
      const rows = (await usageRows(ctx, p)).filter((r) => r.outcome.startsWith("rejected")).sort((a, b) => +b.createdAt - +a.createdAt);
      const names = await userLabels(ctx.aiTables)([...new Set(rows.map((r) => r.userId))]);
      return {
        kind: "rows",
        total: rows.length,
        columns: [
          { key: "when", label: "When", type: "date" },
          { key: "user", label: "User", type: "text" },
          { key: "outcome", label: "Why", type: "text" },
          { key: "input", label: "Request", type: "text" },
        ],
        rows: rows.slice(0, ctx.rowCap).map((r) => ({
          when: r.createdAt.toISOString().replace("T", " ").slice(0, 16),
          user: names.get(r.userId) ?? "Unknown",
          outcome: r.outcome.replace("rejected_", "").replace(/_/g, " "),
          input: r.input,
        })),
      };
    },
  }),
];

export const QUERIES: readonly QueryDef[] = [...BUSINESS, ...USAGE] as unknown as QueryDef[];
export const queryDef = (name: string) => QUERIES.find((x) => x.name === name);

/** component ↔ return type (spec §4 L4: component must match the query's return type) */
export const COMPONENT_ACCEPTS: Record<"kpi" | "bar" | "line" | "pie" | "table" | "org", ReturnType[]> = {
  kpi: ["single"],
  bar: ["series"],
  line: ["series"],
  pie: ["series"],
  table: ["rows", "series"],
  org: ["tree"],
};
