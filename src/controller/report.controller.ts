// File: report.controller.ts
// Path: src/controller/report.controller.ts
//
// Read-only aggregates. Every number is computed inside the caller's scope for
// the module it comes from, so a report never leaks records the list would hide.

import { Request, Response } from "express";
import { PermissionScope, Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  clientScopeWhere,
  resolveScopeUserIds,
  spocScopeWhere,
  stepRunScopeWhere,
} from "@/services/scope.service";
import { getUserPermissionMap } from "@/services/permission.service";
import { forbidden, grantScope } from "@/services/grant.service";
import {
  ACTIVITY_DIM_DEFS,
  CLIENT_DIM_DEFS,
  DimDef,
  Label,
  OTHER,
  SPOC_DIM_DEFS,
  resolveLabels,
  toRaw,
} from "@/services/reportDims.service";
import { pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError } from "@/utils/httpError";
import type {
  ActivityDim,
  BreakdownQuery,
  ClientDim,
  OverviewQuery,
  ReportActivitiesQuery,
  SpocDim,
  TrendQuery,
} from "@/validators/report.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── date range ───────────────────────────────────────────────────────────────

// "2026-10-24" as `to` means the whole day
const parseEnd = (v: string) => {
  const d = new Date(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) d.setUTCHours(23, 59, 59, 999);
  return d;
};

const toRange = (from: string | undefined, to: string | undefined, defaultDays: number) => {
  const end = to ? parseEnd(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - defaultDays * DAY_MS);
  if (start > end) throw ApiError(400, "from must be before to", "INVALID_RANGE");
  return { from: start, to: end };
};

// breakdown filters by date only when asked
const optionalCreatedAt = (from?: string, to?: string) =>
  from || to
    ? { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: parseEnd(to) }) } }
    : {};

// ── GET /reports/overview — sections the caller can't see are null
export const getOverview = async (req: Request, res: Response) => {
  const q = req.validatedQuery as OverviewQuery;
  const map = await getUserPermissionMap(req.user);
  const clientScope = grantScope(map, "clients.read");
  const spocScope = grantScope(map, "spocs.read");
  const stepScope = grantScope(map, "step_runs.read");
  if (!clientScope && !spocScope) throw forbidden(["clients.read", "spocs.read"]);

  const range = toRange(q.from, q.to, 30);
  const inRange = { gte: range.from, lte: range.to };

  const clientsSection = async () => {
    if (!clientScope) return null;
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(await clientScopeWhere(req.user, clientScope)),
    };
    const [total, byStatus, newInRange] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.client.count({ where: { ...where, createdAt: inRange } }),
    ]);
    const counts = { PENDING: 0, ACTIVE: 0, INACTIVE: 0 };
    for (const row of byStatus) counts[row.status] = row._count._all;
    return { total, byStatus: counts, newInRange };
  };

  const spocsSection = async () => {
    if (!spocScope) return null;
    const where: Prisma.ClientSpocWhereInput = {
      isActive: true,
      client: { deletedAt: null },
      AND: [await spocScopeWhere(req.user, spocScope)],
    };
    const [total, mine, newInRange, byBand, byEmail] = await Promise.all([
      prisma.clientSpoc.count({ where }),
      prisma.clientSpoc.count({ where: { ...where, handlerId: req.user.id } }),
      prisma.clientSpoc.count({ where: { ...where, createdAt: inRange } }),
      prisma.clientSpoc.groupBy({ by: ["validationBand"], where, _count: { _all: true } }),
      prisma.clientSpoc.groupBy({ by: ["emailStatus"], where, _count: { _all: true } }),
    ]);
    const bands = { READY: 0, REVIEW: 0, NOT_USABLE: 0, UNSCORED: 0 };
    for (const row of byBand) bands[row.validationBand ?? "UNSCORED"] = row._count._all;
    const emails = { UNVERIFIED: 0, GOOD: 0, RISKY: 0, BAD: 0 };
    for (const row of byEmail) emails[row.emailStatus] = row._count._all;
    return { total, mine, newInRange, byBand: bands, byEmailStatus: emails };
  };

  const activitySection = async () => {
    if (!clientScope) return null;
    const where: Prisma.ClientActivityWhereInput = {
      createdAt: inRange,
      client: { deletedAt: null, ...(await clientScopeWhere(req.user, clientScope)) },
    };
    const [inRangeCount, notesInRange] = await Promise.all([
      prisma.clientActivity.count({ where }),
      prisma.clientActivity.count({ where: { ...where, type: "NOTE_ADDED" } }),
    ]);
    return { inRange: inRangeCount, notesInRange };
  };

  const stepRunsSection = async () => {
    if (!stepScope) return null;
    const where = await stepRunScopeWhere(req.user, stepScope);
    const [inRangeCount, running, failed] = await Promise.all([
      prisma.stepRun.count({ where: { ...where, createdAt: inRange } }),
      // in flight right now, regardless of range
      prisma.stepRun.count({ where: { ...where, status: { in: ["QUEUED", "RUNNING"] } } }),
      prisma.stepRun.count({
        where: {
          ...where,
          createdAt: inRange,
          status: { in: ["FAILED", "DISPATCH_FAILED", "TIMED_OUT"] },
        },
      }),
    ]);
    return { inRange: inRangeCount, running, failed };
  };

  const [clients, spocs, activity, stepRuns] = await Promise.all([
    clientsSection(),
    spocsSection(),
    activitySection(),
    stepRunsSection(),
  ]);

  res.json({ success: true, data: { clients, spocs, activity, stepRuns } });
};

