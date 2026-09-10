// File: reports.candidates.controller.ts
// Path: src/controller/reports/reports.candidates.controller.ts
//
// The Candidates tab. Four endpoints:
//   GET /reports/candidates/list     — paginated rows + duplicate flags
//   GET /reports/candidates/stats    — aggregates over the FULL filtered set
//   GET /reports/candidates/filters  — dropdown options, scope-aware
//   GET /reports/candidates/drill    — rows behind one stat card
//
// SCOPING
// A candidate is visible to you when ANY of these hold:
//   1. pipeline.recruiterId          is in your org tree  (you or yours sourced them)
//   2. requirement.createdById       is in your org tree  (you or yours own the req)
//   3. requirement is ACTIVE-assigned to your org tree    (you or yours are working it)
// Resolved as a 3-way indexed OR. Org tree resolved once, assigned req IDs
// pre-fetched once — 3 queries total, every one on an existing index.
//
// DUPLICATES
// @@unique([candidateServiceId, requirementId]) means a candidate cannot repeat
// on one requirement. So a duplicate is always CROSS-requirement. Detected with
// one groupBy on candidateServiceId. Distinct from disposition=DUPLICATE, which
// is the manual flag a recruiter sets.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { resolveOrgTreeDown } from "./reports.controller";
import { string } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// DATE WINDOW
// ─────────────────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

interface DateWindow {
  gte?: Date;
  lte?: Date;
}

function resolveDateWindow(q: Record<string, string | undefined>): DateWindow {
  const now = new Date();
  if (q.hours) {
    const h = parseInt(q.hours, 10);
    if (!Number.isNaN(h) && h > 0)
      return { gte: new Date(now.getTime() - h * 3600000), lte: now };
  }
  switch (q.range) {
    case "today":
      return { gte: startOfDay(now), lte: now };
    case "yesterday": {
      const y = addDays(now, -1);
      return { gte: startOfDay(y), lte: endOfDay(y) };
    }
    case "last7":
      return { gte: startOfDay(addDays(now, -6)), lte: now };
    case "last30":
      return { gte: startOfDay(addDays(now, -29)), lte: now };
    case "thisMonth":
      return { gte: startOfMonth(now), lte: now };
    default:
      break;
  }
  const w: DateWindow = {};
  if (q.fromDate)
    w.gte = isDateOnly(q.fromDate)
      ? startOfDay(new Date(q.fromDate))
      : new Date(q.fromDate);
  if (q.toDate)
    w.lte = isDateOnly(q.toDate)
      ? endOfDay(new Date(q.toDate))
      : new Date(q.toDate);
  return w;
}

function windowLabel(q: Record<string, string | undefined>): string {
  if (q.hours) return `last-${q.hours}h`;
  if (q.range) return q.range;
  if (q.fromDate || q.toDate)
    return `${q.fromDate ?? "start"}_to_${q.toDate ?? "now"}`;
  return "all-time";
}

// ─────────────────────────────────────────────────────────────────────────────
// JOINING DATE DERIVATION
// monthOfJoining / remainingDaysToJoin are stored but null on most rows.
// Derive from what recruiters actually maintain.
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function safeDate(val: any): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function deriveJoiningDate(p: any): Date | null {
  const actual = safeDate(p.actualJoiningDate);
  if (actual) return actual;
  const expected = safeDate(p.expectedJoiningDate);
  if (expected) return expected;
  const lwd = safeDate(p.lastWorkingDate);
  if (lwd) return lwd;
  if (p.noticePeriod) {
    const lower = String(p.noticePeriod).toLowerCase().trim();
    const num = lower.match(/^(\d+)/)?.[1];
    if (num) {
      const n = parseInt(num, 10);
      const base = new Date();
      if (lower.includes("month")) base.setMonth(base.getMonth() + n);
      else base.setDate(base.getDate() + n);
      return base;
    }
  }
  return null;
}

