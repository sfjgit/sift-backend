// File: reports.recruiters.controller.ts
// Path: src/controller/reports/reports.recruiters.controller.ts
//
// Everything on the Recruiters tab, built on ONE loader so the table, the
// summary bar, the drill, the MOJ options and the Excel always agree.
//
// Scope   — org tree (reportingTo / teamLead), same rule as the Requirements tab.
//           You see yourself + everyone under you. Super admin sees everyone.
//           Rows are ordered by hierarchy: you, then direct reports, then theirs.
//
// Values  — UNIQUE requirements, never double counted:
//   person  → sale value of requirements ASSIGNED to them; achieved / pipeline
//             from THEIR candidates on those requirements.
//   team    → union of requirements assigned to anyone in the team (each once);
//             placements of all members on a requirement are combined first.
//   Both are capped per requirement: placed beyond openings never adds value.
//   Placements on requirements not assigned to the person are reported
//   separately ("unassignedPlaced") and never inflate the %.
//
// MOJ     — computed at read time from LWD or notice period (reports.joining.ts).
//
// Routes:
//   GET /reports/recruiters                     getRecruiterReport
//   GET /reports/recruiters/sale-summary        getRecruiterSaleSummary
//   GET /reports/recruiters/stats               getRecruiterStats
//   GET /reports/recruiters/drill               getRecruiterDrill
//   GET /reports/recruiters/drill/moj-options   getRecruiterDrillMojOptions
//   GET /reports/recruiters/export              exportRecruiterReport

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  Q,
  str,
  toArr,
  personName,
  computeSaleValue,
  emptyByBasis,
  SaleValueBasis,
  buildReqFieldWhere,
  fetchScopedStages,
  stageMetaOut,
  REPORT_ASSIGNMENT_STATUSES,
} from "./reports.requirements.shared";
import {
  buildMojRanges,
  mojPipelineWhere,
  resolveJoining,
  JoiningInfo,
  JOINING_SOURCE_LABELS,
} from "./reports.joining";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW — the Recruiters tab's generic window (range | hours | from/to)
// Applied as ACTIVITY: candidate added / updated / moved stage in the window.
// ─────────────────────────────────────────────────────────────────────────────

type DateWindow = { gte?: Date; lte?: Date };

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
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const WINDOW_PRESETS: Record<
  string,
  { label: string; window: (now: Date) => DateWindow }
> = {
  today: {
    label: "Today",
    window: (now) => ({ gte: startOfDay(now), lte: now }),
  },
  yesterday: {
    label: "Yesterday",
    window: (now) => {
      const y = addDays(now, -1);
      return { gte: startOfDay(y), lte: endOfDay(y) };
    },
  },
  last7: {
    label: "Last 7 days",
    window: (now) => ({ gte: startOfDay(addDays(now, -6)), lte: now }),
  },
  last30: {
    label: "Last 30 days",
    window: (now) => ({ gte: startOfDay(addDays(now, -29)), lte: now }),
  },
  thisMonth: {
    label: "This month",
    window: (now) => {
      const s = startOfDay(now);
      s.setDate(1);
      return { gte: s, lte: now };
    },
  },
};

function resolveWindow(q: Q): DateWindow | null {
  const now = new Date();
  const hours = str(q.hours);
  if (hours) {
    const h = parseInt(hours, 10);
    if (!Number.isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3_600_000), lte: now };
  }
  const range = str(q.range);
  if (range && WINDOW_PRESETS[range]) return WINDOW_PRESETS[range].window(now);
  const from = str(q.fromDate);
  const to = str(q.toDate);
  if (from || to)
    return {
      ...(from ? { gte: startOfDay(new Date(from)) } : {}),
      ...(to ? { lte: endOfDay(new Date(to)) } : {}),
    };
  return null;
}

export function windowLabel(q: Q): string {
  const hours = str(q.hours);
  if (hours) return `Last ${hours}h`;
  const range = str(q.range);
  if (range) return WINDOW_PRESETS[range]?.label ?? range;
  const from = str(q.fromDate);
  const to = str(q.toDate);
  if (from || to) return `${from || "start"} → ${to || "now"}`;
  return "All time";
}

export const inWindow = (
  d: Date | string | null | undefined,
  w: DateWindow | null
) => {
  if (!w || !d) return false;
  const t = new Date(d).getTime();
  return (!w.gte || t >= w.gte.getTime()) && (!w.lte || t <= w.lte.getTime());
};

// ─────────────────────────────────────────────────────────────────────────────
// ORG GRAPH — one query; gives scope, depth, managers, team rollups, names
// ─────────────────────────────────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  isActive: true,
  reportingToId: true,
  teamLeadId: true,
  servicelineId: true,
  serviceline: { select: { id: true, name: true } },
  departmentId: true,
  department: { select: { id: true, name: true } },
  role: { select: { name: true } },
} as const;

type OrgUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

interface OrgGraph {
  byId: Map<string, OrgUser>;
  children: Map<string, string[]>;
}

async function loadOrgGraph(): Promise<OrgGraph> {
  const users = await prisma.user.findMany({ select: USER_SELECT });
  const byId = new Map(users.map((u) => [u.id, u]));
  const children = new Map<string, string[]>();
  for (const u of users) {
    if (!u.isActive) continue;
    for (const parent of new Set([u.reportingToId, u.teamLeadId])) {
      if (!parent || parent === u.id) continue;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(u.id);
    }
  }
  return { byId, children };
}

/** BFS down the tree → id → depth (root = 0) */
function walkDown(roots: string[], g: OrgGraph): Map<string, number> {
  const depth = new Map<string, number>();
  let frontier = roots.filter((r) => !depth.has(r));
  roots.forEach((r) => depth.set(r, 0));
  let level = 0;
  while (frontier.length) {
    level++;
    const next: string[] = [];
    for (const id of frontier)
      for (const c of g.children.get(id) ?? [])
        if (!depth.has(c)) {
          depth.set(c, level);
          next.push(c);
        }
    frontier = next;
  }
  return depth;
}

/** All users below `id` (not including id) */
export function descendantsOf(id: string, g: OrgGraph): Set<string> {
  const out = new Set<string>();
  const stack = [...(g.children.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c) || c === id) continue;
    out.add(c);
    stack.push(...(g.children.get(c) ?? []));
  }
  return out;
}