// ── breakdown ────────────────────────────────────────────────────────────────

type Pair = { a: string | null; b: string | null; n: number };
type GroupRow = Record<string, unknown> & { _count: { _all: number } };

const spocBreakdownWhere = async (
  req: Request,
  scope: PermissionScope,
  q: BreakdownQuery,
): Promise<Prisma.ClientSpocWhereInput> => ({
  AND: [
    await spocScopeWhere(req.user, scope),
    {
      isActive: q.isActive,
      client: { deletedAt: null },
      ...(q.clientId && { clientId: q.clientId }),
      ...(q.handlerId && { handlerId: q.handlerId }),
      ...(q.businessUnitId && { businessUnitId: q.businessUnitId }),
      ...(q.serviceLineId && { serviceLineId: q.serviceLineId }),
      ...(q.salesStatusId && { salesStatusId: q.salesStatusId }),
      ...(q.emailStatus && { emailStatus: q.emailStatus }),
      ...(q.validationBand && { validationBand: q.validationBand }),
      ...optionalCreatedAt(q.from, q.to),
    },
  ],
});

// same filters as GET /clients
const clientBreakdownWhere = async (
  req: Request,
  scope: PermissionScope,
  q: BreakdownQuery,
): Promise<Prisma.ClientWhereInput> => {
  const spocFilter: Prisma.ClientSpocWhereInput = {
    ...(q.handlerId && { handlerId: q.handlerId }),
    ...(q.businessUnitId && { businessUnitId: q.businessUnitId }),
    ...(q.serviceLineId && { serviceLineId: q.serviceLineId }),
  };
  const locationFilter: Prisma.ClientLocationWhereInput = {
    ...(q.state && { state: { equals: q.state, mode: "insensitive" } }),
    ...(q.city && { city: { equals: q.city, mode: "insensitive" } }),
  };

  return {
    deletedAt: null,
    AND: [
      await clientScopeWhere(req.user, scope),
      {
        ...(q.status && { status: q.status }),
        ...(q.industryId && { industryId: q.industryId }),
        ...(q.categoryId && { categoryId: q.categoryId }),
        ...(Object.keys(spocFilter).length && {
          spocs: { some: { isActive: true, ...spocFilter } },
        }),
        ...(Object.keys(locationFilter).length && {
          locations: { some: { isActive: true, ...locationFilter } },
        }),
        ...optionalCreatedAt(q.from, q.to),
      },
    ],
  };
};

const fromGroupRows = (rows: GroupRow[], a: DimDef, b: DimDef | null): Pair[] =>
  rows.map((r) => ({
    a: toRaw(r[a.field!]),
    b: b ? toRaw(r[b.field!]) : null,
    n: r._count._all,
  }));

