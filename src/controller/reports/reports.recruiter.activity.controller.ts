// File: reports.recruiter.activity.controller.ts
// Path: src/controller/reports/reports.recruiter.activity.controller.ts
//
// THE Recruiters tab — activity only. "What happened in the window."
//
//   GET /reports/recruiters/activity                 getRecruiterActivity
//   GET /reports/recruiters/activity/drill           getRecruiterActivityDrill
//   GET /reports/recruiters/activity/export/columns  getActivityExportColumns
//   GET /reports/recruiters/activity/export          exportRecruiterActivity
//
// RULES
//   Source      CandidatePipelineStageLog, REAL moves only (from ≠ to).
//               Transfers / notes logged as same → same are ignored.
//   Counting    UNIQUE pipeline rows. A candidate entering L1 twice in the window
//               (rollback) counts once. A candidate re-added to the same
//               requirement is a NEW pipeline row → counts separately.
//   Placed      Entered a terminal stage in the window AND is still placed now.
//               Entered but no longer placed → "reversed" (shown, never counted).
//   Owner       Activity belongs to the pipeline's recruiter (candidate owner).
//   Scope       Org tree (buildContext). Team / department pickers only narrow.
//
// MONEY (every recruiter row + team rollup + summary)
//   Funnel      Value of requirements ASSIGNED to the recruiter. With a window
//               or MOJ: only assigned requirements they worked on in the window
//               or that were assigned to them in the window.
//   Pipeline    Value share of candidates moved to near-close in the window.
//   Achieved    Value share of placements made in the window (still placed).
//   Both shares are capped at openings per requirement (placed first, then
//   pipeline fills the rest). Team / summary count each requirement once.
//   Placements on requirements not assigned to the person → unassignedPlaced.

import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  Q,
  str,
  toArr,
  personName,
  emptyByBasis,
} from "./reports.requirements.shared";
import { resolveJoining, JOINING_SOURCE_LABELS } from "./reports.joining";
import {
  buildContext,
  RecruiterContext,
  ScopeError,
  loadAssignments,
  loadRequirements,
  ReqInfo,
  valueOf,
  descendantsOf,
  managerName,
  inWindow,
  windowLabel,
} from "./reports.recruiters.controller";

// ─────────────────────────────────────────────────────────────────────────────
// BUCKETS — stage flags only
// ─────────────────────────────────────────────────────────────────────────────

type Bucket = "sourced" | "active" | "pipeline" | "placed" | "dropped";

const BUCKET_LABELS: Record<Bucket, string> = {
  sourced: "Added",
  active: "Active",
  pipeline: "Pipeline",
  placed: "Placed",
  dropped: "Dropped",
};

type StageFlags = {
  isTerminal: boolean;
  isNearTerminal: boolean;
  pipeline: boolean;
  isSourced: boolean;
};

const bucketOf = (s: StageFlags): Bucket =>
  s.isTerminal
    ? "placed"
    : s.isNearTerminal
    ? "pipeline"
    : !s.pipeline
    ? "dropped"
    : s.isSourced
    ? "sourced"
    : "active";

/** Same precedence as bucketOf, in SQL (ts = the stage moved INTO) */
const BUCKET_SQL = Prisma.sql`
  CASE
    WHEN ts."isTerminal"     THEN 'placed'
    WHEN ts."isNearTerminal" THEN 'pipeline'
    WHEN NOT ts."pipeline"   THEN 'dropped'
    WHEN ts."isSourced"      THEN 'sourced'
    ELSE 'active'
  END`;

// ─────────────────────────────────────────────────────────────────────────────
// SQL FILTER — window, scope, requirement filters, MOJ
// ─────────────────────────────────────────────────────────────────────────────

interface LogFilter {
  conds: Prisma.Sql[];
  empty: boolean; // scope resolved to nothing → no rows
}