export const managerName = (u: OrgUser | undefined, g: OrgGraph) => {
  const mid = u?.reportingToId ?? u?.teamLeadId;
  return mid ? personName(g.byId.get(mid)) || null : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT — scope + filters, resolved once per request
// ─────────────────────────────────────────────────────────────────────────────

export interface RecruiterContext {
  q: Q;
  graph: OrgGraph;
  /** null = unrestricted (super admin, nothing narrowed) */
  peopleIds: string[] | null;
  /** hierarchy depth for ordering (relative to the viewer, or to roots for super admin) */
  depth: Map<string, number>;
  reqWhere: Prisma.RequirementWhereInput;
  window: DateWindow | null;
  /** MOJ as a DB where (LWD range OR NP-days range); null = no MOJ filter */
  moj: Prisma.RequirementCandidatePipelineWhereInput | null;
}

export class ScopeError extends Error {}

export async function buildContext(
  req: Request,
  q: Q,
  opts: { recruiterId?: string | null; selectedIds?: string[] } = {}
): Promise<RecruiterContext> {
  const graph = await loadOrgGraph();
  const isSuper = !!req.user!.isSuperAdmin;

  let depth: Map<string, number>;
  let ids: string[] | null;
  if (isSuper) {
    const roots = [...graph.byId.values()]
      .filter((u) => u.isActive)
      .filter((u) => {
        const parents = [u.reportingToId, u.teamLeadId].filter(
          Boolean
        ) as string[];
        return !parents.some((p) => graph.byId.get(p)?.isActive);
      })
      .map((u) => u.id);
    depth = walkDown(roots, graph);
    ids = null;
  } else {
    depth = walkDown([req.user!.id], graph);
    ids = [...depth.keys()];
  }

  const narrow = (pick: string[]) =>
    ids === null ? pick : pick.filter((id) => ids!.includes(id));

  // Team picker — narrows only
  const team = toArr(q.userIds);
  if (team.length) ids = narrow(team);

  // Department — narrows only
  const depts = toArr(q.departmentId);
  if (depts.length) {
    const inDept = [...graph.byId.values()]
      .filter((u) => u.departmentId && depts.includes(u.departmentId))
      .map((u) => u.id);
    ids = narrow(inDept);
  }

  // Explicit selection (export of selected rows)
  if (opts.selectedIds?.length) ids = narrow(opts.selectedIds);

  // Single person (drill)
  if (opts.recruiterId) {
    if (ids !== null && !ids.includes(opts.recruiterId))
      throw new ScopeError("Recruiter not in your scope");
    ids = [opts.recruiterId];
  }

  // Requirement filters
  const AND: Prisma.RequirementWhereInput[] = [buildReqFieldWhere(q)];
  const createdBy = toArr(q.createdById);
  if (createdBy.length) AND.push({ createdById: { in: createdBy } });
  const reqIds = toArr(q.requirementId);
  if (reqIds.length) AND.push({ id: { in: reqIds } });

  return {
    q,
    graph,
    peopleIds: ids,
    depth,
    reqWhere: { AND },
    window: resolveWindow(q),
    moj: mojPipelineWhere(buildMojRanges(q)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADERS
// ─────────────────────────────────────────────────────────────────────────────

const PIPE_CORE_SELECT = {
  id: true,
  recruiterId: true,
  requirementId: true,
  currentStageId: true,
  isOnHold: true,
  submittedAt: true,
  offerStatus: true,
  noticePeriodDays: true,
  lastWorkingDate: true,
  stageUpdatedAt: true,
  createdAt: true,
  currentStage: {
    select: {
      id: true,
      code: true,
      label: true,
      order: true,
      isTerminal: true,
      isNearTerminal: true,
      isSourced: true,
      pipeline: true,
    },
  },
  stageHistory: { select: { timeInPrevStageMins: true } },
} as const;

const PIPE_FULL_SELECT = {
  ...PIPE_CORE_SELECT,
  // newest first → the latest entry into the current stage = when / who moved it there
  stageHistory: {
    select: {
      timeInPrevStageMins: true,
      createdAt: true,
      fromStageId: true,
      toStageId: true,
      changedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  salaryCurrency: true,
  salaryType: true,
  snapshot: {
    select: {
      fullName: true,
      email: true,
      phone: true,
      currentTitle: true,
      currentCompany: true,
      totalExpYears: true,
      topSkills: true,
      resumeUrl: true,
    },
  },
} as const;

type PipeRow = Prisma.RequirementCandidatePipelineGetPayload<{
  select: typeof PIPE_FULL_SELECT;
}> & {
  joining: JoiningInfo;
};

/** Pipelines in scope + filters. MOJ runs in the DB (LWD range OR NP-days range). */
async function loadPipelines(
  ctx: RecruiterContext,
  opts: {
    full?: boolean;
    extra?: Prisma.RequirementCandidatePipelineWhereInput;
    ignoreMoj?: boolean;
  } = {}
): Promise<PipeRow[]> {
  const AND: Prisma.RequirementCandidatePipelineWhereInput[] = [
    { requirement: { is: ctx.reqWhere } },
  ];
  if (ctx.peopleIds !== null) AND.push({ recruiterId: { in: ctx.peopleIds } });
  if (ctx.window)
    AND.push({
      OR: [
        { createdAt: ctx.window },
        { updatedAt: ctx.window },
        { stageHistory: { some: { createdAt: ctx.window } } },
      ],
    });
  if (opts.extra) AND.push(opts.extra);
  if (ctx.moj && !opts.ignoreMoj) AND.push(ctx.moj);

  const rows = (await prisma.requirementCandidatePipeline.findMany({
    where: { AND },
    select: opts.full ? PIPE_FULL_SELECT : PIPE_CORE_SELECT,
    orderBy: { createdAt: "desc" },
  })) as PipeRow[];

  const now = new Date();
  return rows.map((p) => ({ ...p, joining: resolveJoining(p, now) }));
}

export async function loadAssignments(ctx: RecruiterContext) {
  return prisma.requirementAssignment.findMany({
    where: {
      status: { in: REPORT_ASSIGNMENT_STATUSES },
      requirement: { is: ctx.reqWhere },
      ...(ctx.peopleIds !== null
        ? { assignedToId: { in: ctx.peopleIds } }
        : {}),
    },
    select: {
      requirementId: true,
      assignedToId: true,
      assignedById: true,
      assignedAt: true,
    },
  });
}

const REQ_INFO_SELECT = {
  id: true,
  reqCode: true,
  title: true,
  status: true,
  totalOpenings: true,
  createdAt: true,
  saleValue: true,
  perOpeningValue: true,
  saleValueBasis: true,
  salaryMin: true,
  salaryMax: true,
  band: { select: { value: true } },
  client: { select: { id: true, name: true, percentageValue: true } },
  clientSpoc: { select: { firstName: true, lastName: true, email: true } },
  serviceLine: { select: { id: true, name: true } },
  businessUnit: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export type ReqInfo = Prisma.RequirementGetPayload<{
  select: typeof REQ_INFO_SELECT;
}> & {
  sale: { value: number | null; basis: SaleValueBasis };
};

export async function loadRequirements(
  ids: Iterable<string>
): Promise<Map<string, ReqInfo>> {
  const list = [...new Set(ids)];
  if (!list.length) return new Map();
  const rows = await prisma.requirement.findMany({
    where: { id: { in: list } },
    select: REQ_INFO_SELECT,
  });
  return new Map(rows.map((r) => [r.id, { ...r, sale: computeSaleValue(r) }]));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

type Bucket = "placed" | "nearTerminal" | "offPipeline" | "inPipeline";

function bucketOf(stage: PipeRow["currentStage"] | null | undefined): Bucket {
  if (!stage) return "inPipeline";
  if (stage.isTerminal) return "placed";
  if (stage.isNearTerminal) return "nearTerminal";
  if (stage.pipeline === false) return "offPipeline";
  return "inPipeline";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  placed: "Placed",
  nearTerminal: "Pipeline",
  offPipeline: "Dropped",
  inPipeline: "Active",
};

const pipeMinutes = (p: PipeRow, now: number) => {
  const stageAge = Math.max(
    0,
    Math.floor(
      (now - new Date(p.stageUpdatedAt ?? p.createdAt).getTime()) / 60_000
    )
  );
  const hist = (p.stageHistory ?? []).reduce(
    (s, l) => s + (l.timeInPrevStageMins ?? 0),
    0
  );
  return { stageAge, total: hist + stageAge, hist };
};

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIQUE VALUE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

type Counts = { placed: number; near: number };

interface ValueResult {
  reqCount: number;
  saleValue: number;
  achievedValue: number;
  nearTerminalValue: number;
  omitted: number;
  achievedPct: number;
}

/** Per requirement: capped placed / near share of that requirement's value */
export function valueOf(
  reqIds: Iterable<string>,
  countsFor: (reqId: string) => Counts,
  reqs: Map<string, ReqInfo>
): ValueResult {
  let saleValue = 0;
  let achievedValue = 0;
  let nearTerminalValue = 0;
  let omitted = 0;
  let reqCount = 0;
  for (const id of new Set(reqIds)) {
    reqCount++;
    const r = reqs.get(id);
    const v = r?.sale.value ?? null;
    if (v == null || !r) {
      omitted++;
      continue;
    }
    saleValue += v;
    const openings = r.totalOpenings ?? 0;
    if (openings <= 0) continue;
    const c = countsFor(id);
    const placed = Math.min(c.placed, openings);
    const near = Math.min(c.near, openings - placed);
    achievedValue += (placed / openings) * v;
    nearTerminalValue += (near / openings) * v;
  }
  return {
    reqCount,
    saleValue,
    achievedValue,
    nearTerminalValue,
    omitted,
    achievedPct:
      saleValue > 0 ? Math.round((achievedValue / saleValue) * 1_000) / 10 : 0,
  };
}

interface ReqAgg {
  requirementId: string;
  sourced: number;
  submitted: number;
  offered: number;
  placed: number;
  nearTerminal: number;
  offPipeline: number;
  inPipeline: number;
  stageCounts: Record<string, number>;
}

interface PersonAgg {
  id: string;
  sourced: number;
  submitted: number;
  offered: number;
  placed: number;
  nearTerminal: number;
  offPipeline: number;
  inPipeline: number;
  submitMins: number[];
  stageCounts: Record<string, number>;
  byReq: Map<string, ReqAgg>;
  /** assigned requirements counted for this person (after window/MOJ rule) */
  assigned: Set<string>;
}

const emptyReqAgg = (requirementId: string): ReqAgg => ({
  requirementId,
  sourced: 0,
  submitted: 0,
  offered: 0,
  placed: 0,
  nearTerminal: 0,
  offPipeline: 0,
  inPipeline: 0,
  stageCounts: {},
});

interface Dataset {
  people: Map<string, PersonAgg>;
  reqs: Map<string, ReqInfo>;
  pipes: PipeRow[];
}

/**
 * Builds per-person aggregates.
 * Assigned requirements count toward a person's sale value:
 *   - no date window and no MOJ → every requirement assigned to them
 *   - otherwise → only those where they have candidates in the result,
 *     or that were assigned to them inside the window
 */
async function buildDataset(
  ctx: RecruiterContext,
  pipes: PipeRow[]
): Promise<Dataset> {
  const assignments = await loadAssignments(ctx);
  const reqs = await loadRequirements([
    ...pipes.map((p) => p.requirementId),
    ...assignments.map((a) => a.requirementId),
  ]);

  const people = new Map<string, PersonAgg>();
  const get = (id: string) => {
    if (!people.has(id))
      people.set(id, {
        id,
        sourced: 0,
        submitted: 0,
        offered: 0,
        placed: 0,
        nearTerminal: 0,
        offPipeline: 0,
        inPipeline: 0,
        submitMins: [],
        stageCounts: {},
        byReq: new Map(),
        assigned: new Set(),
      });
    return people.get(id)!;
  };

  const now = Date.now();
  for (const p of pipes) {
    const a = get(p.recruiterId);
    const bucket = bucketOf(p.currentStage);
    a.sourced++;
    a[bucket]++;
    a.stageCounts[p.currentStageId] =
      (a.stageCounts[p.currentStageId] ?? 0) + 1;
    if (p.submittedAt) {
      a.submitted++;
      a.submitMins.push(pipeMinutes(p, now).hist);
    }
    if (p.offerStatus) a.offered++;

    if (!a.byReq.has(p.requirementId))
      a.byReq.set(p.requirementId, emptyReqAgg(p.requirementId));
    const r = a.byReq.get(p.requirementId)!;
    r.sourced++;
    r[bucket]++;
    r.stageCounts[p.currentStageId] =
      (r.stageCounts[p.currentStageId] ?? 0) + 1;
    if (p.submittedAt) r.submitted++;
    if (p.offerStatus) r.offered++;
  }

  const narrowing = !!ctx.window || !!ctx.moj;
  for (const asg of assignments) {
    const a = people.get(asg.assignedToId);
    const hasWork = !!a?.byReq.has(asg.requirementId);
    if (narrowing && !hasWork && !inWindow(asg.assignedAt, ctx.window))
      continue;
    get(asg.assignedToId).assigned.add(asg.requirementId);
  }

  return { people, reqs, pipes };
}

/** Value for a set of people as ONE unit (unique requirements, combined counts) */
function groupValue(ids: Iterable<string>, ds: Dataset) {
  const members = [...ids]
    .map((id) => ds.people.get(id))
    .filter((x): x is PersonAgg => !!x);
  const reqSet = new Set<string>();
  const counts = new Map<string, Counts>();
  let placedTotal = 0;
  let nearTotal = 0;
  let sourced = 0;
  let unassignedPlaced = 0;

  for (const m of members) m.assigned.forEach((r) => reqSet.add(r));
  for (const m of members) {
    sourced += m.sourced;
    for (const r of m.byReq.values()) {
      placedTotal += r.placed;
      nearTotal += r.nearTerminal;
      if (!reqSet.has(r.requirementId)) {
        unassignedPlaced += r.placed;
        continue;
      }
      const c = counts.get(r.requirementId) ?? { placed: 0, near: 0 };
      c.placed += r.placed;
      c.near += r.nearTerminal;
      counts.set(r.requirementId, c);
    }
  }
  const v = valueOf(
    reqSet,
    (id) => counts.get(id) ?? { placed: 0, near: 0 },
    ds.reqs
  );
  return {
    ...v,
    reqSet,
    members: members.length,
    sourced,
    placed: placedTotal,
    nearTerminal: nearTotal,
    unassignedPlaced,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROWS
// ─────────────────────────────────────────────────────────────────────────────

const rate = (a: number, b: number) =>
  b > 0 ? +((a / b) * 100).toFixed(1) : 0;

function buildPersonRow(id: string, ctx: RecruiterContext, ds: Dataset) {
  const a = ds.people.get(id)!;
  const u = ctx.graph.byId.get(id);
  const own = groupValue([id], ds);

  // Team rollup — this person + everyone under them who is in the result
  const below = [...descendantsOf(id, ctx.graph)].filter((d) =>
    ds.people.has(d)
  );
  const team = below.length
    ? (() => {
        const t = groupValue([id, ...below], ds);
        return {
          members: t.members,
          assignedReqCount: t.reqCount,
          saleValue: t.saleValue,
          achievedValue: t.achievedValue,
          nearTerminalValue: t.nearTerminalValue,
          achievedPct: t.achievedPct,
          sourced: t.sourced,
          placed: t.placed,
          nearTerminal: t.nearTerminal,
        };
      })()
    : null;

  const reqIds = new Set([...a.byReq.keys(), ...a.assigned]);
  const requirementBreakdown = [...reqIds]
    .map((rid) => {
      const r = a.byReq.get(rid) ?? emptyReqAgg(rid);
      const info = ds.reqs.get(rid);
      const isAssigned = a.assigned.has(rid);
      const v = isAssigned
        ? valueOf(
            [rid],
            () => ({ placed: r.placed, near: r.nearTerminal }),
            ds.reqs
          )
        : null;
      return {
        ...r,
        reqCode: info?.reqCode ?? "",
        title: info?.title ?? "",
        status: info?.status ?? "",
        totalOpenings: info?.totalOpenings ?? 0,
        client: info?.client
          ? { id: info.client.id, name: info.client.name }
          : null,
        serviceLine: info?.serviceLine ?? null,
        businessUnit: info?.businessUnit ?? null,
        isAssigned,
        saleValue: isAssigned ? info?.sale.value ?? null : null,
        achievedValue: v?.achievedValue ?? null,
        nearTerminalValue: v?.nearTerminalValue ?? null,
      };
    })
    .sort(
      (x, y) =>
        Number(y.isAssigned) - Number(x.isAssigned) || y.sourced - x.sourced
    );

  return {
    id,
    name: personName(u) || "Unknown user",
    email: u?.email ?? "",
    role: u?.role?.name ?? null,
    department: u?.department ?? null,
    managerName: managerName(u, ctx.graph),
    depth: ctx.depth.get(id) ?? null,
    isActive: u?.isActive ?? false,

    sourced: a.sourced,
    submitted: a.submitted,
    offered: a.offered,
    placed: a.placed,
    nearTerminal: a.nearTerminal,
    offPipeline: a.offPipeline,
    inPipeline: a.inPipeline,
    submissionRate: rate(a.submitted, a.sourced),
    offerRate: rate(a.offered, a.submitted),
    placementRate: rate(a.placed, a.sourced),
    avgTimeToSubmitDays: a.submitMins.length
      ? +(
          a.submitMins.reduce((s, n) => s + n, 0) /
          a.submitMins.length /
          1440
        ).toFixed(1)
      : null,
    stageCounts: a.stageCounts,

    // Unique-requirement value (own)
    assignedReqCount: own.reqCount,
    saleValue: own.saleValue,
    achievedValue: own.achievedValue,
    nearTerminalValue: own.nearTerminalValue,
    achievedPct: own.achievedPct,
    unassignedPlaced: own.unassignedPlaced,

    // Team rollup (only for people with someone under them in the result)
    team,

    requirementBreakdown,
  };
}

type PersonRow = ReturnType<typeof buildPersonRow>;

/** Hierarchy first (you → direct reports → theirs), then placed, then sourced */
const byHierarchy = (a: PersonRow, b: PersonRow) =>
  (a.depth ?? 99) - (b.depth ?? 99) ||
  b.placed - a.placed ||
  b.sourced - a.sourced ||
  a.name.localeCompare(b.name);

/** Service line for grouping: user's own, else the line most of their reqs sit on */
function lineOf(id: string, ctx: RecruiterContext, ds: Dataset) {
  const own = ctx.graph.byId.get(id)?.serviceline;
  if (own) return own;
  const tally = new Map<string, { id: string; name: string; n: number }>();
  for (const r of ds.people.get(id)?.byReq.values() ?? []) {
    const sl = ds.reqs.get(r.requirementId)?.serviceLine;
    if (!sl) continue;
    const t = tally.get(sl.id) ?? { ...sl, n: 0 };
    t.n += r.sourced;
    tally.set(sl.id, t);
  }
  const best = [...tally.values()].sort((x, y) => y.n - x.n)[0];
  return best ? { id: best.id, name: best.name } : null;
}

function summaryOf(ds: Dataset) {
  const all = groupValue(ds.people.keys(), ds);
  const byBasis = emptyByBasis();
  for (const rid of all.reqSet) {
    const s = ds.reqs.get(rid)?.sale;
    if (!s) continue;
    byBasis[s.basis].count++;
    if (s.value != null) byBasis[s.basis].total += s.value;
  }
  let terminalCandidates = 0;
  let nearTerminalCandidates = 0;
  const sourcedCandidates = ds.pipes.length;
  for (const p of ds.pipes) {
    const b = bucketOf(p.currentStage);
    if (b === "placed") terminalCandidates++;
    else if (b === "nearTerminal") nearTerminalCandidates++;
  }
  return {
    summary: {
      totalSaleValue: all.saleValue,
      totalAchievedValue: all.achievedValue,
      totalNearTerminalValue: all.nearTerminalValue,
      includedCount: all.reqCount - all.omitted,
      omittedCount: all.omitted,
      byBasis,
    },
    terminalCandidates,
    nearTerminalCandidates,
    sourcedCandidates,
    requirementCount: all.reqCount,
    unassignedPlaced: all.unassignedPlaced,
    achievedPct: all.achievedPct,
  };
}

const fail = (res: Response, err: unknown, where: string, message: string) => {
  if (err instanceof ScopeError)
    return res.status(403).json({ success: false, message: err.message });
  console.error(`${where}:`, err);
  return res.status(500).json({ success: false, message });
};

const filtersEcho = (q: Q) => ({
  mojMonths: toArr(q.mojMonth),
  mojYear: str(q.mojYear) ?? null,
  createdById: toArr(q.createdById),
  userIds: toArr(q.userIds),
  departmentId: toArr(q.departmentId),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const standardOnly = str(q.standardOnly) === "true";
    const ctx = await buildContext(req, q, {
      recruiterId: str(q.recruiterId) ?? null,
    });

    const [pipes, stages] = await Promise.all([
      loadPipelines(ctx),
      fetchScopedStages(toArr(q.serviceLineId)),
    ]);
    const ds = await buildDataset(ctx, pipes);

    const rows = [...ds.people.keys()]
      .filter((id) => {
        const a = ds.people.get(id)!;
        return a.sourced > 0 || a.assigned.size > 0;
      })
      .map((id) => ({
        row: buildPersonRow(id, ctx, ds),
        line: lineOf(id, ctx, ds),
      }));

    const byLine = new Map<
      string,
      { line: { id: string; name: string } | null; rows: PersonRow[] }
    >();
    for (const { row, line } of rows) {
      const key = line?.id ?? "__none__";
      if (!byLine.has(key)) byLine.set(key, { line, rows: [] });
      byLine.get(key)!.rows.push(row);
    }

    const stagesForLine = (lineId: string | null) =>
      stages.filter(
        (s) => s.serviceLineId === null || s.serviceLineId === lineId
      );

    const groups = [...byLine.values()]
      .map(({ line, rows: data }) => ({
        serviceLine: line,
        stages: stageMetaOut(stagesForLine(line?.id ?? null), standardOnly),
        data: data.sort(byHierarchy),
        total: data.length,
      }))
      .sort((a, b) => b.total - a.total);

    return res.json({
      success: true,
      groups,
      meta: {
        window: windowLabel(q),
        standardOnly,
        multiLine: groups.length > 1,
        total: rows.length,
        teamTotals: summaryOf(ds),
        filters: filtersEcho(q),
      },
    });
  } catch (err) {
    return fail(
      res,
      err,
      "getRecruiterReport",
      "Failed to fetch recruiter report"
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/sale-summary — team totals, unique requirements
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterSaleSummary = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const ctx = await buildContext(req, q, {
      recruiterId: str(q.recruiterId) ?? null,
    });
    const ds = await buildDataset(ctx, await loadPipelines(ctx));
    const totals = summaryOf(ds);

    const byRecruiter: Record<
      string,
      {
        nearTerminal: number;
        terminal: number;
        nearTerminalValue: number;
        achievedValue: number;
      }
    > = {};
    for (const id of ds.people.keys()) {
      const a = ds.people.get(id)!;
      const v = groupValue([id], ds);
      byRecruiter[id] = {
        nearTerminal: a.nearTerminal,
        terminal: a.placed,
        nearTerminalValue: v.nearTerminalValue,
        achievedValue: v.achievedValue,
      };
    }

    return res.json({
      success: true,
      data: { ...totals, byRecruiter },
      meta: { window: windowLabel(q), filters: filtersEcho(q) },
    });
  } catch (err) {
    return fail(
      res,
      err,
      "getRecruiterSaleSummary",
      "Failed to fetch recruiter sale summary"
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/stats — same shape as before, same scope as the table
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterStats = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const standardOnly = str(q.standardOnly) === "true";
    const ctx = await buildContext(req, q);
    const [pipes, stages] = await Promise.all([
      loadPipelines(ctx),
      fetchScopedStages(toArr(q.serviceLineId)),
    ]);
    const reqs = await loadRequirements(pipes.map((p) => p.requirementId));

    const totals = {
      recruiters: 0,
      sourced: 0,
      inPipeline: 0,
      nearClose: 0,
      placed: 0,
      offPipeline: 0,
      sourcedOnly: 0,
    };
    const recMap = new Map<string, any>();
    const slMap = new Map<string, any>();

    for (const p of pipes) {
      const b = bucketOf(p.currentStage);
      const key = b === "nearTerminal" ? "nearClose" : b;
      const sourcedOnly = b === "inPipeline" && !!p.currentStage?.isSourced;
      totals.sourced++;
      if (sourcedOnly) totals.sourcedOnly++;
      else (totals as any)[key]++;

      const u = ctx.graph.byId.get(p.recruiterId);
      if (!recMap.has(p.recruiterId))
        recMap.set(p.recruiterId, {
          id: p.recruiterId,
          name: personName(u),
          email: u?.email ?? "",
          serviceLineId: u?.servicelineId ?? null,
          serviceLine: u?.serviceline ?? null,
          depth: ctx.depth.get(p.recruiterId) ?? null,
          sourced: 0,
          placed: 0,
          nearClose: 0,
          offPipeline: 0,
          sourcedOnly: 0,
          inPipeline: 0,
          total: 0,
          stageCounts: {} as Record<string, number>,
        });
      const r = recMap.get(p.recruiterId);
      r.sourced++;
      r.total++;
      if (sourcedOnly) r.sourcedOnly++;
      else r[key]++;
      r.stageCounts[p.currentStageId] =
        (r.stageCounts[p.currentStageId] ?? 0) + 1;

      const sl = reqs.get(p.requirementId)?.serviceLine ?? null;
      const slKey = sl?.id ?? "__none__";
      if (!slMap.has(slKey))
        slMap.set(slKey, {
          id: sl?.id ?? null,
          name: sl?.name ?? "Unassigned",
          sourced: 0,
          placed: 0,
          nearClose: 0,
          offPipeline: 0,
          sourcedOnly: 0,
          inPipeline: 0,
        });
      const s = slMap.get(slKey);
      s.sourced++;
      if (sourcedOnly) s.sourcedOnly++;
      else s[key]++;
    }
    totals.recruiters = recMap.size;

    const byRecruiter = [...recMap.values()]
      .map((r) => ({
        ...r,
        placementRate: rate(r.placed, r.sourced),
        conversionRate: rate(r.placed + r.nearClose, r.sourced),
      }))
      .sort(
        (a, b) => (a.depth ?? 99) - (b.depth ?? 99) || b.sourced - a.sourced
      );

    return res.json({
      success: true,
      data: {
        totals,
        byRecruiter,
        byServiceLine: [...slMap.values()].sort(
          (a, b) => b.sourced - a.sourced
        ),
        stages: standardOnly ? stages.filter((s) => s.isStandard) : stages,
      },
      meta: { window: windowLabel(q), filters: filtersEcho(q) },
    });
  } catch (err) {
    return fail(
      res,
      err,
      "getRecruiterStats",
      "Failed to fetch recruiter stats"
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/drill
// ─────────────────────────────────────────────────────────────────────────────

const DRILL_TYPE_WHERE: Record<
  string,
  Prisma.RequirementCandidatePipelineWhereInput
> = {
  placed: { currentStage: { isTerminal: true } },
  near_terminal: { currentStage: { isNearTerminal: true, isTerminal: false } },
  active_pipeline: {
    currentStage: {
      pipeline: true,
      isTerminal: false,
      isNearTerminal: false,
      isSourced: false,
    },
  },
  sourced: { currentStage: { isSourced: true } },
  dropped: {
    // stage flags only — dropped = off-pipeline stage
    currentStage: { pipeline: false, isTerminal: false },
  },
};

const DRILL_CAP = 1000;

function drillRow(
  p: PipeRow,
  reqs: Map<string, ReqInfo>,
  ctx: RecruiterContext,
  now: number
) {
  const rq = reqs.get(p.requirementId);
  const u = ctx.graph.byId.get(p.recruiterId);
  const mins = pipeMinutes(p, now);
  // Real move INTO the current stage (skip same-stage logs: transfers, notes)
  const move = (p.stageHistory as any[]).find(
    (l) => l.toStageId === p.currentStageId && l.fromStageId !== l.toStageId
  );
  return {
    pipelineId: p.id,
    addedOn: p.createdAt,
    pipelineDays: Math.floor(mins.total / 1440),
    stageAging: formatAging(mins.stageAge),
    stageAgeMins: mins.stageAge,

    stageId: p.currentStageId,
    stageLabel: p.currentStage?.label ?? "—",
    stageCode: p.currentStage?.code ?? "",
    stageOrder: p.currentStage?.order ?? 0,
    isTerminal: p.currentStage?.isTerminal ?? false,
    isNearTerminal: p.currentStage?.isNearTerminal ?? false,
    isSourced: p.currentStage?.isSourced ?? false,

    isDropped:
      !p.currentStage?.isTerminal && p.currentStage?.pipeline === false,
    isOnHold: p.isOnHold,

    // When / who moved the candidate into the current stage (placed by, etc.)
    stageReachedAt: move?.createdAt ?? p.stageUpdatedAt ?? null,
    stageMovedBy: move?.changedBy ? personName(move.changedBy) : null,

    submittedAt: p.submittedAt ?? null,
    offerStatus: p.offerStatus ?? null,
    offeredCtc: p.offeredCtc ?? null,
    currentCtc: p.currentCtc ?? null,
    expectedCtc: p.expectedCtc ?? null,
    negotiatedCtc: p.negotiatedCtc ?? null,

    // Joining — LWD or dynamic notice period (never both)
    noticeDays: p.joining.noticeDays,
    lastWorkingDate: p.lastWorkingDate ?? null,
    joiningDate: p.joining.date,
    joiningSource: p.joining.source,
    joiningSourceLabel: p.joining.source
      ? JOINING_SOURCE_LABELS[p.joining.source]
      : null,
    monthOfJoining: p.joining.mojLabel,
    mojKey: p.joining.mojKey,
    daysToJoin: p.joining.daysToJoin,

    candidateName: p.snapshot?.fullName ?? "—",
    candidateEmail: p.snapshot?.email ?? "",
    candidatePhone: p.snapshot?.phone ?? "",
    currentTitle: p.snapshot?.currentTitle ?? "",
    currentCompany: p.snapshot?.currentCompany ?? "",
    expYears: p.snapshot?.totalExpYears ?? null,
    topSkills: (p.snapshot?.topSkills ?? []).join(", "),
    resumeUrl: p.snapshot?.resumeUrl ?? null,

    recruiterId: p.recruiterId,
    recruiterName: personName(u),
    recruiterEmail: u?.email ?? "",

    requirementId: p.requirementId,
    reqCode: rq?.reqCode ?? "",
    reqTitle: rq?.title ?? "",
    reqStatus: rq?.status ?? "",
    totalOpenings: rq?.totalOpenings ?? 0,
    salaryMin: rq?.salaryMin ?? null,
    salaryMax: rq?.salaryMax ?? null,
    clientName: rq?.client?.name ?? "",
    clientSpoc: personName(rq?.clientSpoc),
    serviceLineName: rq?.serviceLine?.name ?? "",
    businessUnitName: rq?.businessUnit?.name ?? "",
    createdById: rq?.createdBy?.id ?? null,
    createdByName: rq?.createdBy ? personName(rq.createdBy) : null,
  };
}

export const getRecruiterDrill = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const rid = str(q.recruiterId);
    const ctx = await buildContext(req, q, {
      recruiterId: rid && rid !== "__all__" ? rid : null,
    });

    const type = str(q.type) ?? "recruiter";
    const stageId = str(q.stageId);
    const extra: Prisma.RequirementCandidatePipelineWhereInput | undefined =
      type === "stage" && stageId
        ? { currentStageId: stageId }
        : DRILL_TYPE_WHERE[type];

    const pipes = await loadPipelines(ctx, { full: true, extra });
    const reqs = await loadRequirements(pipes.map((p) => p.requirementId));
    const now = Date.now();
    const rows = pipes
      .slice(0, DRILL_CAP)
      .map((p) => drillRow(p, reqs, ctx, now));

    const stats = {
      total: pipes.length,
      placed: pipes.filter((p) => p.currentStage?.isTerminal).length,
      nearTerminal: pipes.filter(
        (p) => p.currentStage?.isNearTerminal && !p.currentStage?.isTerminal
      ).length,
      active: pipes.filter(
        (p) => bucketOf(p.currentStage) === "inPipeline" && !p.isOnHold
      ).length,
      onHold: pipes.filter((p) => p.isOnHold).length,
      dropped: pipes.filter((p) => bucketOf(p.currentStage) === "offPipeline")
        .length,
      capped: pipes.length > DRILL_CAP,
    };

    return res.json({
      success: true,
      data: rows,
      meta: { stats, capped: stats.capped, filters: filtersEcho(q) },
    });
  } catch (err) {
    return fail(res, err, "getRecruiterDrill", "Failed to fetch drill data");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/drill/moj-options
// Months that candidates in scope are joining in — computed live (LWD / NP).
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterDrillMojOptions = async (
  req: Request,
  res: Response
) => {
  try {
    const q = req.query as Q;
    const rid = str(q.recruiterId);
    const ctx = await buildContext(req, q, {
      recruiterId: rid && rid !== "__all__" ? rid : null,
    });
    const pipes = await loadPipelines(ctx, { ignoreMoj: true });

    const months = new Map<
      string,
      { value: string; label: string; count: number }
    >();
    for (const p of pipes) {
      const { mojKey, mojLabel } = p.joining;
      if (!mojKey || !mojLabel) continue;
      const m = months.get(mojKey) ?? {
        value: mojKey,
        label: mojLabel,
        count: 0,
      };
      m.count++;
      months.set(mojKey, m);
    }

    return res.json({
      success: true,
      data: [...months.values()].sort((a, b) => a.value.localeCompare(b.value)),
    });
  } catch (err) {
    return fail(
      res,
      err,
      "getRecruiterDrillMojOptions",
      "Failed to fetch MOJ options"
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/export
// Sheet 1 Recruiters   — hierarchy order, unique values, team rollups, stages
// Sheet 2 By Requirement — person × requirement, assigned flag + value
// Sheet 3 Candidates   — every candidate with LWD / NP / joining / MOJ
// ─────────────────────────────────────────────────────────────────────────────

const mkFill = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});
const XL = {
  header: mkFill("FF1E3A5F"),
  totals: mkFill("FFF0F4FF"),
  green: mkFill("FFE2EFDA"),
  amber: mkFill("FFFFF3CD"),
  grey: "FF7A869A",
  white: "FFFFFFFF",
  border: "FF4F46E5",
  money: "#,##0.00",
  date: "dd-mmm-yyyy",
  dateTime: "dd-mmm-yyyy hh:mm",
};

function styleHeader(row: ExcelJS.Row, cols: number) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = XL.header;
    cell.font = { color: { argb: XL.white }, bold: true, size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
  }
  row.height = 28;
}

function styleTotals(row: ExcelJS.Row, cols: number) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = XL.totals;
    cell.font = { bold: true };
    cell.border = { top: { style: "medium", color: { argb: XL.border } } };
  }
  row.height = 22;
}

/** Candidate columns — opt-out via ?hiddenCandidateCols=key1,key2 */
const CANDIDATE_COLS = [
  { key: "reqCode", header: "Req Code", width: 14 },
  { key: "reqTitle", header: "Requirement", width: 34 },
  { key: "client", header: "Client", width: 22 },
  { key: "spoc", header: "Client SPOC", width: 22 },
  { key: "serviceLine", header: "Service Line", width: 18 },
  { key: "bu", header: "Business Unit", width: 18 },
  { key: "name", header: "Candidate", width: 26 },
  { key: "email", header: "Email", width: 28 },
  { key: "phone", header: "Phone", width: 16 },
  { key: "title", header: "Current Title", width: 24 },
  { key: "company", header: "Current Company", width: 22 },
  { key: "exp", header: "Exp (yrs)", width: 10 },
  { key: "skills", header: "Top Skills", width: 34 },
  { key: "recruiter", header: "Recruiter", width: 22 },
  { key: "stage", header: "Current Stage", width: 22 },
  { key: "bucket", header: "Status", width: 14 },
  { key: "addedOn", header: "Added On", width: 14 },
  { key: "pipelineDays", header: "Days in Pipeline", width: 14 },
  { key: "aging", header: "Stage Aging", width: 12 },
  { key: "submittedAt", header: "Submitted At", width: 18 },
  { key: "offerStatus", header: "Offer Status", width: 14 },
  { key: "currentCtc", header: "Current CTC", width: 14 },
  { key: "expectedCtc", header: "Expected CTC", width: 14 },
  { key: "negotiatedCtc", header: "Negotiated CTC", width: 14 },
  { key: "offeredCtc", header: "Offered CTC", width: 14 },
  { key: "currency", header: "Currency", width: 10 },
  { key: "noticeDays", header: "Notice (days)", width: 12 },
  { key: "lwd", header: "Last Working Day", width: 16 },
  { key: "joiningDate", header: "Joining Date", width: 16 },
  { key: "joiningSource", header: "Joining From", width: 18 },
  { key: "monthOfJoining", header: "Month of Joining", width: 16 },
  { key: "daysToJoin", header: "Days to Join", width: 12 },
  { key: "onHold", header: "On Hold?", width: 10 },
] as const;

type CandidateColKey = (typeof CANDIDATE_COLS)[number]["key"];

export const exportRecruiterReport = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const standardOnly = str(q.standardOnly) === "true";
    const selectedIds = toArr(q.ids);
    const ctx = await buildContext(req, q, {
      recruiterId: str(q.recruiterId) ?? null,
      selectedIds,
    });

    const [pipes, stages] = await Promise.all([
      loadPipelines(ctx, { full: true }),
      fetchScopedStages(toArr(q.serviceLineId)),
    ]);
    const ds = await buildDataset(ctx, pipes);

    const hiddenStageIds = new Set(toArr(q.hiddenStageIds));
    const visibleStages = (
      standardOnly ? stages.filter((s) => s.isStandard) : stages
    ).filter((s) => !hiddenStageIds.has(s.id));

    const rows = [...ds.people.keys()]
      .filter(
        (id) =>
          ds.people.get(id)!.sourced > 0 || ds.people.get(id)!.assigned.size > 0
      )
      .map((id) => buildPersonRow(id, ctx, ds))
      .sort(byHierarchy);

    const wb = new ExcelJS.Workbook();
    wb.creator = "TalentOS";
    wb.created = new Date();

    // ── Sheet 1: Recruiters ─────────────────────────────────────────────
    const s1 = wb.addWorksheet("Recruiters", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
    });
    const grandStage: Record<string, number> = {};
    for (const r of rows)
      for (const s of visibleStages)
        grandStage[s.id] = (grandStage[s.id] ?? 0) + (r.stageCounts[s.id] ?? 0);

    const s1Cols = [
      { header: "Name", key: "name", width: 24 },
      { header: "Email", key: "email", width: 28 },
      { header: "Role", key: "role", width: 18 },
      { header: "Reports To", key: "manager", width: 22 },
      { header: "Level", key: "depth", width: 8 },
      { header: "Assigned Reqs", key: "assignedReqCount", width: 14 },
      { header: "Funnel Value", key: "saleValue", width: 16 },
      { header: "Achieved Value", key: "achievedValue", width: 16 },
      { header: "Achieved %", key: "achievedPct", width: 12 },
      { header: "Pipeline Value", key: "nearTerminalValue", width: 16 },
      { header: "Sourced", key: "sourced", width: 10 },
      ...visibleStages.map((s) => ({
        header: `${s.label} (${grandStage[s.id] ?? 0})`,
        key: `stage_${s.id}`,
        width: Math.max(s.label.length + 6, 12),
      })),
      { header: "Placed", key: "placed", width: 10 },
      { header: "Pipeline", key: "nearTerminal", width: 12 },
      { header: "Active", key: "inPipeline", width: 12 },
      { header: "Dropped", key: "offPipeline", width: 12 },
      {
        header: "Placed on Unassigned Reqs",
        key: "unassignedPlaced",
        width: 16,
      },
      { header: "Avg Days to Submit", key: "avgDays", width: 14 },
      { header: "Team Size", key: "teamMembers", width: 10 },
      { header: "Team Reqs", key: "teamReqs", width: 12 },
      { header: "Team Funnel Value", key: "teamSale", width: 16 },
      { header: "Team Achieved", key: "teamAchieved", width: 16 },
      { header: "Team Achieved %", key: "teamPct", width: 14 },
    ];
    s1.columns = s1Cols;
    styleHeader(s1.getRow(1), s1Cols.length);
    const s1Money = [
      "saleValue",
      "achievedValue",
      "nearTerminalValue",
      "teamSale",
      "teamAchieved",
    ];

    for (const r of rows) {
      const stageVals: Record<string, number> = {};
      for (const s of visibleStages)
        stageVals[`stage_${s.id}`] = r.stageCounts[s.id] ?? 0;
      const row = s1.addRow({
        name: r.name,
        email: r.email,
        role: r.role ?? "",
        manager: r.managerName ?? "",
        depth: r.depth ?? "",
        assignedReqCount: r.assignedReqCount,
        saleValue: r.saleValue,
        achievedValue: r.achievedValue,
        achievedPct: r.achievedPct,
        nearTerminalValue: r.nearTerminalValue,
        sourced: r.sourced,
        ...stageVals,
        placed: r.placed,
        nearTerminal: r.nearTerminal,
        inPipeline: r.inPipeline,
        offPipeline: r.offPipeline,
        unassignedPlaced: r.unassignedPlaced,
        avgDays: r.avgTimeToSubmitDays ?? "",
        teamMembers: r.team?.members ?? "",
        teamReqs: r.team?.assignedReqCount ?? "",
        teamSale: r.team?.saleValue ?? "",
        teamAchieved: r.team?.achievedValue ?? "",
        teamPct: r.team?.achievedPct ?? "",
      });
      for (const k of s1Money) row.getCell(k).numFmt = XL.money;
      if (r.placed > 0) row.getCell("placed").fill = XL.green;
      if (r.nearTerminal > 0) row.getCell("nearTerminal").fill = XL.amber;
    }

    const t = summaryOf(ds);
    const grandVals: Record<string, number> = {};
    for (const s of visibleStages)
      grandVals[`stage_${s.id}`] = grandStage[s.id] ?? 0;
    const totalsRow = s1.addRow({
      name: "TEAM TOTAL",
      email: "Each requirement counted once",
      assignedReqCount: t.requirementCount,
      saleValue: t.summary.totalSaleValue,
      achievedValue: t.summary.totalAchievedValue,
      achievedPct: t.achievedPct,
      nearTerminalValue: t.summary.totalNearTerminalValue,
      sourced: rows.reduce((s, r) => s + r.sourced, 0),
      ...grandVals,
      placed: t.terminalCandidates,
      nearTerminal: t.nearTerminalCandidates,
      inPipeline: rows.reduce((s, r) => s + r.inPipeline, 0),
      offPipeline: rows.reduce((s, r) => s + r.offPipeline, 0),
      unassignedPlaced: t.unassignedPlaced,
    });
    styleTotals(totalsRow, s1Cols.length);
    for (const k of s1Money) totalsRow.getCell(k).numFmt = XL.money;
    s1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s1Cols.length },
    };

    // ── Sheet 2: By Requirement ─────────────────────────────────────────
    const s2 = wb.addWorksheet("By Requirement", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const s2Cols = [
      { header: "Name", key: "name", width: 24 },
      { header: "Req Code", key: "reqCode", width: 14 },
      { header: "Requirement", key: "title", width: 34 },
      { header: "Client", key: "client", width: 22 },
      { header: "Status", key: "status", width: 14 },
      { header: "Assigned?", key: "assigned", width: 10 },
      { header: "Openings", key: "openings", width: 10 },
      { header: "Funnel Value", key: "saleValue", width: 16 },
      { header: "Sourced", key: "sourced", width: 10 },
      { header: "Submitted", key: "submitted", width: 10 },
      { header: "Pipeline", key: "nearTerminal", width: 12 },
      { header: "Placed", key: "placed", width: 10 },
      { header: "Achieved Value", key: "achievedValue", width: 16 },
      { header: "Pipeline Value", key: "nearTerminalValue", width: 16 },
    ];
    s2.columns = s2Cols;
    styleHeader(s2.getRow(1), s2Cols.length);
    for (const r of rows)
      for (const b of r.requirementBreakdown) {
        const row = s2.addRow({
          name: r.name,
          reqCode: b.reqCode,
          title: b.title,
          client: b.client?.name ?? "",
          status: b.status,
          assigned: b.isAssigned ? "Yes" : "No",
          openings: b.totalOpenings,
          saleValue: b.saleValue ?? "",
          sourced: b.sourced,
          submitted: b.submitted,
          nearTerminal: b.nearTerminal,
          placed: b.placed,
          achievedValue: b.achievedValue ?? "",
          nearTerminalValue: b.nearTerminalValue ?? "",
        });
        for (const k of ["saleValue", "achievedValue", "nearTerminalValue"])
          row.getCell(k).numFmt = XL.money;
        if (!b.isAssigned)
          row.eachCell((c) => (c.font = { color: { argb: XL.grey } }));
      }
    s2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s2Cols.length },
    };

    // ── Sheet 3: Candidates ─────────────────────────────────────────────
    const hidden = new Set(toArr(q.hiddenCandidateCols) as CandidateColKey[]);
    const cols = CANDIDATE_COLS.filter((c) => !hidden.has(c.key));
    const has = (k: CandidateColKey) => !hidden.has(k);
    const s3 = wb.addWorksheet("Candidates", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    s3.columns = cols.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));
    styleHeader(s3.getRow(1), cols.length);

    const stageFilter = new Set(toArr(q.stageIds));
    const now = Date.now();
    let candidateRows = 0;

    for (const p of pipes) {
      if (stageFilter.size && !stageFilter.has(p.currentStageId)) continue;
      if (!stageFilter.size && hiddenStageIds.has(p.currentStageId)) continue;
      const rq = ds.reqs.get(p.requirementId);
      const mins = pipeMinutes(p, now);
      const bucket = bucketOf(p.currentStage);
      const j = p.joining;

      const data: Record<string, unknown> = {
        reqCode: rq?.reqCode ?? "",
        reqTitle: rq?.title ?? "",
        client: rq?.client?.name ?? "",
        spoc: personName(rq?.clientSpoc),
        serviceLine: rq?.serviceLine?.name ?? "",
        bu: rq?.businessUnit?.name ?? "",
        name: p.snapshot?.fullName ?? "",
        email: p.snapshot?.email ?? "",
        phone: p.snapshot?.phone ?? "",
        title: p.snapshot?.currentTitle ?? "",
        company: p.snapshot?.currentCompany ?? "",
        exp: p.snapshot?.totalExpYears ?? "",
        skills: (p.snapshot?.topSkills ?? []).join(", "),
        recruiter: personName(ctx.graph.byId.get(p.recruiterId)),
        stage: p.currentStage?.label ?? "",
        bucket: BUCKET_LABELS[bucket],
        addedOn: new Date(p.createdAt),
        pipelineDays: Math.floor(mins.total / 1440),
        aging: formatAging(mins.stageAge),
        submittedAt: p.submittedAt ? new Date(p.submittedAt) : "",
        offerStatus: p.offerStatus ?? "",
        currentCtc: p.currentCtc ?? "",
        expectedCtc: p.expectedCtc ?? "",
        negotiatedCtc: p.negotiatedCtc ?? "",
        offeredCtc: p.offeredCtc ?? "",
        currency: p.salaryCurrency ?? "",
        noticeDays: j.noticeDays ?? "",
        lwd: p.lastWorkingDate ? new Date(p.lastWorkingDate) : "",
        joiningDate: j.date ?? "",
        joiningSource: j.source ? JOINING_SOURCE_LABELS[j.source] : "",
        monthOfJoining: j.mojLabel ?? "",
        daysToJoin: j.daysToJoin ?? "",
        onHold: p.isOnHold ? "Yes" : "No",
      };
      const row = s3.addRow(
        Object.fromEntries(cols.map((c) => [c.key, data[c.key]]))
      );
      candidateRows++;
      if (has("addedOn")) row.getCell("addedOn").numFmt = XL.date;
      if (has("submittedAt")) row.getCell("submittedAt").numFmt = XL.dateTime;
      if (has("lwd")) row.getCell("lwd").numFmt = XL.date;
      if (has("joiningDate")) row.getCell("joiningDate").numFmt = XL.date;
      if (bucket === "placed" && has("bucket"))
        row.getCell("bucket").fill = XL.green;
      if (bucket === "nearTerminal" && has("bucket"))
        row.getCell("bucket").fill = XL.amber;
      if (bucket === "offPipeline")
        row.eachCell((c) => (c.font = { color: { argb: XL.grey } }));
    }
    if (cols.length) {
      const tr = s3.addRow({
        [cols[0].key]: `TOTAL: ${candidateRows} candidates`,
      });
      styleTotals(tr, cols.length);
      s3.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: cols.length },
      };
    }

    // ── Stream ──────────────────────────────────────────────────────────
    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-report-${
        selectedIds.length ? "selected" : "all"
      }-${dateStr}.xlsx"`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (res.headersSent) return console.error("exportRecruiterReport:", err);
    return fail(
      res,
      err,
      "exportRecruiterReport",
      "Failed to export recruiter report"
    );
  }
};