const spocPairs = async (where: Prisma.ClientSpocWhereInput, a: DimDef, b: DimDef | null) => {
  const by = [a.field, ...(b ? [b.field] : [])] as Prisma.ClientSpocScalarFieldEnum[];
  const rows = await prisma.clientSpoc.groupBy({ by, where, _count: { _all: true } });
  return fromGroupRows(rows as unknown as GroupRow[], a, b);
};

const clientPairs = async (where: Prisma.ClientWhereInput, a: DimDef, b: DimDef | null) => {
  // plain columns → groupBy
  if (a.field && (!b || b.field)) {
    const by = [a.field, ...(b ? [b.field] : [])] as Prisma.ClientScalarFieldEnum[];
    const rows = await prisma.client.groupBy({ by, where, _count: { _all: true } });
    return fromGroupRows(rows as unknown as GroupRow[], a, b);
  }

  // state / city live on the primary location — count in memory
  const rows = await prisma.client.findMany({
    where,
    select: {
      status: true,
      industryId: true,
      categoryId: true,
      createdById: true,
      locations: {
        where: { isPrimary: true, isActive: true },
        select: { state: true, city: true },
        take: 1,
      },
    },
  });

  const pick = (row: (typeof rows)[number], d: DimDef) =>
    toRaw(d.locationKey ? row.locations[0]?.[d.locationKey] : row[d.field as keyof typeof row]);

  const counts = new Map<string, Pair>();
  for (const row of rows) {
    const pa = pick(row, a);
    const pb = b ? pick(row, b) : null;
    const k = JSON.stringify([pa, pb]);
    const hit = counts.get(k);
    if (hit) hit.n += 1;
    else counts.set(k, { a: pa, b: pb, n: 1 });
  }
  return [...counts.values()];
};

// ── GET /reports/breakdown
export const getBreakdown = async (req: Request, res: Response) => {
  const q = req.validatedQuery as BreakdownQuery;
  const map = await getUserPermissionMap(req.user);
  const key = q.entity === "spocs" ? "spocs.read" : "clients.read";
  const scope = grantScope(map, key);
  if (!scope) throw forbidden([key]);

  const defs: Record<string, DimDef> = q.entity === "spocs" ? SPOC_DIM_DEFS : CLIENT_DIM_DEFS;
  const a = defs[q.groupBy]!; // validated against the whitelist
  const b = q.splitBy ? defs[q.splitBy]! : null;

  let total: number;
  let pairs: Pair[];
  if (q.entity === "spocs") {
    const where = await spocBreakdownWhere(req, scope, q);
    [total, pairs] = await Promise.all([prisma.clientSpoc.count({ where }), spocPairs(where, a, b)]);
  } else {
    const where = await clientBreakdownWhere(req, scope, q);
    [total, pairs] = await Promise.all([prisma.client.count({ where }), clientPairs(where, a, b)]);
  }

  const [labelA, labelB] = await Promise.all([
    resolveLabels(pairs.map((p) => p.a), a.resolve),
    b ? resolveLabels(pairs.map((p) => p.b), b.resolve) : null,
  ]);

  // several raw values can share a key (e.g. locations in the same state)
  const rows = new Map<string, Label & { total: number; split: Map<string, number> }>();
  const splitTotals = new Map<string, Label & { total: number }>();

  for (const p of pairs) {
    const la = labelA(p.a);
    const row = rows.get(la.key) ?? { ...la, total: 0, split: new Map<string, number>() };
    row.total += p.n;
    rows.set(la.key, row);

    if (labelB) {
      const lb = labelB(p.b);
      row.split.set(lb.key, (row.split.get(lb.key) ?? 0) + p.n);
      const st = splitTotals.get(lb.key) ?? { ...lb, total: 0 };
      st.total += p.n;
      splitTotals.set(lb.key, st);
    }
  }

  const sortedRows = [...rows.values()]
    .sort((x, y) => y.total - x.total || x.label.localeCompare(y.label))
    .slice(0, q.limit)
    .map((r) => ({
      key: r.key,
      label: r.label,
      total: r.total,
      ...(b && { split: Object.fromEntries(r.split) }),
    }));

  res.json({
    success: true,
    data: {
      entity: q.entity,
      groupBy: q.groupBy,
      splitBy: q.splitBy ?? null,
      total,
      rows: sortedRows,
      ...(b && {
        splitKeys: [...splitTotals.values()]
          .sort((x, y) => y.total - x.total || x.label.localeCompare(y.label))
          .map(({ key: k, label }) => ({ key: k, label })),
      }),
    },
  });
};