async function buildLogFilter(ctx: RecruiterContext): Promise<LogFilter> {
  const conds: Prisma.Sql[] = [
    Prisma.sql`(l."fromStageId" IS NULL OR l."fromStageId" <> l."toStageId")`,
  ];
  if (ctx.window?.gte)
    conds.push(Prisma.sql`l."createdAt" >= ${ctx.window.gte}`);
  if (ctx.window?.lte)
    conds.push(Prisma.sql`l."createdAt" <= ${ctx.window.lte}`);

  if (ctx.peopleIds !== null) {
    if (!ctx.peopleIds.length) return { conds, empty: true };
    conds.push(Prisma.sql`p."recruiterId" = ANY(${ctx.peopleIds})`);
  }

  // Requirement filters (status, client, service line, created by, …) — resolved
  // by Prisma with the exact same where the rest of the report uses.
  const reqRows = await prisma.requirement.findMany({
    where: ctx.reqWhere,
    select: { id: true },
  });
  if (!reqRows.length) return { conds, empty: true };
  conds.push(Prisma.sql`p."requirementId" = ANY(${reqRows.map((r) => r.id)})`);

  // MOJ — only candidates joining in the picked month(s)
  if (ctx.moj) {
    const pipes = await prisma.requirementCandidatePipeline.findMany({
      where: {
        AND: [
          ctx.moj,
          ...(ctx.peopleIds !== null
            ? [{ recruiterId: { in: ctx.peopleIds } }]
            : []),
        ],
      },
      select: { id: true },
    });
    if (!pipes.length) return { conds, empty: true };
    conds.push(Prisma.sql`p."id" = ANY(${pipes.map((x) => x.id)})`);
  }

  return { conds, empty: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE — one query, three grouping levels
//   level 1 → (recruiter, requirement, stage)   stage columns
//   level 2 → (recruiter, requirement, bucket)  buckets + money
//   level 3 → (recruiter, requirement)          candidates touched + moves
// ─────────────────────────────────────────────────────────────────────────────

interface AggRow {
  rid: string;
  reqid: string;
  sid: string | null;
  bucket: Bucket | null;
  candidates: number;
  moves: number;
  stillPlaced: number;
  level: number;
}

async function fetchAggregate(f: LogFilter): Promise<AggRow[]> {
  if (f.empty) return [];
  const where = Prisma.join(f.conds, " AND ");
  return prisma.$queryRaw<AggRow[]>(Prisma.sql`
    WITH m AS (
      SELECT
        p."recruiterId"   AS rid,
        p."requirementId" AS reqid,
        l."toStageId"     AS sid,
        l."pipelineId"    AS pid,
        cs."isTerminal"   AS still_placed,
        ${BUCKET_SQL}     AS bucket
      FROM "CandidatePipelineStageLog" l
      JOIN "RequirementCandidatePipeline" p ON p."id" = l."pipelineId"
      JOIN "PipelineStage" ts ON ts."id" = l."toStageId"
      JOIN "PipelineStage" cs ON cs."id" = p."currentStageId"
      WHERE ${where}
    )
    SELECT
      rid, reqid, sid, bucket,
      COUNT(DISTINCT pid)::int                              AS "candidates",
      COUNT(*)::int                                         AS "moves",
      COUNT(DISTINCT pid) FILTER (WHERE still_placed)::int  AS "stillPlaced",
      GROUPING(sid, bucket)::int                            AS "level"
    FROM m
    GROUP BY GROUPING SETS ((rid, reqid, sid), (rid, reqid, bucket), (rid, reqid))
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASET — per person, per requirement
// ─────────────────────────────────────────────────────────────────────────────

interface ReqActivity {
  requirementId: string;
  candidates: number;
  moves: number;
  buckets: Record<Bucket, number>;
  reversed: number;
}

interface PersonActivity {
  id: string;
  candidates: number;
  moves: number;
  buckets: Record<Bucket, number>;
  reversed: number;
  stageCounts: Record<string, number>; // unique candidates (terminal = still placed)
  stageMoves: Record<string, number>;
  byReq: Map<string, ReqActivity>;
  assigned: Set<string>;
}

const emptyBuckets = (): Record<Bucket, number> => ({
  sourced: 0,
  active: 0,
  pipeline: 0,
  placed: 0,
  dropped: 0,
});

interface StageInfo extends StageFlags {
  id: string;
  code: string;
  label: string;
  order: number;
  isStandard: boolean;
  serviceLineId: string | null;
  serviceLine: { id: string; name: string } | null;
}

interface ActivityDataset {
  ctx: RecruiterContext;
  people: Map<string, PersonActivity>;
  reqs: Map<string, ReqInfo>;
  stages: Map<string, StageInfo>;
  filter: LogFilter;
}

async function buildActivityDataset(
  ctx: RecruiterContext
): Promise<ActivityDataset> {
  const filter = await buildLogFilter(ctx);
  const [agg, assignments] = await Promise.all([
    fetchAggregate(filter),
    loadAssignments(ctx),
  ]);

  const stageIds = [
    ...new Set(agg.map((a) => a.sid).filter((x): x is string => !!x)),
  ];
  const [stageRows, reqs] = await Promise.all([
    stageIds.length
      ? prisma.pipelineStage.findMany({
          where: { id: { in: stageIds } },
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
        })
      : Promise.resolve([]),
    loadRequirements([
      ...agg.map((a) => a.reqid),
      ...assignments.map((a) => a.requirementId),
    ]),
  ]);
  const stages = new Map<string, StageInfo>(stageRows.map((s) => [s.id, s]));

  const people = new Map<string, PersonActivity>();
  const person = (id: string) => {
    if (!people.has(id))
      people.set(id, {
        id,
        candidates: 0,
        moves: 0,
        buckets: emptyBuckets(),
        reversed: 0,
        stageCounts: {},
        stageMoves: {},
        byReq: new Map(),
        assigned: new Set(),
      });
    return people.get(id)!;
  };
  const reqOf = (p: PersonActivity, reqId: string) => {
    if (!p.byReq.has(reqId))
      p.byReq.set(reqId, {
        requirementId: reqId,
        candidates: 0,
        moves: 0,
        buckets: emptyBuckets(),
        reversed: 0,
      });
    return p.byReq.get(reqId)!;
  };

  for (const a of agg) {
    const p = person(a.rid);
    const r = reqOf(p, a.reqid);
    if (a.level === 1 && a.sid) {
      // stage column — terminal stages show only placements that still stand
      const st = stages.get(a.sid);
      const n = st?.isTerminal ? a.stillPlaced : a.candidates;
      p.stageCounts[a.sid] = (p.stageCounts[a.sid] ?? 0) + n;
      p.stageMoves[a.sid] = (p.stageMoves[a.sid] ?? 0) + a.moves;
    } else if (a.level === 2 && a.bucket) {
      if (a.bucket === "placed") {
        r.buckets.placed += a.stillPlaced;
        r.reversed += a.candidates - a.stillPlaced;
        p.buckets.placed += a.stillPlaced;
        p.reversed += a.candidates - a.stillPlaced;
      } else {
        r.buckets[a.bucket] += a.candidates;
        p.buckets[a.bucket] += a.candidates;
      }
    } else if (a.level === 3) {
      r.candidates += a.candidates;
      r.moves += a.moves;
      p.candidates += a.candidates;
      p.moves += a.moves;
    }
  }

  // Funnel — assigned requirements (narrowed when a window / MOJ is set)
  const narrowing = !!ctx.window || !!ctx.moj;
  for (const asg of assignments) {
    const hasWork = !!people
      .get(asg.assignedToId)
      ?.byReq.has(asg.requirementId);
    if (narrowing && !hasWork && !inWindow(asg.assignedAt, ctx.window))
      continue;
    person(asg.assignedToId).assigned.add(asg.requirementId);
  }

  return { ctx, people, reqs, stages, filter };
}

/** Money + counts for a set of people as ONE unit — each requirement once */
function groupMoney(ids: Iterable<string>, ds: ActivityDataset) {
  const members = [...ids]
    .map((id) => ds.people.get(id))
    .filter((x): x is PersonActivity => !!x);
  const reqSet = new Set<string>();
  for (const m of members) m.assigned.forEach((r) => reqSet.add(r));

  const counts = new Map<string, { placed: number; near: number }>();
  const totals = {
    candidates: 0,
    moves: 0,
    reversed: 0,
    buckets: emptyBuckets(),
  };
  let unassignedPlaced = 0;

  for (const m of members) {
    totals.candidates += m.candidates;
    totals.moves += m.moves;
    totals.reversed += m.reversed;
    for (const b of Object.keys(totals.buckets) as Bucket[])
      totals.buckets[b] += m.buckets[b];
    for (const r of m.byReq.values()) {
      if (!reqSet.has(r.requirementId)) {
        unassignedPlaced += r.buckets.placed;
        continue;
      }
      const c = counts.get(r.requirementId) ?? { placed: 0, near: 0 };
      c.placed += r.buckets.placed;
      c.near += r.buckets.pipeline;
      counts.set(r.requirementId, c);
    }
  }

  const v = valueOf(
    reqSet,
    (id) => counts.get(id) ?? { placed: 0, near: 0 },
    ds.reqs
  );
  return { ...v, ...totals, reqSet, members: members.length, unassignedPlaced };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROWS
// ─────────────────────────────────────────────────────────────────────────────

function lineOf(id: string, ds: ActivityDataset) {
  const own = ds.ctx.graph.byId.get(id)?.serviceline;
  if (own) return own;
  const tally = new Map<string, { id: string; name: string; n: number }>();
  for (const r of ds.people.get(id)?.byReq.values() ?? []) {
    const sl = ds.reqs.get(r.requirementId)?.serviceLine;
    if (!sl) continue;
    const t = tally.get(sl.id) ?? { ...sl, n: 0 };
    t.n += r.candidates;
    tally.set(sl.id, t);
  }
  const best = [...tally.values()].sort((x, y) => y.n - x.n)[0];
  return best ? { id: best.id, name: best.name } : null;
}

function buildRow(id: string, ds: ActivityDataset) {
  const a = ds.people.get(id)!;
  const u = ds.ctx.graph.byId.get(id);
  const own = groupMoney([id], ds);

  const below = [...descendantsOf(id, ds.ctx.graph)].filter((d) =>
    ds.people.has(d)
  );
  const team = below.length
    ? (() => {
        const t = groupMoney([id, ...below], ds);
        return {
          members: t.members,
          assignedReqCount: t.reqCount,
          funnelValue: t.saleValue,
          pipelineValue: t.nearTerminalValue,
          achievedValue: t.achievedValue,
          achievedPct: t.achievedPct,
          candidates: t.candidates,
          moves: t.moves,
          placed: t.buckets.placed,
          pipeline: t.buckets.pipeline,
          reversed: t.reversed,
        };
      })()
    : null;

  return {
    id,
    recruiterId: id,
    name: personName(u) || "Unknown user",
    email: u?.email ?? "",
    role: u?.role?.name ?? null,
    department: u?.department ?? null,
    managerName: managerName(u, ds.ctx.graph),
    depth: ds.ctx.depth.get(id) ?? null,
    isActive: u?.isActive ?? false,
    serviceLine: lineOf(id, ds),

    // Activity (unique candidates)
    candidates: a.candidates,
    totalTransitions: a.moves,
    sourcedCount: a.buckets.sourced,
    activeCount: a.buckets.active,
    nearTerminalCount: a.buckets.pipeline,
    terminalCount: a.buckets.placed,
    reversedCount: a.reversed,
    offPipelineCount: a.buckets.dropped,
    stageCounts: a.stageCounts,
    stageMoves: a.stageMoves,

    // Money
    assignedReqCount: own.reqCount,
    funnelValue: own.saleValue,
    pipelineValue: own.nearTerminalValue,
    achievedValue: own.achievedValue,
    achievedPct: own.achievedPct,
    unassignedPlaced: own.unassignedPlaced,

    team,
  };
}

type ActivityRow = ReturnType<typeof buildRow>;

const byHierarchy = (a: ActivityRow, b: ActivityRow) =>
  (a.depth ?? 99) - (b.depth ?? 99) ||
  b.terminalCount - a.terminalCount ||
  b.totalTransitions - a.totalTransitions ||
  a.name.localeCompare(b.name);

function visibleRows(ds: ActivityDataset): ActivityRow[] {
  return [...ds.people.keys()]
    .filter((id) => {
      const p = ds.people.get(id)!;
      return p.moves > 0 || p.assigned.size > 0;
    })
    .map((id) => buildRow(id, ds))
    .sort(byHierarchy);
}

function summaryOf(ds: ActivityDataset, rows: ActivityRow[]) {
  const all = groupMoney(ds.people.keys(), ds);
  const byBasis = emptyByBasis();
  for (const rid of all.reqSet) {
    const s = ds.reqs.get(rid)?.sale;
    if (!s) continue;
    byBasis[s.basis].count++;
    if (s.value != null) byBasis[s.basis].total += s.value;
  }
  return {
    people: rows.length,
    candidates: all.candidates,
    moves: all.moves,
    added: all.buckets.sourced,
    active: all.buckets.active,
    pipeline: all.buckets.pipeline,
    placed: all.buckets.placed,
    reversed: all.reversed,
    dropped: all.buckets.dropped,
    requirementCount: all.reqCount,
    unassignedPlaced: all.unassignedPlaced,
    achievedPct: all.achievedPct,
    // Same shape the page's stats panel already reads
    sale: {
      totalSaleValue: all.saleValue,
      totalAchievedValue: all.achievedValue,
      totalNearTerminalValue: all.nearTerminalValue,
      includedCount: all.reqCount - all.omitted,
      omittedCount: all.omitted,
      byBasis,
    },
  };
}

const fail = (res: Response, err: unknown, where: string, message: string) => {
  if (err instanceof ScopeError)
    return res.status(403).json({ success: false, message: err.message });
  console.error(`${where}:`, err);
  if (!res.headersSent)
    return res.status(500).json({ success: false, message });
};

const stageOut = (s: StageInfo, grandCount: number) => ({
  id: s.id,
  code: s.code,
  label: s.label,
  order: s.order,
  isStandard: s.isStandard,
  isTerminal: s.isTerminal,
  isNearTerminal: s.isNearTerminal,
  isSourced: s.isSourced,
  pipeline: s.pipeline,
  serviceLineId: s.serviceLineId,
  serviceLine: s.serviceLine,
  grandCount,
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity
// ─────────────────────────────────────────────────────────────────────────────

export const getRecruiterActivity = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const standardOnly = str(q.standardOnly) === "true";
    const ctx = await buildContext(req, q, {
      recruiterId: str(q.recruiterId) ?? null,
    });
    const ds = await buildActivityDataset(ctx);
    const rows = visibleRows(ds);

    const byLine = new Map<
      string,
      { line: { id: string; name: string } | null; rows: ActivityRow[] }
    >();
    for (const r of rows) {
      const key = r.serviceLine?.id ?? "__none__";
      if (!byLine.has(key)) byLine.set(key, { line: r.serviceLine, rows: [] });
      byLine.get(key)!.rows.push(r);
    }

    const stageList = [...ds.stages.values()]
      .filter((s) => !standardOnly || s.isStandard)
      .sort((a, b) => a.order - b.order);

    const groups = [...byLine.values()]
      .map(({ line, rows: data }) => {
        const grand: Record<string, number> = {};
        for (const r of data)
          for (const [sid, n] of Object.entries(r.stageCounts))
            grand[sid] = (grand[sid] ?? 0) + n;
        return {
          serviceLine: line,
          stages: stageList
            .filter((s) => (grand[s.id] ?? 0) > 0)
            .map((s) => stageOut(s, grand[s.id] ?? 0)),
          data,
          total: data.length,
          totalTransitions: data.reduce((s, r) => s + r.totalTransitions, 0),
        };
      })
      .sort((a, b) => b.total - a.total);

    return res.json({
      success: true,
      groups,
      meta: {
        window: windowLabel(q),
        standardOnly,
        total: rows.length,
        totalTransitions: rows.reduce((s, r) => s + r.totalTransitions, 0),
        multiLine: groups.length > 1,
        capped: false,
        summary: summaryOf(ds, rows),
      },
    });
  } catch (err) {
    return fail(
      res,
      err,
      "getRecruiterActivity",
      "Failed to fetch recruiter activity"
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity/drill — one row = one real stage move
//   ?recruiterId (optional, "__all__" = everyone in scope) &stageId &bucket
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_STAGE_WHERE: Record<Bucket, Prisma.PipelineStageWhereInput> = {
  placed: { isTerminal: true },
  pipeline: { isNearTerminal: true, isTerminal: false },
  dropped: { pipeline: false, isTerminal: false, isNearTerminal: false },
  sourced: {
    isSourced: true,
    pipeline: true,
    isTerminal: false,
    isNearTerminal: false,
  },
  active: {
    isSourced: false,
    pipeline: true,
    isTerminal: false,
    isNearTerminal: false,
  },
};

const DRILL_CAP = 3000;

export const getRecruiterActivityDrill = async (
  req: Request,
  res: Response
) => {
  try {
    const q = req.query as Q;
    const rid = str(q.recruiterId);
    const ctx = await buildContext(req, q, {
      recruiterId: rid && rid !== "__all__" ? rid : null,
    });
    const stageId = str(q.stageId);
    const bucket = str(q.bucket) as Bucket | undefined;

    const where: Prisma.CandidatePipelineStageLogWhereInput = {
      pipeline: {
        requirement: { is: ctx.reqWhere },
        ...(ctx.peopleIds !== null
          ? { recruiterId: { in: ctx.peopleIds } }
          : {}),
        ...(ctx.moj ? { AND: [ctx.moj] } : {}),
      },
      ...(ctx.window ? { createdAt: ctx.window } : {}),
      ...(stageId ? { toStageId: stageId } : {}),
      ...(bucket && BUCKET_STAGE_WHERE[bucket]
        ? { toStage: BUCKET_STAGE_WHERE[bucket] }
        : {}),
    };

    const logs = await prisma.candidatePipelineStageLog.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        timeInPrevStageMins: true,
        note: true,
        wasSkipped: true,
        fromStageId: true,
        toStageId: true,
        fromStage: { select: { id: true, label: true, order: true } },
        toStage: {
          select: {
            id: true,
            label: true,
            order: true,
            isTerminal: true,
            isNearTerminal: true,
            isSourced: true,
            pipeline: true,
          },
        },
        changedBy: { select: { firstName: true, lastName: true } },
        pipeline: {
          select: {
            id: true,
            recruiterId: true,
            currentStage: { select: { label: true, isTerminal: true } },
            snapshot: { select: { fullName: true, email: true, phone: true } },
            requirement: {
              select: {
                id: true,
                reqCode: true,
                title: true,
                client: { select: { id: true, name: true } },
                serviceLine: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: DRILL_CAP,
    });

    // Real moves only
    const moves = logs.filter((l) => l.fromStageId !== l.toStageId);

    const stageSummary: Record<string, number> = {};
    for (const m of moves)
      stageSummary[m.toStage.label] = (stageSummary[m.toStage.label] ?? 0) + 1;

    const recruiter = rid && rid !== "__all__" ? ctx.graph.byId.get(rid) : null;

    return res.json({
      success: true,
      data: {
        recruiter: recruiter
          ? {
              id: recruiter.id,
              name: personName(recruiter),
              email: recruiter.email,
            }
          : null,
        rows: moves.map((m) => {
          const b = bucketOf(m.toStage);
          const reversed =
            b === "placed" && !m.pipeline.currentStage?.isTerminal;
          return {
            logId: m.id,
            pipelineId: m.pipeline.id,
            createdAt: m.createdAt,
            timeInPrevStageMins: m.timeInPrevStageMins ?? null,
            wasSkipped: m.wasSkipped,
            note: m.note ?? null,
            fromStage: m.fromStage
              ? {
                  id: m.fromStageId!,
                  label: m.fromStage.label,
                  order: m.fromStage.order,
                }
              : null,
            toStage: {
              ...m.toStage,
              id: m.toStageId,
              bucket: BUCKET_LABELS[b],
            },
            reversed,
            currentStageLabel: m.pipeline.currentStage?.label ?? null,
            movedBy: m.changedBy ? personName(m.changedBy) : "—",
            recruiterName: personName(
              ctx.graph.byId.get(m.pipeline.recruiterId)
            ),
            candidate: {
              name: m.pipeline.snapshot?.fullName ?? "—",
              email: m.pipeline.snapshot?.email ?? "",
              phone: m.pipeline.snapshot?.phone ?? "",
            },
            requirement: {
              id: m.pipeline.requirement.id,
              reqCode: m.pipeline.requirement.reqCode,
              title: m.pipeline.requirement.title,
            },
            client: m.pipeline.requirement.client ?? null,
            serviceLine: m.pipeline.requirement.serviceLine ?? null,
          };
        }),
        stageSummary,
        total: moves.length,
        capped: logs.length >= DRILL_CAP,
      },
      meta: { window: windowLabel(q) },
    });
  } catch (err) {
    return fail(
      res,
      err,
      "getRecruiterActivityDrill",
      "Failed to fetch activity drill"
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — column registry for the Activity Log sheet (opt-out)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_ACTIVITY_COLS = [
  { key: "when", header: "Moved On", width: 18, group: "transition" },
  {
    key: "prevHrs",
    header: "Time in Prev Stage (hrs)",
    width: 20,
    group: "transition",
  },
  { key: "fromStage", header: "From Stage", width: 22, group: "transition" },
  { key: "toStage", header: "To Stage", width: 22, group: "transition" },
  { key: "bucket", header: "Status", width: 14, group: "transition" },
  {
    key: "reversed",
    header: "Placement Reversed?",
    width: 16,
    group: "transition",
  },
  {
    key: "currentStage",
    header: "Current Stage",
    width: 22,
    group: "transition",
  },
  { key: "movedBy", header: "Moved By", width: 22, group: "transition" },
  { key: "note", header: "Note", width: 30, group: "transition" },
  { key: "recruiter", header: "Recruiter", width: 24, group: "recruiter" },
  { key: "recEmail", header: "Recruiter Email", width: 28, group: "recruiter" },
  { key: "candidate", header: "Candidate", width: 26, group: "candidate" },
  {
    key: "candEmail",
    header: "Candidate Email",
    width: 28,
    group: "candidate",
  },
  {
    key: "candPhone",
    header: "Candidate Phone",
    width: 16,
    group: "candidate",
  },
  {
    key: "currentTitle",
    header: "Current Title",
    width: 24,
    group: "candidate",
  },
  {
    key: "currentCompany",
    header: "Current Company",
    width: 22,
    group: "candidate",
  },
  { key: "expYears", header: "Exp (yrs)", width: 10, group: "candidate" },
  { key: "topSkills", header: "Top Skills", width: 34, group: "candidate" },
  { key: "reqCode", header: "Req Code", width: 14, group: "requirement" },
  { key: "reqTitle", header: "Requirement", width: 34, group: "requirement" },
  { key: "client", header: "Client", width: 22, group: "requirement" },
  { key: "spoc", header: "Client SPOC", width: 22, group: "requirement" },
  { key: "sl", header: "Service Line", width: 18, group: "requirement" },
  { key: "bu", header: "Business Unit", width: 20, group: "requirement" },
  { key: "currentCtc", header: "Current CTC", width: 14, group: "ctc" },
  { key: "expectedCtc", header: "Expected CTC", width: 14, group: "ctc" },
  { key: "negotiatedCtc", header: "Negotiated CTC", width: 14, group: "ctc" },
  { key: "offeredCtc", header: "Offered CTC", width: 14, group: "ctc" },
  { key: "offerStatus", header: "Offer Status", width: 14, group: "ctc" },
  { key: "noticePeriod", header: "Notice (days)", width: 14, group: "joining" },
  { key: "lwd", header: "Last Working Day", width: 16, group: "joining" },
  {
    key: "derivedJoining",
    header: "Joining Date",
    width: 16,
    group: "joining",
  },
  {
    key: "monthOfJoining",
    header: "Month of Joining",
    width: 16,
    group: "joining",
  },
  { key: "daysToJoin", header: "Days to Join", width: 14, group: "joining" },
  { key: "joiningSource", header: "Joining From", width: 18, group: "joining" },
] as const;

type ActivityColKey = (typeof ALL_ACTIVITY_COLS)[number]["key"];

export const getActivityExportColumns = async (
  _req: Request,
  res: Response
) => {
  const groups: Record<string, { key: string; header: string }[]> = {};
  for (const c of ALL_ACTIVITY_COLS)
    (groups[c.group] ??= []).push({ key: c.key, header: c.header });
  return res.json({
    success: true,
    data: {
      columns: ALL_ACTIVITY_COLS.map((c) => ({
        key: c.key,
        header: c.header,
        group: c.group,
      })),
      groups,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/recruiters/activity/export
// Sheet 1 Recruiters    — same numbers as the screen (money + unique counts + stages)
// Sheet 2 Activity Log  — one row per real stage move
// Sheet 3 Stage Totals
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
  red: mkFill("FFFCE4D6"),
  money: "#,##0.00",
};

function styleHdr(row: ExcelJS.Row, cols: number) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = XL.header;
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 };
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
    cell.border = { top: { style: "medium", color: { argb: "FF4F46E5" } } };
  }
  row.height = 22;
}

export const exportRecruiterActivity = async (req: Request, res: Response) => {
  try {
    const q = req.query as Q;
    const standardOnly = str(q.standardOnly) === "true";
    const ctx = await buildContext(req, q, {
      recruiterId: str(q.recruiterId) ?? null,
      selectedIds: toArr(q.ids),
    });
    const ds = await buildActivityDataset(ctx);
    const rows = visibleRows(ds);
    const summary = summaryOf(ds, rows);
    const stageList = [...ds.stages.values()]
      .filter((s) => !standardOnly || s.isStandard)
      .sort((a, b) => a.order - b.order);

    const wb = new ExcelJS.Workbook();
    wb.creator = "TalentOS";
    wb.created = new Date();

    // ── Sheet 1: Recruiters ─────────────────────────────────────────────
    const grand: Record<string, number> = {};
    for (const r of rows)
      for (const [sid, n] of Object.entries(r.stageCounts))
        grand[sid] = (grand[sid] ?? 0) + n;

    const s1 = wb.addWorksheet("Recruiters", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
    });
    const s1Cols = [
      { header: "Name", key: "name", width: 24 },
      { header: "Email", key: "email", width: 28 },
      { header: "Role", key: "role", width: 18 },
      { header: "Reports To", key: "manager", width: 22 },
      { header: "Level", key: "depth", width: 8 },
      { header: "Assigned Reqs", key: "assignedReqCount", width: 14 },
      { header: "Funnel Value", key: "funnelValue", width: 16 },
      { header: "Pipeline Value", key: "pipelineValue", width: 16 },
      { header: "Achieved Value", key: "achievedValue", width: 16 },
      { header: "Achieved %", key: "achievedPct", width: 12 },
      { header: "Candidates Touched", key: "candidates", width: 14 },
      { header: "Stage Moves", key: "moves", width: 12 },
      { header: "Added", key: "added", width: 10 },
      { header: "Active", key: "active", width: 10 },
      { header: "Pipeline", key: "pipeline", width: 10 },
      { header: "Placed", key: "placed", width: 10 },
      { header: "Placements Reversed", key: "reversed", width: 14 },
      { header: "Dropped", key: "dropped", width: 10 },
      {
        header: "Placed on Unassigned Reqs",
        key: "unassignedPlaced",
        width: 16,
      },
      ...stageList.map((s) => ({
        header: `${s.label} (${grand[s.id] ?? 0})`,
        key: `st_${s.id}`,
        width: Math.max(s.label.length + 6, 12),
      })),
      { header: "Team Size", key: "teamMembers", width: 10 },
      { header: "Team Funnel Value", key: "teamFunnel", width: 16 },
      { header: "Team Pipeline Value", key: "teamPipeline", width: 16 },
      { header: "Team Achieved Value", key: "teamAchieved", width: 16 },
      { header: "Team Achieved %", key: "teamPct", width: 14 },
    ];
    s1.columns = s1Cols;
    styleHdr(s1.getRow(1), s1Cols.length);
    const s1Money = [
      "funnelValue",
      "pipelineValue",
      "achievedValue",
      "teamFunnel",
      "teamPipeline",
      "teamAchieved",
    ];

    for (const r of rows) {
      const st: Record<string, number> = {};
      for (const s of stageList) st[`st_${s.id}`] = r.stageCounts[s.id] ?? 0;
      const row = s1.addRow({
        name: r.name,
        email: r.email,
        role: r.role ?? "",
        manager: r.managerName ?? "",
        depth: r.depth ?? "",
        assignedReqCount: r.assignedReqCount,
        funnelValue: r.funnelValue,
        pipelineValue: r.pipelineValue,
        achievedValue: r.achievedValue,
        achievedPct: r.achievedPct,
        candidates: r.candidates,
        moves: r.totalTransitions,
        added: r.sourcedCount,
        active: r.activeCount,
        pipeline: r.nearTerminalCount,
        placed: r.terminalCount,
        reversed: r.reversedCount,
        dropped: r.offPipelineCount,
        unassignedPlaced: r.unassignedPlaced,
        ...st,
        teamMembers: r.team?.members ?? "",
        teamFunnel: r.team?.funnelValue ?? "",
        teamPipeline: r.team?.pipelineValue ?? "",
        teamAchieved: r.team?.achievedValue ?? "",
        teamPct: r.team?.achievedPct ?? "",
      });
      for (const k of s1Money) row.getCell(k).numFmt = XL.money;
      if (r.terminalCount > 0) row.getCell("placed").fill = XL.green;
      if (r.nearTerminalCount > 0) row.getCell("pipeline").fill = XL.amber;
      if (r.reversedCount > 0) row.getCell("reversed").fill = XL.red;
    }

    const totalSt: Record<string, number> = {};
    for (const s of stageList) totalSt[`st_${s.id}`] = grand[s.id] ?? 0;
    const tRow = s1.addRow({
      name: "TEAM TOTAL",
      email: "Each requirement counted once",
      assignedReqCount: summary.requirementCount,
      funnelValue: summary.sale.totalSaleValue,
      pipelineValue: summary.sale.totalNearTerminalValue,
      achievedValue: summary.sale.totalAchievedValue,
      achievedPct: summary.achievedPct,
      candidates: summary.candidates,
      moves: summary.moves,
      added: summary.added,
      active: summary.active,
      pipeline: summary.pipeline,
      placed: summary.placed,
      reversed: summary.reversed,
      dropped: summary.dropped,
      unassignedPlaced: summary.unassignedPlaced,
      ...totalSt,
    });
    styleTotals(tRow, s1Cols.length);
    for (const k of s1Money) tRow.getCell(k).numFmt = XL.money;
    s1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s1Cols.length },
    };

    // ── Sheet 2: Activity Log ───────────────────────────────────────────
    const hidden = new Set(toArr(q.hiddenActivityCols) as ActivityColKey[]);
    const cols = ALL_ACTIVITY_COLS.filter((c) => !hidden.has(c.key));
    const has = (k: ActivityColKey) => !hidden.has(k);
    const s2 = wb.addWorksheet("Activity Log", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    s2.columns = cols.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));
    styleHdr(s2.getRow(1), cols.length);

    if (!ds.filter.empty) {
      const logsAll = await prisma.candidatePipelineStageLog.findMany({
        where: {
          pipeline: {
            requirement: { is: ctx.reqWhere },
            ...(ctx.peopleIds !== null
              ? { recruiterId: { in: ctx.peopleIds } }
              : {}),
            ...(ctx.moj ? { AND: [ctx.moj] } : {}),
          },
          ...(ctx.window ? { createdAt: ctx.window } : {}),
        },
        select: {
          id: true,
          createdAt: true,
          timeInPrevStageMins: true,
          wasSkipped: true,
          note: true,
          fromStageId: true,
          toStageId: true,
          fromStage: { select: { label: true } },
          toStage: {
            select: {
              label: true,
              isTerminal: true,
              isNearTerminal: true,
              pipeline: true,
              isSourced: true,
            },
          },
          changedBy: { select: { firstName: true, lastName: true } },
          pipeline: {
            select: {
              recruiter: {
                select: { firstName: true, lastName: true, email: true },
              },
              currentStage: { select: { label: true, isTerminal: true } },
              snapshot: {
                select: {
                  fullName: true,
                  email: true,
                  phone: true,
                  currentTitle: true,
                  currentCompany: true,
                  totalExpYears: true,
                  topSkills: true,
                },
              },
              currentCtc: true,
              expectedCtc: true,
              negotiatedCtc: true,
              offeredCtc: true,
              offerStatus: true,
              noticePeriodDays: true,
              lastWorkingDate: true,
              requirement: {
                select: {
                  reqCode: true,
                  title: true,
                  client: { select: { name: true } },
                  clientSpoc: { select: { firstName: true, lastName: true } },
                  serviceLine: { select: { name: true } },
                  businessUnit: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50_000,
      });

      const now = new Date();
      for (const log of logsAll) {
        if (log.fromStageId === log.toStageId) continue; // real moves only
        const t = log.toStage;
        const p = log.pipeline;
        const rq = p.requirement;
        const snap = p.snapshot;
        const b = bucketOf(t);
        const reversed = b === "placed" && !p.currentStage?.isTerminal;
        const j = resolveJoining(p, now);

        const all: Record<ActivityColKey, unknown> = {
          when: new Date(log.createdAt),
          prevHrs:
            log.timeInPrevStageMins != null
              ? +(log.timeInPrevStageMins / 60).toFixed(1)
              : "",
          fromStage: log.fromStage?.label ?? "— (entry)",
          toStage: t.label,
          bucket: BUCKET_LABELS[b],
          reversed: b === "placed" ? (reversed ? "Yes" : "No") : "",
          currentStage: p.currentStage?.label ?? "",
          movedBy: log.changedBy ? personName(log.changedBy) : "—",
          note: log.note ?? "",
          recruiter: personName(p.recruiter),
          recEmail: p.recruiter.email,
          candidate: snap?.fullName ?? "—",
          candEmail: snap?.email ?? "",
          candPhone: snap?.phone ?? "",
          currentTitle: snap?.currentTitle ?? "",
          currentCompany: snap?.currentCompany ?? "",
          expYears: snap?.totalExpYears ?? "",
          topSkills: (snap?.topSkills ?? []).join(", "),
          reqCode: rq?.reqCode ?? "",
          reqTitle: rq?.title ?? "",
          client: rq?.client?.name ?? "",
          spoc: personName(rq?.clientSpoc),
          sl: rq?.serviceLine?.name ?? "",
          bu: rq?.businessUnit?.name ?? "",
          currentCtc: p.currentCtc ?? "",
          expectedCtc: p.expectedCtc ?? "",
          negotiatedCtc: p.negotiatedCtc ?? "",
          offeredCtc: p.offeredCtc ?? "",
          offerStatus: p.offerStatus ?? "",
          noticePeriod: j.noticeDays ?? "",
          lwd: p.lastWorkingDate ? new Date(p.lastWorkingDate) : "",
          derivedJoining: j.date ?? "",
          monthOfJoining: j.mojLabel ?? "",
          daysToJoin: j.daysToJoin ?? "",
          joiningSource: j.source ? JOINING_SOURCE_LABELS[j.source] : "",
        };
        const row = s2.addRow(
          Object.fromEntries(cols.map((c) => [c.key, all[c.key]]))
        );
        row.height = 18;
        if (has("when")) row.getCell("when").numFmt = "dd-mmm-yyyy hh:mm";
        if (has("lwd")) row.getCell("lwd").numFmt = "dd-mmm-yyyy";
        if (has("derivedJoining"))
          row.getCell("derivedJoining").numFmt = "dd-mmm-yyyy";
        const tint =
          b === "placed"
            ? reversed
              ? XL.red
              : XL.green
            : b === "pipeline"
            ? XL.amber
            : b === "dropped"
            ? XL.red
            : null;
        if (tint && has("bucket")) row.getCell("bucket").fill = tint;
      }
    }
    s2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(cols.length, 1) },
    };

    // ── Sheet 3: Stage Totals ───────────────────────────────────────────
    const s3 = wb.addWorksheet("Stage Totals");
    s3.columns = [
      { header: "Stage", key: "stage", width: 28 },
      { header: "Status", key: "bucket", width: 16 },
      { header: "Candidates (unique)", key: "count", width: 20 },
    ];
    styleHdr(s3.getRow(1), 3);
    for (const s of stageList)
      s3.addRow({
        stage: s.label,
        bucket: BUCKET_LABELS[bucketOf(s)],
        count: grand[s.id] ?? 0,
      });
    styleTotals(
      s3.addRow({
        stage: "TOTAL",
        bucket: "",
        count: Object.values(grand).reduce((a, b) => a + b, 0),
      }),
      3
    );

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recruiter-activity-${dateStr}.xlsx"`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return fail(
      res,
      err,
      "exportRecruiterActivity",
      "Failed to export recruiter activity"
    );
  }
};
