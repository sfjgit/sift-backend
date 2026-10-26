// File: reportDims.service.ts
// Path: src/services/reportDims.service.ts
//
// Report dimensions: which column each one groups on, the SQL expression the
// trend query uses, and how raw values become { key, label }. Labels are
// resolved in one batched query per dimension, never per row.

import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import type { ActivityDim, ClientDim, SpocDim } from "@/validators/report.validators";

export type Label = { key: string; label: string };
type Resolver = (raws: string[]) => Promise<Map<string, Label>>;

export const NONE: Label = { key: "__none", label: "Not set" };
export const OTHER: Label = { key: "__other", label: "Other" };

export interface DimDef {
  field: string | null; // Prisma column for groupBy; null = derived (client location)
  locationKey?: "state" | "city"; // derived from the client's primary active location
  resolve: Resolver; // raw groupBy value → label
  sql: Prisma.Sql; // trend expression (table aliases: c, s, l, a)
  sqlResolve?: Resolver; // when the SQL value differs from the groupBy value
}

// null / boolean / enum / id → comparable string; null stays null
export const toRaw = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s === "" ? null : s;
};

// "NOT_USABLE" → "Not usable"
export const titleCase = (v: string) => {
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const byRows = (rows: { id: string; label: string }[]) =>
  new Map(rows.map((r) => [r.id, { key: r.id, label: r.label }]));

// ── resolvers ────────────────────────────────────────────────────────────────

const enumLabel: Resolver = async (raws) =>
  new Map(raws.map((r) => [r, { key: r, label: titleCase(r) }]));

const yesNo: Resolver = async (raws) =>
  new Map(raws.map((r) => [r, { key: r, label: r === "true" ? "Yes" : "No" }]));

// free text — case variants of the same value collapse into one key
const text: Resolver = async (raws) =>
  new Map(raws.map((r) => [r, { key: r.toLowerCase(), label: r }]));

const users: Resolver = async (ids) =>
  byRows(
    (
      await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      })
    ).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName}`.trim() })),
  );

const lookups: Resolver = async (ids) =>
  byRows(
    await prisma.lookup.findMany({
      where: { id: { in: ids } },
      select: { id: true, label: true },
    }),
  );

const businessUnits: Resolver = async (ids) =>
  byRows(
    (
      await prisma.businessUnit.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    ).map((b) => ({ id: b.id, label: b.name })),
  );

const serviceLines: Resolver = async (ids) =>
  byRows(
    (
      await prisma.serviceLine.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    ).map((s) => ({ id: s.id, label: s.name })),
  );

const clients: Resolver = async (ids) =>
  byRows(
    (
      await prisma.client.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    ).map((c) => ({ id: c.id, label: c.name })),
  );

// SPOC groupBy runs on locationId; the report wants the location's state
const locationStates: Resolver = async (ids) => {
  const rows = await prisma.clientLocation.findMany({
    where: { id: { in: ids } },
    select: { id: true, state: true },
  });
  return new Map(
    rows.map((l) => {
      const state = toRaw(l.state);
      return [l.id, state ? { key: state.toLowerCase(), label: state } : NONE];
    }),
  );
};

// ── dimension tables ─────────────────────────────────────────────────────────

export const SPOC_DIM_DEFS: Record<SpocDim, DimDef> = {
  handler: { field: "handlerId", resolve: users, sql: Prisma.sql`s."handlerId"` },
  businessUnit: { field: "businessUnitId", resolve: businessUnits, sql: Prisma.sql`s."businessUnitId"` },
  serviceLine: { field: "serviceLineId", resolve: serviceLines, sql: Prisma.sql`s."serviceLineId"` },
  salesStatus: { field: "salesStatusId", resolve: lookups, sql: Prisma.sql`s."salesStatusId"` },
  source: { field: "sourceId", resolve: lookups, sql: Prisma.sql`s."sourceId"` },
  emailSource: { field: "emailSourceId", resolve: lookups, sql: Prisma.sql`s."emailSourceId"` },
  emailStatus: { field: "emailStatus", resolve: enumLabel, sql: Prisma.sql`s."emailStatus"::text` },
  validationBand: {
    field: "validationBand",
    resolve: enumLabel,
    sql: Prisma.sql`s."validationBand"::text`,
  },
  client: { field: "clientId", resolve: clients, sql: Prisma.sql`s."clientId"` },
  seniority: { field: "seniority", resolve: text, sql: Prisma.sql`NULLIF(TRIM(s."seniority"), '')` },
  department: {
    field: "department",
    resolve: text,
    sql: Prisma.sql`NULLIF(TRIM(s."department"), '')`,
  },
  state: {
    field: "locationId",
    resolve: locationStates,
    sql: Prisma.sql`NULLIF(TRIM(l."state"), '')`,
    sqlResolve: text,
  },
  isPrimary: { field: "isPrimary", resolve: yesNo, sql: Prisma.sql`s."isPrimary"::text` },
};

// primary active location of the client (at most one by rule)
const primaryLocation = (col: "state" | "city") =>
  Prisma.sql`(SELECT NULLIF(TRIM(pl.${Prisma.raw(`"${col}"`)}), '') FROM "ClientLocation" pl
    WHERE pl."clientId" = c."id" AND pl."isPrimary" = true AND pl."isActive" = true LIMIT 1)`;

export const CLIENT_DIM_DEFS: Record<ClientDim, DimDef> = {
  status: { field: "status", resolve: enumLabel, sql: Prisma.sql`c."status"::text` },
  industry: { field: "industryId", resolve: lookups, sql: Prisma.sql`c."industryId"` },
  category: { field: "categoryId", resolve: lookups, sql: Prisma.sql`c."categoryId"` },
  createdBy: { field: "createdById", resolve: users, sql: Prisma.sql`c."createdById"` },
  state: { field: null, locationKey: "state", resolve: text, sql: primaryLocation("state") },
  city: { field: null, locationKey: "city", resolve: text, sql: primaryLocation("city") },
};

export const ACTIVITY_DIM_DEFS: Record<ActivityDim, DimDef> = {
  type: { field: "type", resolve: enumLabel, sql: Prisma.sql`a."type"::text` },
  actor: { field: "actorId", resolve: users, sql: Prisma.sql`a."actorId"` },
};

// raw values → labels for one dimension; unresolvable ids keep the raw id
export const resolveLabels = async (
  raws: (string | null)[],
  resolve: Resolver,
): Promise<(raw: string | null) => Label> => {
  const distinct = [...new Set(raws.filter((r): r is string => r !== null))];
  const map = distinct.length ? await resolve(distinct) : new Map<string, Label>();
  return (raw) => (raw === null ? NONE : (map.get(raw) ?? { key: raw, label: raw }));
};