// ── trend ────────────────────────────────────────────────────────────────────

type Interval = TrendQuery["interval"];

// whitelisted constants — the only non-parameter SQL in the trend query
const INTERVAL_SQL: Record<Interval, Prisma.Sql> = {
  day: Prisma.raw("'day'"),
  week: Prisma.raw("'week'"),
  month: Prisma.raw("'month'"),
};

// columns are timestamp(3) in UTC — compare against UTC wall-clock text
const ts = (d: Date) => Prisma.sql`${d.toISOString().slice(0, 23)}::timestamp`;

// matches Postgres date_trunc (weeks start Monday)
const truncUtc = (d: Date, interval: Interval) => {
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), interval === "month" ? 1 : d.getUTCDate()),
  );
  if (interval === "week") t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t;
};

const nextBucket = (d: Date, interval: Interval) => {
  const t = new Date(d);
  if (interval === "month") t.setUTCMonth(t.getUTCMonth() + 1);
  else t.setUTCDate(t.getUTCDate() + (interval === "week" ? 7 : 1));
  return t;
};

// same rule as clientScopeWhere: created it, or handles any of its SPOCs
const clientScopeSql = (ids: string[] | null) =>
  ids
    ? Prisma.sql`(c."createdById" = ANY(${ids}::text[]) OR EXISTS (
        SELECT 1 FROM "ClientSpoc" sx WHERE sx."clientId" = c."id" AND sx."handlerId" = ANY(${ids}::text[])))`
    : Prisma.sql`TRUE`;

const trendSource = (entity: TrendQuery["entity"], ids: string[] | null) => {
  switch (entity) {
    case "clients":
      return {
        from: Prisma.sql`FROM "Client" c`,
        date: Prisma.sql`c."createdAt"`,
        cond: Prisma.sql`c."deletedAt" IS NULL AND ${clientScopeSql(ids)}`,
      };
    case "spocs":
      return {
        from: Prisma.sql`FROM "ClientSpoc" s
          JOIN "Client" c ON c."id" = s."clientId"
          LEFT JOIN "ClientLocation" l ON l."id" = s."locationId"`,
        date: Prisma.sql`s."createdAt"`,
        cond: Prisma.sql`s."isActive" = true AND c."deletedAt" IS NULL AND ${
          ids ? Prisma.sql`s."handlerId" = ANY(${ids}::text[])` : Prisma.sql`TRUE`
        }`,
      };
    case "activities":
      return {
        from: Prisma.sql`FROM "ClientActivity" a JOIN "Client" c ON c."id" = a."clientId"`,
        date: Prisma.sql`a."createdAt"`,
        cond: Prisma.sql`c."deletedAt" IS NULL AND ${clientScopeSql(ids)}`,
      };
    case "notes":
      return {
        from: Prisma.sql`FROM "ClientNote" n JOIN "Client" c ON c."id" = n."clientId"`,
        date: Prisma.sql`n."createdAt"`,
        cond: Prisma.sql`c."deletedAt" IS NULL AND ${clientScopeSql(ids)}`,
      };
  }
};

const trendDim = (entity: TrendQuery["entity"], groupBy?: string): DimDef | null => {
  if (!groupBy) return null;
  if (entity === "spocs") return SPOC_DIM_DEFS[groupBy as SpocDim];
  if (entity === "clients") return CLIENT_DIM_DEFS[groupBy as ClientDim];
  if (entity === "activities") return ACTIVITY_DIM_DEFS[groupBy as ActivityDim];
  return null;
};