function monthOfJoiningLabel(d: Date | null): string {
  if (!d) return "";
  return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function joiningSourceLabel(p: any): string {
  if (safeDate(p.actualJoiningDate)) return "Actual";
  if (safeDate(p.expectedJoiningDate)) return "Expected";
  if (safeDate(p.lastWorkingDate)) return "From LWD";
  if (p.noticePeriod) return "From notice period";
  return "";
}

/** "2026-07" → "July 2026". Returns null when unparseable. */
function mojParamToLabel(mojMonth?: string): string | null {
  if (!mojMonth) return null;
  const [yr, mo] = mojMonth.split("-");
  const idx = parseInt(mo, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx > 11 || !yr) return null;
  return `${MONTHS_FULL[idx]} ${yr}`;
}

function joiningInRange(
  start: Date,
  end: Date,
  storedLabel?: string | null,
  storedYearSubstr?: string | null,
): Record<string, any> {
  const range = { gte: start, lte: end };
  const or: any[] = [
    { actualJoiningDate: range },
    { expectedJoiningDate: range },
    { lastWorkingDate: range },
  ];
  if (storedLabel) or.push({ monthOfJoining: storedLabel });
  if (storedYearSubstr)
    or.push({ monthOfJoining: { contains: storedYearSubstr } });
  return { OR: or };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function parseIds(raw?: string): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? [...new Set(arr)] : null;
}

// Express parses repeated `?mojMonthNum=1&mojMonthNum=6` as an array; a
// single `?mojMonthNum=1` comes through as a plain string. parseInt() on an
// array silently stringifies it ("1,6" → 1), which is why multi-select was
// only ever matching the first month. Handle both shapes explicitly here,
// the same way stageId already does a few lines below.
function parseMonthNums(raw: unknown): number[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return [
    ...new Set(
      arr
        .map((v) => parseInt(String(v), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= 12),
    ),
  ];
}

function formatAging(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  if (mins < 43800) return `${Math.floor(mins / 10080)}wk`;
  return `${Math.floor(mins / 43800)}mo`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE RESOLUTION
//
// Returns the Prisma `where` fragment that limits which pipeline rows the
// caller may see. null org tree (super admin) → no restriction at all.
// ─────────────────────────────────────────────────────────────────────────────

async function buildScopeFilter(
  req: Request,
): Promise<Record<string, any> | null> {
  const orgTree = await resolveOrgTreeDown(
    req.user!.id,
    req.user!.isSuperAdmin,
  );
  if (orgTree === null) return null; // super admin — see everything
  if (orgTree.length === 0) return { id: { in: [] } }; // paranoid: deny

  // Requirements actively assigned to anyone in the tree.
  // Indexed on [assignedToId, status].
  const assignedRows = await prisma.requirementAssignment.findMany({
    where: { assignedToId: { in: orgTree }, status: "ACTIVE" },
    select: { requirementId: true },
  });
  const assignedReqIds = [...new Set(assignedRows.map((a) => a.requirementId))];

  return {
    OR: [
      // sourced by me or mine — index: recruiterId
      { recruiterId: { in: orgTree } },
      // requirement owned by me or mine — index: Requirement.createdById
      { requirement: { createdById: { in: orgTree } } },
      // requirement assigned to me or mine
      ...(assignedReqIds.length > 0
        ? [{ requirementId: { in: assignedReqIds } }]
        : []),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER BUILDER — every filter the tab can send
// ─────────────────────────────────────────────────────────────────────────────

async function buildCandidateWhere(
  req: Request,
  q: Record<string, string>,
): Promise<Record<string, any>> {
  const and: Record<string, any>[] = [];

  // ── Hierarchy scope ──────────────────────────────────────────────────────
  const scope = await buildScopeFilter(req);
  if (scope) and.push(scope);

  // ── Requirement-level filters ────────────────────────────────────────────
  const reqWhere: Record<string, any> = { deletedAt: null };
  if (q.clientId) reqWhere.clientId = q.clientId;
  if (q.clientSpocId) reqWhere.clientSpocId = q.clientSpocId;
  if (q.serviceLineId) reqWhere.serviceLineId = q.serviceLineId;
  if (q.businessUnitId) reqWhere.businessUnitId = q.businessUnitId;
  if (q.requirementId) reqWhere.id = q.requirementId;
  if (q.createdById) reqWhere.createdById = q.createdById;
  if (q.priority) reqWhere.priority = q.priority;

  // Requirement status — supports a single value or a CSV list.
  // reqActive=true is shorthand for "requirement still open".
  const statusList = parseIds(q.reqStatus);
  if (statusList) reqWhere.status = { in: statusList };
  else if (q.status) reqWhere.status = q.status;
  else if (q.reqActive === "true")
    reqWhere.status = { in: ["ACTIVE", "PENDING_APPROVAL"] };
  else if (q.reqActive === "false")
    reqWhere.status = { in: ["CLOSED", "CANCELLED", "ON_HOLD", "DRAFT"] };

  and.push({ requirement: reqWhere });

  // ── Recruiter ────────────────────────────────────────────────────────────
  const recruiterIds = parseIds(q.recruiterId);
  if (recruiterIds) and.push({ recruiterId: { in: recruiterIds } });

  // Team picker narrows to these recruiters
  const teamIds = parseIds(q.userIds);
  if (teamIds) and.push({ recruiterId: { in: teamIds } });

  const rawStageId = req.query.stageId;
  const rawStageIds = q.stageIds;
  // ── Stage ────────────────────────────────────────────────────────────────
  const stageIds: string[] | null = rawStageId
    ? Array.isArray(rawStageId)
      ? (rawStageId as string[]).filter(Boolean)
      : [rawStageId as string]
    : parseIds(rawStageIds);

  if (stageIds?.length) and.push({ currentStageId: { in: stageIds } });

  // Stage bucket — flag-based, mutually exclusive
  switch (q.bucket) {
    case "placed":
      and.push({ currentStage: { isTerminal: true } });
      break;
    case "near_terminal":
      and.push({ currentStage: { isNearTerminal: true, isTerminal: false } });
      break;
    case "in_pipeline":
      and.push({
        currentStage: {
          pipeline: true,
          isTerminal: false,
          isNearTerminal: false,
          isSourced: false,
        },
      });
      break;
    case "sourced":
      and.push({ currentStage: { isSourced: true } });
      break;
    case "off_pipeline":
      and.push({ currentStage: { pipeline: false } });
      break;
  }

  // ── Disposition ──────────────────────────────────────────────────────────
  const dispositions = parseIds(q.disposition);
  if (dispositions) and.push({ disposition: { in: dispositions as any } });

  // ── Flags ────────────────────────────────────────────────────────────────
  if (q.isRejected === "true") and.push({ isRejected: true });
  if (q.isWithdrawn === "true") and.push({ isWithdrawn: true });
  if (q.isOnHold === "true") and.push({ isOnHold: true });
  if (q.hasOffer === "true") and.push({ offerStatus: { not: null } });
  if (q.isSubmitted === "true") and.push({ submittedAt: { not: null } });

  // ── Snapshot type — recruiter-sourced vs self-applied ────────────────────
  if (q.snapshotType) and.push({ snapshot: { type: q.snapshotType as any } });

  // ── Month of joining ─────────────────────────────────────────────────────
  // Matches the stored label OR any row whose derived date lands in that month.
  // The stored-label match is indexed; the date range covers unstored rows.
  //
  // mojMonthNum can now arrive as multiple repeated query params (the front
  // end's month multi-select), so it's read straight off req.query — same
  // as stageId above — instead of off `q`, which flattens everything to a
  // string and silently keeps only the first value.
  const mojYearNum = q.mojYear ? parseInt(q.mojYear, 10) : null;
  const mojMonthNums = parseMonthNums(req.query.mojMonthNum);

  if (q.mojMonth && /^\d{4}-\d{2}$/.test(q.mojMonth)) {
    const [yr, mo] = q.mojMonth.split("-").map(Number);
    and.push(
      joiningInRange(
        new Date(yr, mo - 1, 1, 0, 0, 0, 0),
        new Date(yr, mo, 0, 23, 59, 59, 999),
        mojParamToLabel(q.mojMonth),
      ),
    );
  } else if (mojMonthNums.length > 0) {
    // Union across every selected month (and, if no year is pinned, across
    // a ±3-year window per month) — a joining date only ever falls in one
    // month, so this is always an OR, never an AND.
    const ors: any[] = [];
    if (mojYearNum && !isNaN(mojYearNum)) {
      for (const mn of mojMonthNums) {
        const s = new Date(mojYearNum, mn - 1, 1, 0, 0, 0, 0);
        const e = new Date(mojYearNum, mn, 0, 23, 59, 59, 999);
        ors.push(
          { actualJoiningDate: { gte: s, lte: e } },
          { expectedJoiningDate: { gte: s, lte: e } },
          { lastWorkingDate: { gte: s, lte: e } },
          { monthOfJoining: `${MONTHS_FULL[mn - 1]} ${mojYearNum}` },
        );
      }
    } else {
      const thisYear = new Date().getFullYear();
      for (const mn of mojMonthNums) {
        for (let y = thisYear - 3; y <= thisYear + 3; y++) {
          const s = new Date(y, mn - 1, 1, 0, 0, 0, 0);
          const e = new Date(y, mn, 0, 23, 59, 59, 999);
          ors.push(
            { actualJoiningDate: { gte: s, lte: e } },
            { expectedJoiningDate: { gte: s, lte: e } },
            { lastWorkingDate: { gte: s, lte: e } },
            { monthOfJoining: `${MONTHS_FULL[mn - 1]} ${y}` },
          );
        }
      }
    }
    and.push({ OR: ors });
  } else if (mojYearNum && !isNaN(mojYearNum)) {
    and.push(
      joiningInRange(
        new Date(mojYearNum, 0, 1, 0, 0, 0, 0),
        new Date(mojYearNum, 11, 31, 23, 59, 59, 999),
        null,
        q.mojYear,
      ),
    );
  }

  // ── Exact day of joining ─────────────────────────────────────────────────
  // joinFrom / joinTo bound the actual/expected joining date.
  if (q.joinFrom || q.joinTo) {
    const gte = q.joinFrom ? startOfDay(new Date(q.joinFrom)) : undefined;
    const lte = q.joinTo ? endOfDay(new Date(q.joinTo)) : undefined;
    const range = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    and.push({
      OR: [
        { actualJoiningDate: range },
        { expectedJoiningDate: range },
        { lastWorkingDate: range },
      ],
    });
  }

  // Joined-only — has a confirmed actual joining date
  if (q.hasJoined === "true") and.push({ actualJoiningDate: { not: null } });

  // ── Activity window on the pipeline row ──────────────────────────────────
  const win = resolveDateWindow(q);
  if (win.gte || win.lte) {
    const range = {
      ...(win.gte ? { gte: win.gte } : {}),
      ...(win.lte ? { lte: win.lte } : {}),
    };
    if (q.dateField === "sourced") {
      and.push({ createdAt: range }); // strictly added in window
    } else if (q.dateField === "stageMoved") {
      and.push({ stageUpdatedAt: range }); // stage touched in window
    } else {
      and.push({
        // any activity (default)
        OR: [
          { createdAt: range },
          { updatedAt: range },
          { stageHistory: { some: { createdAt: range } } },
        ],
      });
    }
  }

  // ── Search — name / email / phone / company / title / req code ────────────
  if (q.search?.trim()) {
    const s = q.search.trim();
    and.push({
      OR: [
        { snapshot: { fullName: { contains: s, mode: "insensitive" } } },
        { snapshot: { email: { contains: s, mode: "insensitive" } } },
        { snapshot: { phone: { contains: s } } },
        { snapshot: { currentCompany: { contains: s, mode: "insensitive" } } },
        { snapshot: { currentTitle: { contains: s, mode: "insensitive" } } },
        { requirement: { reqCode: { contains: s, mode: "insensitive" } } },
        { requirement: { title: { contains: s, mode: "insensitive" } } },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW SELECT
// ─────────────────────────────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true,
  requirementId: true,
  recruiterId: true,
  currentStageId: true,
  disposition: true,
  dropReason: true,
  isRejected: true,
  isWithdrawn: true,
  isOnHold: true,
  rejectionReason: true,
  withdrawnReason: true,
  submittedAt: true,
  offerStatus: true,
  offeredCtc: true,
  currentCtc: true,
  expectedCtc: true,
  negotiatedCtc: true,
  salaryCurrency: true,
  noticePeriod: true,
  lastWorkingDate: true,
  expectedJoiningDate: true,
  actualJoiningDate: true,
  monthOfJoining: true,
  remainingDaysToJoin: true,
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
  recruiter: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  snapshot: {
    select: {
      id: true,
      candidateServiceId: true,
      candidateCode: true,
      fullName: true,
      email: true,
      phone: true,
      currentTitle: true,
      currentCompany: true,
      totalExpYears: true,
      topSkills: true,
      resumeUrl: true,
      type: true,
      sourced: true,
      snapshotAt: true,
    },
  },
  requirement: {
    select: {
      id: true,
      reqCode: true,
      title: true,
      status: true,
      priority: true,
      totalOpenings: true,
      client: { select: { id: true, name: true } },
      clientSpoc: { select: { id: true, firstName: true, lastName: true } },
      serviceLine: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  stageHistory: { select: { timeInPrevStageMins: true } },
} as const;

function bucketOf(s: any): string {
  if (!s) return "In pipeline";
  if (s.isTerminal) return "Placed";
  if (s.isNearTerminal) return "Near close";
  if (!s.pipeline) return "Off pipeline";
  if (s.isSourced) return "Sourced";
  return "In pipeline";
}

function buildRow(
  p: any,
  now: number,
  dupMap: Map<string, any[]>,
): Record<string, any> {
  const stageAgeMins = Math.floor(
    (now - new Date(p.stageUpdatedAt).getTime()) / 60000,
  );
  const totalMins =
    (p.stageHistory ?? []).reduce(
      (s: number, l: any) => s + (l.timeInPrevStageMins ?? 0),
      0,
    ) + stageAgeMins;

  const derived = deriveJoiningDate(p);
  const snap = p.snapshot;
  const rq = p.requirement;

  // Other requirements this same person sits in
  const others = (dupMap.get(snap?.candidateServiceId ?? "") ?? []).filter(
    (o: any) => o.requirementId !== p.requirementId,
  );

  return {
    pipelineId: p.id,
    snapshotId: snap?.id ?? null,
    candidateServiceId: snap?.candidateServiceId ?? null,
    candidateCode: snap?.candidateCode ?? null,

    // Candidate
    candidateName: snap?.fullName ?? "—",
    candidateEmail: snap?.email ?? "",
    candidatePhone: snap?.phone ?? "",
    currentTitle: snap?.currentTitle ?? "",
    currentCompany: snap?.currentCompany ?? "",
    expYears: snap?.totalExpYears ?? null,
    topSkills: Array.isArray(snap?.topSkills) ? snap.topSkills.join(", ") : "",
    resumeUrl: snap?.resumeUrl ?? null,
    snapshotType: snap?.type ?? "CANDIDATE",
    sourcedVia: snap?.sourced ?? "",
    snapshotAt: snap?.snapshotAt ?? null,

    // Stage
    stageId: p.currentStageId,
    stageLabel: p.currentStage?.label ?? "—",
    stageCode: p.currentStage?.code ?? "",
    stageOrder: p.currentStage?.order ?? 0,
    isTerminal: p.currentStage?.isTerminal ?? false,
    isNearTerminal: p.currentStage?.isNearTerminal ?? false,
    isSourcedStage: p.currentStage?.isSourced ?? false,
    inPipeline: p.currentStage?.pipeline ?? true,
    bucket: bucketOf(p.currentStage),

    // Disposition + flags
    disposition: p.disposition,
    dropReason: p.dropReason ?? null,
    isRejected: p.isRejected,
    isWithdrawn: p.isWithdrawn,
    isOnHold: p.isOnHold,
    rejectionReason: p.rejectionReason ?? null,
    withdrawnReason: p.withdrawnReason ?? null,

    // Timeline
    addedOn: p.createdAt,
    pipelineDays: Math.floor(totalMins / 1440),
    stageAging: formatAging(stageAgeMins),
    stageAgeMins,
    submittedAt: p.submittedAt ?? null,

    // CTC
    offerStatus: p.offerStatus ?? null,
    currentCtc: p.currentCtc != null ? Number(p.currentCtc) : null,
    expectedCtc: p.expectedCtc != null ? Number(p.expectedCtc) : null,
    negotiatedCtc: p.negotiatedCtc != null ? Number(p.negotiatedCtc) : null,
    offeredCtc: p.offeredCtc != null ? Number(p.offeredCtc) : null,
    salaryCurrency: p.salaryCurrency ?? "INR",

    // Joining — derived so it is never blank when the data exists
    noticePeriod: p.noticePeriod ?? null,
    lastWorkingDate: p.lastWorkingDate ?? null,
    expectedJoiningDate: p.expectedJoiningDate ?? null,
    actualJoiningDate: p.actualJoiningDate ?? null,
    derivedJoiningDate: derived,
    monthOfJoining: p.monthOfJoining || monthOfJoiningLabel(derived),
    daysToJoin:
      p.remainingDaysToJoin ??
      (derived ? Math.floor((derived.getTime() - now) / 86400000) : null),
    joiningSource: joiningSourceLabel(p),

    // Recruiter
    recruiterId: p.recruiterId,
    recruiterName: `${p.recruiter?.firstName ?? ""} ${
      p.recruiter?.lastName ?? ""
    }`.trim(),
    recruiterEmail: p.recruiter?.email ?? "",

    // Requirement
    requirementId: rq?.id ?? "",
    reqCode: rq?.reqCode ?? "",
    reqTitle: rq?.title ?? "",
    reqStatus: rq?.status ?? "",
    reqPriority: rq?.priority ?? "",
    totalOpenings: rq?.totalOpenings ?? 0,
    clientName: rq?.client?.name ?? "",
    clientSpocName: rq?.clientSpoc
      ? `${rq.clientSpoc.firstName} ${rq.clientSpoc.lastName}`.trim()
      : "",
    serviceLineName: rq?.serviceLine?.name ?? "",
    businessUnitName: rq?.businessUnit?.name ?? "",
    reqCreatedBy: rq?.createdBy
      ? `${rq.createdBy.firstName} ${rq.createdBy.lastName}`.trim()
      : "",

    // Duplicate intelligence
    isDuplicateFlag: p.disposition === "DUPLICATE", // manually flagged
    duplicateCount: others.length, // other reqs, same person
    isCrossRequirement: others.length > 0,
    duplicateIn: others.map((o: any) => ({
      requirementId: o.requirementId,
      reqCode: o.reqCode,
      reqTitle: o.reqTitle,
      stageLabel: o.stageLabel,
      recruiterName: o.recruiterName,
      disposition: o.disposition,
      sameClient: o.clientId === rq?.client?.id,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE MAP
//
// For the candidateServiceIds on the current page, find every OTHER pipeline
// row for the same person. One query, scoped to just the page's IDs.
// ─────────────────────────────────────────────────────────────────────────────

async function buildDuplicateMap(
  candidateServiceIds: string[],
): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  if (!candidateServiceIds.length) return map;

  const rows = await prisma.requirementCandidatePipeline.findMany({
    where: {
      snapshot: { candidateServiceId: { in: candidateServiceIds } },
    },
    select: {
      requirementId: true,
      disposition: true,
      currentStage: { select: { label: true } },
      recruiter: { select: { firstName: true, lastName: true } },
      snapshot: { select: { candidateServiceId: true } },
      requirement: {
        select: { reqCode: true, title: true, clientId: true },
      },
    },
  });

  for (const r of rows) {
    const csid = r.snapshot?.candidateServiceId;
    if (!csid) continue;
    if (!map.has(csid)) map.set(csid, []);
    map.get(csid)!.push({
      requirementId: r.requirementId,
      reqCode: r.requirement?.reqCode ?? "",
      reqTitle: r.requirement?.title ?? "",
      clientId: r.requirement?.clientId ?? null,
      stageLabel: r.currentStage?.label ?? "",
      recruiterName: `${r.recruiter?.firstName ?? ""} ${
        r.recruiter?.lastName ?? ""
      }`.trim(),
      disposition: r.disposition,
    });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// SORTING
// ─────────────────────────────────────────────────────────────────────────────

function buildOrderBy(q: Record<string, string>): any {
  const dir = q.sortDir === "asc" ? "asc" : "desc";
  switch (q.sortBy) {
    case "candidateName":
      return { snapshot: { fullName: dir } };
    case "stage":
      return { currentStage: { order: dir } };
    case "recruiter":
      return { recruiter: { firstName: dir } };
    case "reqCode":
      return { requirement: { reqCode: dir } };
    case "offeredCtc":
      return { offeredCtc: dir };
    case "joining":
      return { actualJoiningDate: dir };
    case "stageUpdated":
      return { stageUpdatedAt: dir };
    case "addedOn":
    default:
      return { createdAt: dir };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/list
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidatesList = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page ?? "1", 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(q.limit ?? "50", 10) || 50),
    );
    const skip = (page - 1) * limit;

    const where = await buildCandidateWhere(req, q);

    // Count + page in parallel
    const [total, pipelines] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.findMany({
        where,
        select: ROW_SELECT as any,
        orderBy: buildOrderBy(q),
        skip,
        take: limit,
      }),
    ]);

    // Duplicate lookup only for this page's candidates
    const csIds = [
      ...new Set(
        pipelines
          .map((p: any) => p.snapshot?.candidateServiceId)
          .filter(Boolean) as string[],
      ),
    ];
    const dupMap = await buildDuplicateMap(csIds);

    const now = Date.now();
    let rows = pipelines.map((p: any) => buildRow(p, now, dupMap));

    // Duplicates-only view — applied after the dup map is built, since
    // "appears in more than one requirement" is not expressible in SQL here
    // without a self-join that would slow the common path.
    if (q.duplicatesOnly === "true") {
      rows = rows.filter((r) => r.isCrossRequirement || r.isDuplicateFlag);
    }

    return res.json({
      success: true,
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: skip + pipelines.length < total,
        hasPrev: page > 1,
        window: windowLabel(q),
        duplicatesFiltered: q.duplicatesOnly === "true",
      },
    });
  } catch (err) {
    console.error("getCandidatesList:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/stats
//
// Aggregates over the FULL filtered set, not just the current page.
// Uses groupBy + count so it stays fast at any volume.
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidatesStats = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const where = await buildCandidateWhere(req, q);

    // Stage flags for bucketing
    const stages = await prisma.pipelineStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        label: true,
        order: true,
        isTerminal: true,
        isNearTerminal: true,
        isSourced: true,
        pipeline: true,
      },
      orderBy: { order: "asc" },
    });
    const stageById = new Map(stages.map((s) => [s.id, s]));

    const [
      total,
      byStageRaw,
      byDispRaw,
      joinedCount,
      submittedCount,
      offeredCount,
    ] = await Promise.all([
      prisma.requirementCandidatePipeline.count({ where }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["currentStageId"],
        where,
        _count: { id: true },
      }),
      prisma.requirementCandidatePipeline.groupBy({
        by: ["disposition"],
        where,
        _count: { id: true },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { AND: [where, { actualJoiningDate: { not: null } }] },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { AND: [where, { submittedAt: { not: null } }] },
      }),
      prisma.requirementCandidatePipeline.count({
        where: { AND: [where, { offerStatus: { not: null } }] },
      }),
    ]);

    // Bucket rollup from the stage groupBy
    const buckets = {
      sourced: 0,
      inPipeline: 0,
      nearClose: 0,
      placed: 0,
      offPipeline: 0,
    };
    const byStage = (byStageRaw as any[])
      .map((g) => {
        const s = stageById.get(g.currentStageId);
        const count = g._count.id;
        const b = bucketOf(s);
        if (b === "Placed") buckets.placed += count;
        else if (b === "Near close") buckets.nearClose += count;
        else if (b === "Off pipeline") buckets.offPipeline += count;
        else if (b === "Sourced") buckets.sourced += count;
        else buckets.inPipeline += count;
        return {
          stageId: g.currentStageId,
          label: s?.label ?? "Unknown",
          order: s?.order ?? 999,
          bucket: b,
          count,
          pct: total > 0 ? +((count / total) * 100).toFixed(1) : 0,
        };
      })
      .sort((a, b) => a.order - b.order);

    const byDisposition: Record<string, number> = {};
    for (const g of byDispRaw as any[]) {
      byDisposition[g.disposition] = g._count.id;
    }

    // Distinct people vs pipeline rows — the gap is the duplicate volume
    const distinctRows = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: { snapshot: { select: { candidateServiceId: true } } },
      take: 20000, // safety bound; beyond this the ratio is indicative
    });
    const distinctPeople = new Set(
      distinctRows.map((r) => r.snapshot?.candidateServiceId).filter(Boolean),
    ).size;

    return res.json({
      success: true,
      data: {
        totals: {
          total, // pipeline rows
          distinctCandidates: distinctPeople, // unique people
          duplicateRows: Math.max(0, total - distinctPeople),
          submitted: submittedCount,
          offered: offeredCount,
          joined: joinedCount,
          ...buckets,
        },
        byStage,
        byDisposition,
        rates: {
          submissionRate:
            total > 0 ? +((submittedCount / total) * 100).toFixed(1) : 0,
          offerRate:
            submittedCount > 0
              ? +((offeredCount / submittedCount) * 100).toFixed(1)
              : 0,
          joinRate:
            offeredCount > 0
              ? +((joinedCount / offeredCount) * 100).toFixed(1)
              : 0,
          placementRate:
            total > 0 ? +((buckets.placed / total) * 100).toFixed(1) : 0,
        },
      },
      meta: {
        window: windowLabel(q),
        distinctCapped: distinctRows.length >= 20000,
      },
    });
  } catch (err) {
    console.error("getCandidatesStats:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidate stats" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/filters
//
// Dropdown options, scoped to what the caller can actually see.
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidatesFilters = async (req: Request, res: Response) => {
  try {
    const orgTree = await resolveOrgTreeDown(
      req.user!.id,
      req.user!.isSuperAdmin,
    );

    const recruiterWhere =
      orgTree === null
        ? { isActive: true }
        : { isActive: true, id: { in: orgTree } };

    const [
      stages,
      recruiters,
      serviceLines,
      businessUnits,
      clients,
      mojRows,
      requirements,
    ] = await Promise.all([
      prisma.pipelineStage.findMany({
        where: { isActive: true },
        select: {
          id: true,
          label: true,
          code: true,
          order: true,
          isTerminal: true,
          isNearTerminal: true,
          isSourced: true,
          pipeline: true,
          isStandard: true,
          serviceLine: { select: { id: true, name: true } },
        },
        orderBy: { order: "asc" },
      }),
      prisma.user.findMany({
        where: recruiterWhere,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: { select: { name: true } },
        },
        orderBy: { firstName: "asc" },
        take: 500,
      }),
      prisma.serviceLine.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.businessUnit.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.client.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Distinct months of joining actually present
      prisma.requirementCandidatePipeline.findMany({
        where: {
          monthOfJoining: { not: null },
          ...(orgTree !== null ? { recruiterId: { in: orgTree } } : {}),
        },
        select: { monthOfJoining: true },
        distinct: ["monthOfJoining"],
        take: 200,
      }),
      // Requirements the caller can see, for the requirement dropdown
      prisma.requirement.findMany({
        where: {
          deletedAt: null,
          ...(orgTree !== null ? { createdById: { in: orgTree } } : {}),
        },
        select: { id: true, reqCode: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);

    // Sort MOJ chronologically, not alphabetically
    const mojOptions = mojRows
      .map((r) => r.monthOfJoining!)
      .filter(Boolean)
      .map((label) => {
        const [m, y] = label.split(" ");
        const idx = MONTHS_FULL.indexOf(m);
        const yr = parseInt(y, 10);
        return {
          label,
          value: `${yr}-${String(idx + 1).padStart(2, "0")}`,
          sort: yr * 100 + idx,
        };
      })
      .filter((o) => !isNaN(o.sort))
      .sort((a, b) => a.sort - b.sort)
      .map(({ label, value }) => ({ label, value }));

    return res.json({
      success: true,
      data: {
        stages,
        recruiters: recruiters.map((r) => ({
          id: r.id,
          label: `${r.firstName} ${r.lastName}`.trim() || r.email,
          email: r.email,
          role: r.role?.name ?? "",
        })),
        serviceLines,
        businessUnits,
        clients,
        requirements,
        mojOptions,
        buckets: [
          { value: "sourced", label: "Sourced" },
          { value: "in_pipeline", label: "In pipeline" },
          { value: "near_terminal", label: "Near close" },
          { value: "placed", label: "Placed" },
          { value: "off_pipeline", label: "Off pipeline" },
        ],
        dispositions: ["ACTIVE", "PLACED", "DROPPED", "DUPLICATE", "ON_HOLD"],
        reqStatuses: [
          "DRAFT",
          "PENDING_APPROVAL",
          "ACTIVE",
          "ON_HOLD",
          "CLOSED",
          "CANCELLED",
        ],
        snapshotTypes: ["CANDIDATE", "APPLICANT"],
      },
    });
  } catch (err) {
    console.error("getCandidatesFilters:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch filter options" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/candidates/drill
//
// Rows behind one stat card. Same filters + a bucket/stage narrowing.
// Capped, because this feeds a dialog not a report.
// ─────────────────────────────────────────────────────────────────────────────

export const getCandidatesDrill = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const where = await buildCandidateWhere(req, q);

    const pipelines = await prisma.requirementCandidatePipeline.findMany({
      where,
      select: ROW_SELECT as any,
      orderBy: buildOrderBy(q),
      take: 1000,
    });

    const csIds = [
      ...new Set(
        pipelines
          .map((p: any) => p.snapshot?.candidateServiceId)
          .filter(Boolean) as string[],
      ),
    ];
    const dupMap = await buildDuplicateMap(csIds);
    const now = Date.now();
    const rows = pipelines.map((p: any) => buildRow(p, now, dupMap));

    const stats = {
      total: rows.length,
      placed: rows.filter((r) => r.isTerminal).length,
      nearTerminal: rows.filter((r) => r.isNearTerminal && !r.isTerminal)
        .length,
      offPipeline: rows.filter((r) => !r.inPipeline).length,
      rejected: rows.filter((r) => r.isRejected).length,
      withdrawn: rows.filter((r) => r.isWithdrawn).length,
      onHold: rows.filter((r) => r.isOnHold).length,
      duplicates: rows.filter((r) => r.isCrossRequirement).length,
    };

    return res.json({
      success: true,
      data: rows,
      meta: { stats, capped: pipelines.length >= 1000, window: windowLabel(q) },
    });
  } catch (err) {
    console.error("getCandidatesDrill:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch drill data" });
  }
};
