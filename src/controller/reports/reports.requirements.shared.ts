// File: reports.requirements.shared.ts
// Path: src/controller/reports/reports.requirements.shared.ts
//
// Single source of truth for the Requirements report + export.
// BOTH getRequirementReport and exportRequirementReport must go through
// resolveRequirementScope() + buildRequirementWhere() so the screen and the
// Excel always contain the same requirements and the same candidates.

import { Request } from "express";
import {
  Prisma,
  AssignmentStatus,
  Priority,
  RemoteType,
  RequirementStatus,
  RequirementType,
  SaleValueBasis as StoredSaleValueBasis,
} from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { resolveOrgTreeDown } from "./reports.controller";

export type Q = Record<string, string | string[] | undefined>;

// ─────────────────────────────────────────────────────────────────────────────
// QUERY PARSING
// ─────────────────────────────────────────────────────────────────────────────

/** First value of a param, trimmed. */
export function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(Array.isArray(v) ? v[0] : v).trim();
  return s ? s : undefined;
}

/** Accepts repeated keys (?a=1&a=2), comma lists (?a=1,2) or both. De-duped. */
export function toArr(v: unknown): string[] {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v : [v];
  return [
    ...new Set(
      raw
        .flatMap((s) => String(s).split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

export function prismaIn(v: unknown) {
  const arr = toArr(v);
  if (!arr.length) return undefined;
  return arr.length === 1 ? arr[0] : { in: arr };
}

/**
 * Enum-safe multi filter. undefined = param not sent.
 * Invalid values are dropped; if nothing valid remains → { in: [] } (match
 * nothing) instead of silently widening results or crashing Prisma.
 */
export function enumIn<T extends string>(
  v: unknown,
  allowed: readonly T[]
): { in: T[] } | undefined {
  const vals = toArr(v);
  if (!vals.length) return undefined;
  return {
    in: vals.filter((x): x is T => (allowed as readonly string[]).includes(x)),
  };
}

export function personName(
  u: { firstName?: string | null; lastName?: string | null } | null | undefined
): string {
  if (!u) return "";
  return [u.firstName, u.lastName].filter(Boolean).join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// SALE VALUE — one priority chain for every report
// saleValue  = lump-sum total for the req (never × openings)
// band.value = per-opening fee → × openings
// salaryMin × client % = per-opening fee → × openings
// ─────────────────────────────────────────────────────────────────────────────

export type SaleValueBasis = "SALE_VALUE" | "BAND" | "FIXED_PCT" | "NOT_FOUND";
export const SALE_VALUE_BASES: SaleValueBasis[] = [
  "SALE_VALUE",
  "BAND",
  "FIXED_PCT",
  "NOT_FOUND",
];

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Stored basis (Requirement.saleValueBasis) → report basis bucket */
const STORED_BASIS_MAP: Record<StoredSaleValueBasis, SaleValueBasis> = {
  [StoredSaleValueBasis.DIRECT]: "SALE_VALUE",
  [StoredSaleValueBasis.BAND]: "BAND",
  [StoredSaleValueBasis.FIXED_PCT]: "FIXED_PCT",
};

/**
 * Priority:
 *  1. saleValue (frozen TOTAL)          → basis from stored saleValueBasis
 *  2. perOpeningValue × openings        → basis from stored saleValueBasis
 *  3. band.value × openings             → BAND
 *  4. salaryMin × client% × openings    → FIXED_PCT
 *  5. NOT_FOUND
 */
export function computeSaleValue(r: {
  saleValue?: unknown;
  perOpeningValue?: unknown;
  saleValueBasis?: StoredSaleValueBasis | null;
  totalOpenings: number;
  salaryMin?: unknown;
  band?: { value?: unknown } | null;
  client?: { percentageValue?: unknown } | null;
}): { value: number | null; basis: SaleValueBasis } {
  const openings = r.totalOpenings ?? 0;
  const storedBasis: SaleValueBasis = r.saleValueBasis
    ? STORED_BASIS_MAP[r.saleValueBasis]
    : "SALE_VALUE";

  const sv = num(r.saleValue);
  if (sv != null && sv > 0) return { value: sv, basis: storedBasis };

  const pov = num(r.perOpeningValue);
  if (pov != null && pov > 0)
    return { value: pov * openings, basis: storedBasis };

  const bv = num(r.band?.value);
  if (bv != null && bv > 0) return { value: bv * openings, basis: "BAND" };

  const pct = num(r.client?.percentageValue);
  const sm = num(r.salaryMin);
  if (pct != null && pct > 0 && sm != null && sm > 0)
    return { value: sm * (pct / 100) * openings, basis: "FIXED_PCT" };

  return { value: null, basis: "NOT_FOUND" };
}

export function emptyByBasis(): Record<
  SaleValueBasis,
  { count: number; total: number }
> {
  return Object.fromEntries(
    SALE_VALUE_BASES.map((b) => [b, { count: 0, total: 0 }])
  ) as Record<SaleValueBasis, { count: number; total: number }>;
}

/** (count / openings) × saleValue — null when not computable */
export function shareOf(
  count: number,
  openings: number,
  saleValue: number | null
): number | null {
  if (saleValue == null || openings <= 0) return null;
  return (count / openings) * saleValue;
}

/**
 * Achieved + pipeline value of ONE requirement, capped at its openings.
 * Same rule as the Recruiters tab: placements beyond openings add nothing,
 * and pipeline only fills the openings that are still unfilled.
 *   3 placed on a 1-opening req → 100% achieved, never 300%.
 */
export function cappedShares(
  terminal: number,
  nearTerminal: number,
  openings: number,
  saleValue: number | null
): { achievedValue: number | null; nearTerminalValue: number | null } {
  if (saleValue == null || openings <= 0)
    return { achievedValue: null, nearTerminalValue: null };
  const placed = Math.min(terminal, openings);
  const near = Math.min(nearTerminal, openings - placed);
  return {
    achievedValue: (placed / openings) * saleValue,
    nearTerminalValue: (near / openings) * saleValue,
  };
}

/** count / openings as % (1 decimal, capped at 100) */
export function pctOf(count: number, openings: number): number {
  if (openings <= 0) return 0;
  return Math.min(100, Math.round((count / openings) * 1_000) / 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOWS
// Requirements report has TWO independent date filters (both optional):
//   created*  → requirement.createdAt in window
//               ?createdRange= | ?createdFrom=&createdTo=
//   activity* → candidates added/updated/moved in window. Applies to BOTH the
//               requirement list (only reqs with such candidates) AND the
//               counts / candidate rows — so computed, achieved and pipeline
//               always describe the same set of requirements.
//               ?activityRange= | ?activityFrom=&activityTo=
// Both set → AND. Neither set → everything.
// ─────────────────────────────────────────────────────────────────────────────

export type DateWindow = { gte?: Date; lte?: Date };

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const DATE_PRESETS: Record<
  string,
  { label: string; window: () => DateWindow }
> = {
  today: { label: "Today", window: () => ({ gte: startOfDay(new Date()) }) },
  yesterday: {
    label: "Yesterday",
    window: () => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return { gte: startOfDay(y), lte: endOfDay(y) };
    },
  },
  last7: {
    label: "Last 7 days",
    window: () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { gte: d };
    },
  },
  last30: {
    label: "Last 30 days",
    window: () => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return { gte: d };
    },
  },
  thisMonth: {
    label: "This month",
    window: () => {
      const d = startOfDay(new Date());
      d.setDate(1);
      return { gte: d };
    },
  },
};

/** Reads `${prefix}From/To` (custom) or `${prefix}Range` (preset). null = not set. */
export function resolvePrefixedWindow(q: Q, prefix: string): DateWindow | null {
  const from = str(q[`${prefix}From`]);
  const to = str(q[`${prefix}To`]);
  if (from || to) {
    return {
      ...(from ? { gte: startOfDay(new Date(from)) } : {}),
      ...(to ? { lte: endOfDay(new Date(to)) } : {}),
    };
  }
  const range = str(q[`${prefix}Range`]);
  if (range && DATE_PRESETS[range]) return DATE_PRESETS[range].window();
  return null;
}

function prefixedLabel(q: Q, prefix: string): string | null {
  const from = str(q[`${prefix}From`]);
  const to = str(q[`${prefix}To`]);
  if (from || to) return `${from || "start"} → ${to || "now"}`;
  const range = str(q[`${prefix}Range`]);
  if (range) return DATE_PRESETS[range]?.label ?? range;
  return null;
}

/**
 * Activity date → pipeline-level filter (counts + candidate rows only).
 * A candidate counts when it was added, updated or moved stage in the window.
 * {} when not set → all candidates.
 */
export function buildActivityPipelineWhere(
  q: Q
): Prisma.RequirementCandidatePipelineWhereInput {
  const win = resolvePrefixedWindow(q, "activity");
  if (!win) return {};
  return {
    OR: [
      { createdAt: win },
      { updatedAt: win },
      { stageHistory: { some: { createdAt: win } } },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATED-MONTH BREAKDOWN — "which month were these requirements created in"
// Month keys are computed on the SERVER in one timezone so screen + Excel agree.
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_TZ = process.env.REPORT_TIMEZONE || "Asia/Kolkata";
const monthKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TZ,
  year: "numeric",
  month: "2-digit",
});
const monthLabelFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

/** Date → "YYYY-MM" in the report timezone */
export function monthKey(d: Date | string): string {
  const parts = monthKeyFmt.formatToParts(new Date(d));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${y}-${m}`;
}

/** "YYYY-MM" → "Jul 2026" */
export function monthLabel(key: string): string {
  return monthLabelFmt.format(new Date(`${key}-01T00:00:00Z`));
}

export type CreatedMonthStat = {
  month: string; // YYYY-MM
  label: string; // Jul 2026
  requirements: number;
  openings: number;
  computedSaleValue: number;
  terminalCount: number;
  achievedValue: number;
  nearTerminalCount: number;
  nearTerminalValue: number;
  achievedPct: number; // achieved / computed
};

export function buildCreatedMonthBreakdown(
  rows: {
    createdAt: Date | string;
    totalOpenings: number;
    computedSaleValue: number | null;
    terminalCount: number;
    achievedValue: number | null;
    nearTerminalCount: number;
    nearTerminalValue: number | null;
  }[]
): CreatedMonthStat[] {
  const map = new Map<string, CreatedMonthStat>();
  for (const r of rows) {
    const key = monthKey(r.createdAt);
    const m =
      map.get(key) ??
      ({
        month: key,
        label: monthLabel(key),
        requirements: 0,
        openings: 0,
        computedSaleValue: 0,
        terminalCount: 0,
        achievedValue: 0,
        nearTerminalCount: 0,
        nearTerminalValue: 0,
        achievedPct: 0,
      } as CreatedMonthStat);
    m.requirements++;
    m.openings += r.totalOpenings;
    m.computedSaleValue += r.computedSaleValue ?? 0;
    m.terminalCount += r.terminalCount;
    m.achievedValue += r.achievedValue ?? 0;
    m.nearTerminalCount += r.nearTerminalCount;
    m.nearTerminalValue += r.nearTerminalValue ?? 0;
    map.set(key, m);
  }
  return [...map.values()]
    .map((m) => ({
      ...m,
      achievedPct:
        m.computedSaleValue > 0
          ? Math.round((m.achievedValue / m.computedSaleValue) * 1_000) / 10
          : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** e.g. "Created: This month · Activity: Last 7 days" | "All time" */
export function windowLabel(q: Q): string {
  const parts: string[] = [];
  const created = prefixedLabel(q, "created");
  const activity = prefixedLabel(q, "activity");
  if (created) parts.push(`Created: ${created}`);
  if (activity) parts.push(`Activity: ${activity}`);
  return parts.length ? parts.join(" · ") : "All time";
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT FIELD FILTERS
// Allow-list of requirement columns the client may filter on directly.
// (Security: query params must never be spread into a Prisma where blindly.)
// ─────────────────────────────────────────────────────────────────────────────

// enum fields → allowed values pulled from the Prisma schema; id fields → null
const REQ_FIELD_FILTERS: Record<string, readonly string[] | null> = {
  status: Object.values(RequirementStatus),
  priority: Object.values(Priority),
  jobType: Object.values(RequirementType),
  remoteType: Object.values(RemoteType),
  clientId: null,
  clientSpocId: null,
  serviceLineId: null,
  businessUnitId: null,
};

export function buildReqFieldWhere(q: Q): Prisma.RequirementWhereInput {
  const where: Record<string, unknown> = { deletedAt: null };
  for (const [field, allowed] of Object.entries(REQ_FIELD_FILTERS)) {
    const v = allowed ? enumIn(q[field], allowed) : prismaIn(q[field]);
    if (v !== undefined) where[field] = v;
  }
  return where as Prisma.RequirementWhereInput;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGES
// ─────────────────────────────────────────────────────────────────────────────

/** Stages used for COLUMNS (scoped to service line if one is picked) */
export async function fetchScopedStages(serviceLineIds: string[]) {
  return prisma.pipelineStage.findMany({
    where: {
      isActive: true,
      ...(serviceLineIds.length
        ? {
            OR: [
              { serviceLineId: null },
              { serviceLineId: { in: serviceLineIds } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      isStandard: true,
      isTerminal: true,
      isNearTerminal: true,
      isSourced: true,
      pipeline: true,
      serviceLineId: true,
      serviceLine: { select: { id: true, name: true } },
    },
    orderBy: { order: "asc" },
  });
}

export type ScopedStage = Awaited<ReturnType<typeof fetchScopedStages>>[number];

/**
 * Flags for EVERY stage (incl. inactive / other service lines) — used to
 * classify counts. A candidate sitting in an inactive terminal stage is
 * still placed; dropping it would make totals disagree across reports.
 */
export async function fetchStageFlagMap() {
  const all = await prisma.pipelineStage.findMany({
    select: {
      id: true,
      label: true,
      isTerminal: true,
      isNearTerminal: true,
      isSourced: true,
      pipeline: true,
    },
  });
  return new Map(all.map((s) => [s.id, s]));
}

export type StageFlagMap = Awaited<ReturnType<typeof fetchStageFlagMap>>;

export function classifyStageCounts(
  stageCts: Record<string, number>,
  stageById: StageFlagMap
): { total: number; terminal: number; nearTerminal: number } {
  let total = 0;
  let terminal = 0;
  let nearTerminal = 0;
  for (const [stageId, count] of Object.entries(stageCts)) {
    total += count;
    const st = stageById.get(stageId);
    if (!st) continue;
    if (st.isTerminal) terminal += count;
    else if (st.isNearTerminal) nearTerminal += count;
  }
  return { total, terminal, nearTerminal };
}

export function stageMetaOut(stages: ScopedStage[], standardOnly: boolean) {
  return (standardOnly ? stages.filter((s) => s.isStandard) : stages).map(
    (s) => ({
      id: s.id,
      label: s.label,
      order: s.order,
      isStandard: s.isStandard,
      isTerminal: s.isTerminal,
      isNearTerminal: s.isNearTerminal,
      serviceLineId: s.serviceLineId,
      serviceLine: s.serviceLine,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE (HIERARCHY) — the security layer
// ─────────────────────────────────────────────────────────────────────────────

export interface RequirementScope {
  /** org tree of the logged-in user, null = unrestricted (super admin) */
  treeUserIds: string[] | null;
  /** team picker selection ∩ tree, null = not used */
  teamUserIds: string[] | null;
  /** requirement-level hierarchy where (created by OR assigned to my tree) */
  scopeWhere: Prisma.RequirementWhereInput;
  /** whose candidates may be counted / listed, null = everyone */
  pipelineUserIds: string[] | null;
  pipelineOwnerWhere: Prisma.RequirementCandidatePipelineWhereInput;
}

/**
 * Assignment statuses that still give report visibility.
 * FILLED / EXPIRED = recruiter did (or tried) the work — must stay visible.
 * REMOVED / REPLACED = taken off; their own candidates still keep the req
 * visible through the pipeline rule in resolveRequirementScope.
 */
export const REPORT_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ACTIVE,
  AssignmentStatus.FILLED,
  AssignmentStatus.EXPIRED,
];

type AssignmentField = "assignedToId" | "assignedById";

/** Requirement-level relation filter: has an assignment where <field> ∈ ids */
function assignmentWhere(
  field: AssignmentField,
  userIds: string[]
): Prisma.RequirementWhereInput {
  return {
    assignments: {
      some: {
        [field]: { in: userIds },
        status: { in: REPORT_ASSIGNMENT_STATUSES },
      },
    },
  } as Prisma.RequirementWhereInput;
}

/** created by OR assigned to OR has candidates owned by these users */
function touchedByUsersWhere(userIds: string[]): Prisma.RequirementWhereInput {
  return {
    OR: [
      { createdById: { in: userIds } },
      assignmentWhere("assignedToId", userIds),
      { pipelines: { some: { recruiterId: { in: userIds } } } },
    ],
  };
}

export async function resolveRequirementScope(
  req: Request,
  q: Q
): Promise<RequirementScope> {
  const treeUserIds = await resolveOrgTreeDown(
    req.user!.id,
    req.user!.isSuperAdmin
  );
  const narrowToTree = (ids: string[]) =>
    treeUserIds === null ? ids : ids.filter((id) => treeUserIds.includes(id));

  // Requirement visibility: created by / assigned to / worked on by my tree
  const scopeWhere: Prisma.RequirementWhereInput =
    treeUserIds === null ? {} : touchedByUsersWhere(treeUserIds);

  // Team picker — can only NARROW
  const teamPick = toArr(q.userIds);
  const teamUserIds = teamPick.length ? narrowToTree(teamPick) : null;

  // Candidate ownership — team picker > tree; recruiter filter narrows further
  const baseOwners = teamUserIds ?? treeUserIds;
  const recruiterPick = toArr(q.recruiterId);
  const pipelineUserIds: string[] | null = recruiterPick.length
    ? baseOwners === null
      ? recruiterPick
      : recruiterPick.filter((id) => baseOwners.includes(id))
    : baseOwners;

  const pipelineOwnerWhere: Prisma.RequirementCandidatePipelineWhereInput =
    pipelineUserIds === null ? {} : { recruiterId: { in: pipelineUserIds } };

  return {
    treeUserIds,
    teamUserIds,
    scopeWhere,
    pipelineUserIds,
    pipelineOwnerWhere,
  };
}

/**
 * Builds the requirement where. Everything is AND-ed onto the hierarchy scope,
 * so no UI filter (createdBy / assignedTo / assignedBy / ids / single id) can
 * ever reach a requirement outside the user's scope.
 */
export async function buildRequirementWhere(
  q: Q,
  scope: RequirementScope,
  opts: { singleId?: string | null; selectedIds?: string[] | null } = {}
): Promise<Prisma.RequirementWhereInput> {
  const AND: Prisma.RequirementWhereInput[] = [];
  if (Object.keys(scope.scopeWhere).length) AND.push(scope.scopeWhere);

  // Single requirement export — scope still enforced
  if (opts.singleId) {
    AND.push({ id: opts.singleId, deletedAt: null });
    return { AND };
  }

  AND.push(buildReqFieldWhere(q));

  // Explicit row selection — user already saw these under the current filters
  if (opts.selectedIds?.length) {
    AND.push({ id: { in: opts.selectedIds } });
    return { AND };
  }

  // Created by — ANY user (not just my tree); scope above keeps it safe
  const createdBy = toArr(q.createdById);
  if (createdBy.length) AND.push({ createdById: { in: createdBy } });

  // Assigned to / assigned by — active assignments
  const assignedTo = toArr(q.assignedToId);
  if (assignedTo.length) AND.push(assignmentWhere("assignedToId", assignedTo));

  const assignedBy = toArr(q.assignedById);
  if (assignedBy.length) AND.push(assignmentWhere("assignedById", assignedBy));

  // Team picker — reqs created by OR assigned to the picked team
  if (scope.teamUserIds) {
    AND.push(
      scope.teamUserIds.length
        ? touchedByUsersWhere(scope.teamUserIds)
        : { id: { in: [] } }
    );
  }

  // Created date — requirement.createdAt
  const createdWin = resolvePrefixedWindow(q, "created");
  if (createdWin) AND.push({ createdAt: createdWin });

  // Activity date — list ONLY requirements that have candidates (of my scoped
  // recruiters) active in the window. The same rule narrows the counts/rows
  // (buildActivityPipelineWhere in the controllers), so computed sale value is
  // always the denominator of exactly the achieved / pipeline it is shown with.
  // Not set → nothing hidden.
  const activityPipelineWhere = buildActivityPipelineWhere(q);
  if (Object.keys(activityPipelineWhere).length) {
    AND.push({
      pipelines: {
        some: { ...scope.pipelineOwnerWhere, ...activityPipelineWhere },
      },
    });
  }

  return { AND };
}

// ─────────────────────────────────────────────────────────────────────────────
// PEOPLE FILTER OPTIONS — createdBy / assignedTo / assignedBy / recruiters
// Derived from real data inside the user's scope (nothing hardcoded).
// ─────────────────────────────────────────────────────────────────────────────

export type PersonOption = {
  id: string;
  name: string;
  email: string | null;
  isActive: boolean;
  roleName: string | null; // for role-grouped pickers on the frontend
  /** createdBy / assignedBy / assignedTo → distinct requirements; recruiters → candidates */
  count: number;
};

export type PeopleFilterOptions = {
  createdBy: PersonOption[];
  assignedBy: PersonOption[];
  assignedTo: PersonOption[];
  recruiters: PersonOption[];
};

/**
 * People options are DERIVED from the user's own associations — never "everyone".
 *
 *  createdBy  → creators of requirements visible to my tree
 *  assignedBy → who assigned work in assignment rows my tree is part of
 *  assignedTo → who received work in assignment rows my tree is part of
 *  recruiters → candidate owners inside my scope
 *
 * "Assignment rows my tree is part of" = assigned TO my tree, OR assigned BY my
 * tree, OR on a requirement my tree created. So:
 *  - Recruiter  → assignedBy = their lead/DM, assignedTo = themselves
 *  - Lead       → assignedBy = DM/CSM above, assignedTo = recruiters they assigned
 *  - CSM        → full assignment chain on requirements they created
 * Another team's recruiter who merely shares a requirement does NOT appear.
 */
export async function fetchPeopleFilterOptions(
  scope: RequirementScope
): Promise<PeopleFilterOptions> {
  const tree = scope.treeUserIds;

  const reqScope: Prisma.RequirementWhereInput = {
    deletedAt: null,
    ...scope.scopeWhere,
  };

  const assignmentAssoc: Prisma.RequirementAssignmentWhereInput = {
    status: { in: REPORT_ASSIGNMENT_STATUSES },
    requirement: { deletedAt: null },
    ...(tree === null
      ? {}
      : {
          OR: [
            { assignedToId: { in: tree } },
            { assignedById: { in: tree } },
            { requirement: { createdById: { in: tree } } },
          ],
        }),
  };

  const [creatorGroups, assignmentGroups, recruiterGroups] = await Promise.all([
    prisma.requirement.groupBy({
      by: ["createdById"],
      where: reqScope,
      _count: { _all: true },
    }),
    // one row per (to, by, requirement) → distinct requirement counts per person
    prisma.requirementAssignment.groupBy({
      by: ["assignedToId", "assignedById", "requirementId"],
      where: assignmentAssoc,
    }),
    prisma.requirementCandidatePipeline.groupBy({
      by: ["recruiterId"],
      where: { requirement: reqScope, ...scope.pipelineOwnerWhere },
      _count: { _all: true },
    }),
  ]);

  const createdByCount = new Map<string, number>(
    creatorGroups.map((g) => [g.createdById, g._count._all])
  );
  const recruiterCount = new Map<string, number>(
    recruiterGroups.map((g) => [g.recruiterId, g._count._all])
  );

  const reqsBy = new Map<string, Set<string>>();
  const reqsTo = new Map<string, Set<string>>();
  const addTo = (
    m: Map<string, Set<string>>,
    userId: string,
    reqId: string
  ) => {
    if (!m.has(userId)) m.set(userId, new Set());
    m.get(userId)!.add(reqId);
  };
  for (const g of assignmentGroups) {
    addTo(reqsBy, g.assignedById, g.requirementId);
    addTo(reqsTo, g.assignedToId, g.requirementId);
  }

  const sizeMap = (m: Map<string, Set<string>>) =>
    new Map<string, number>([...m].map(([id, set]) => [id, set.size]));
  const assignedByCount = sizeMap(reqsBy);
  const assignedToCount = sizeMap(reqsTo);

  const allIds = [
    ...new Set([
      ...createdByCount.keys(),
      ...assignedByCount.keys(),
      ...assignedToCount.keys(),
      ...recruiterCount.keys(),
    ]),
  ];
  if (!allIds.length)
    return { createdBy: [], assignedBy: [], assignedTo: [], recruiters: [] };

  const users = await prisma.user.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
      role: { select: { name: true } },
    },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const build = (counts: Map<string, number>): PersonOption[] =>
    [...counts]
      .map(([id, count]) => {
        const u = userById.get(id);
        if (!u) return null;
        return {
          id,
          name: personName(u),
          email: u.email ?? null,
          isActive: u.isActive ?? true,
          roleName: u.role?.name ?? null,
          count,
        };
      })
      .filter((p): p is PersonOption => !!p)
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    createdBy: build(createdByCount),
    assignedBy: build(assignedByCount),
    assignedTo: build(assignedToCount),
    recruiters: build(recruiterCount),
  };
}