// ── GET /reports/trend
export const getTrend = async (req: Request, res: Response) => {
  const q = req.validatedQuery as TrendQuery;
  const map = await getUserPermissionMap(req.user);
  const key = q.entity === "spocs" ? "spocs.read" : "clients.read";
  const scope = grantScope(map, key);
  if (!scope) throw forbidden([key]);

  const range = toRange(q.from, q.to, 90);
  const ids = await resolveScopeUserIds(req.user, scope);
  const src = trendSource(q.entity, ids);
  const dim = trendDim(q.entity, q.groupBy);

  const rows = await prisma.$queryRaw<{ bucket: Date; k: string | null; n: number }[]>`
    SELECT date_trunc(${INTERVAL_SQL[q.interval]}, ${src.date}) AS bucket,
           ${dim ? dim.sql : Prisma.sql`NULL::text`} AS k,
           COUNT(*)::int AS n
    ${src.from}
    WHERE ${src.date} >= ${ts(range.from)} AND ${src.date} <= ${ts(range.to)} AND ${src.cond}
    ${dim ? Prisma.sql`GROUP BY 1, 2` : Prisma.sql`GROUP BY 1`}`;

  // series: top N keys by total, the rest folded into "Other"
  let seriesOf: (raw: string | null) => string = () => "";
  let splitKeys: Label[] | null = null;
  if (dim) {
    const labelOf = await resolveLabels(
      rows.map((r) => toRaw(r.k)),
      dim.sqlResolve ?? dim.resolve,
    );
    const totals = new Map<string, Label & { total: number }>();
    for (const r of rows) {
      const l = labelOf(toRaw(r.k));
      const t = totals.get(l.key) ?? { ...l, total: 0 };
      t.total += r.n;
      totals.set(l.key, t);
    }
    const ranked = [...totals.values()].sort((x, y) => y.total - x.total);
    const top = ranked.slice(0, q.top);
    const topKeys = new Set(top.map((t) => t.key));
    splitKeys = top.map(({ key: k, label }) => ({ key: k, label }));
    if (ranked.length > q.top) splitKeys.push(OTHER);
    seriesOf = (raw) => {
      const k = labelOf(toRaw(raw)).key;
      return topKeys.has(k) ? k : OTHER.key;
    };
  }

  // continuous buckets — empty ones are 0
  const points = new Map<string, { bucket: string; total: number; split?: Record<string, number> }>();
  for (let b = truncUtc(range.from, q.interval); b <= range.to; b = nextBucket(b, q.interval)) {
    const iso = b.toISOString();
    points.set(iso, {
      bucket: iso,
      total: 0,
      ...(splitKeys && { split: Object.fromEntries(splitKeys.map((s) => [s.key, 0])) }),
    });
  }

  for (const r of rows) {
    const point = points.get(new Date(r.bucket).toISOString());
    if (!point) continue;
    point.total += r.n;
    if (point.split) {
      const s = seriesOf(r.k);
      point.split[s] = (point.split[s] ?? 0) + r.n;
    }
  }

  res.json({
    success: true,
    data: {
      interval: q.interval,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      points: [...points.values()],
      ...(splitKeys && { splitKeys }),
    },
  });
};

// ── GET /reports/activities — feed across every client in clients.read scope
export const listReportActivities = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ReportActivitiesQuery;
  const scope = grantScope(req.permissions!, "clients.read");
  if (!scope) throw forbidden(["clients.read"]);

  const where: Prisma.ClientActivityWhereInput = {
    client: { deletedAt: null, ...(await clientScopeWhere(req.user, scope)) },
    ...(q.type && { type: q.type }),
    ...(q.actorId && { actorId: q.actorId }),
    ...(q.clientId && { clientId: q.clientId }),
    ...(q.spocId && { spocId: q.spocId }),
    ...optionalCreatedAt(q.from, q.to),
  };

  const [total, rows] = await Promise.all([
    prisma.clientActivity.count({ where }),
    prisma.clientActivity.findMany({
      where,
      select: {
        id: true,
        type: true,
        summary: true,
        meta: true,
        createdAt: true,
        actor: { select: PERSON },
        client: { select: { id: true, name: true } },
        spoc: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(q),
    }),
  ]);

  res.json({ success: true, data: rows, meta: pageMeta(total, q.page, q.limit) });
};
