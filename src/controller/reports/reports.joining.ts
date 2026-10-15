// File: reports.joining.ts
// Path: src/controller/reports/reports.joining.ts
//
// Month of Joining (MOJ) — from exactly two fields, never both set:
//   lastWorkingDate   → joining = LWD
//   noticePeriodDays  → joining = today + N days (moves forward as days pass)
// Placed candidates (stage.isTerminal) have their NP frozen into an LWD at
// write time, so they don't drift into future months.
//
// MOJ filtering runs IN THE DATABASE. For each selected month we compute,
// before the query, the date range and the NP-days range that lands in it:
//
//   today 15 Oct, month Nov  →  1 Nov is 17 days away, 30 Nov is 46 days away
//   WHERE lastWorkingDate BETWEEN 1 Nov AND 30 Nov
//      OR (lastWorkingDate IS NULL AND noticePeriodDays BETWEEN 17 AND 46)
//
// Every other date (expected / actual joining, stored monthOfJoining,
// legacy noticePeriod text) is ignored.

import { Prisma } from "@prisma/client";
import {
  Q,
  REPORT_TZ,
  monthKey,
  monthLabel,
  str,
  toArr,
} from "./reports.requirements.shared";

const DAY_MS = 86_400_000;

export type JoiningSource = "LWD" | "NOTICE_PERIOD";

/** Display names for the joining source — used in API + Excel */
export const JOINING_SOURCE_LABELS: Record<JoiningSource, string> = {
  LWD: "Last working day",
  NOTICE_PERIOD: "Notice period",
};

// ─────────────────────────────────────────────────────────────────────────────
// TIMEZONE HELPERS — month boundaries and "today" in the report timezone
// ─────────────────────────────────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zoneParts(d: Date) {
  const p = partsFmt.formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return {
    y: v("year"),
    m: v("month"),
    d: v("day"),
    h: v("hour"),
    min: v("minute"),
    s: v("second"),
  };
}

/** Offset of the report timezone from UTC at instant `d`, in ms */
function tzOffsetMs(d: Date): number {
  const z = zoneParts(d);
  return (
    Date.UTC(z.y, z.m - 1, z.d, z.h, z.min, z.s) -
    Math.floor(d.getTime() / 1000) * 1000
  );
}

/** Midnight of y-m-d in the report timezone, as a real instant */
function zonedMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(new Date(guess)));
}

/** Start of today in the report timezone */
export function startOfTodayZoned(now: Date = new Date()): Date {
  const z = zoneParts(now);
  return zonedMidnight(z.y, z.m, z.d);
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-ROW JOINING (display: table, drill, Excel)
// ─────────────────────────────────────────────────────────────────────────────

export interface JoiningInfo {
  date: Date | null;
  source: JoiningSource | null;
  noticeDays: number | null;
  mojKey: string | null; // YYYY-MM (report timezone)
  mojLabel: string | null; // Nov 2026
  daysToJoin: number | null; // negative = already past
}

export interface JoiningInput {
  lastWorkingDate?: Date | string | null;
  noticePeriodDays?: number | null;
}

const safeDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

export function resolveJoining(
  p: JoiningInput,
  now: Date = new Date()
): JoiningInfo {
  const today = startOfTodayZoned(now);
  const lwd = safeDate(p.lastWorkingDate);
  const np = typeof p.noticePeriodDays === "number" ? p.noticePeriodDays : null;

  let date: Date | null = null;
  let source: JoiningSource | null = null;
  if (lwd) {
    date = lwd;
    source = "LWD";
  } else if (np != null) {
    date = new Date(today.getTime() + np * DAY_MS);
    source = "NOTICE_PERIOD";
  }

  const key = date ? monthKey(date) : null;
  return {
    date,
    source,
    noticeDays: np,
    mojKey: key,
    mojLabel: key ? monthLabel(key) : null,
    daysToJoin: date
      ? Math.round(
          (startOfTodayZoned(date).getTime() - today.getTime()) / DAY_MS
        )
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOJ FILTER → DB WHERE
//   ?mojMonth=2026-11&mojMonth=2026-12   (multi)
//   ?mojYear=2026                          (whole year, when no months)
// ─────────────────────────────────────────────────────────────────────────────

export interface MojRange {
  label: string;
  start: Date; // first instant of the period (report timezone)
  end: Date; // last instant of the period
  minNoticeDays: number; // NP that lands on/after start
  maxNoticeDays: number; // NP that lands on/before end (negative = period is over)
}

function rangeFor(
  label: string,
  y1: number,
  m1: number,
  y2: number,
  m2: number,
  today: Date
): MojRange {
  const start = zonedMidnight(y1, m1, 1);
  const next =
    m2 === 12 ? zonedMidnight(y2 + 1, 1, 1) : zonedMidnight(y2, m2 + 1, 1);
  const end = new Date(next.getTime() - 1);
  return {
    label,
    start,
    end,
    minNoticeDays: Math.max(
      0,
      Math.ceil((start.getTime() - today.getTime()) / DAY_MS)
    ),
    maxNoticeDays: Math.floor((end.getTime() - today.getTime()) / DAY_MS),
  };
}

export function buildMojRanges(
  q: Q,
  now: Date = new Date()
): MojRange[] | null {
  const today = startOfTodayZoned(now);
  const months = toArr(q.mojMonth).filter((m) => /^\d{4}-\d{2}$/.test(m));
  if (months.length) {
    return months.map((key) => {
      const [y, m] = key.split("-").map(Number);
      return rangeFor(key, y, m, y, m, today);
    });
  }
  const year = str(q.mojYear);
  if (year && /^\d{4}$/.test(year))
    return [rangeFor(year, +year, 1, +year, 12, today)];
  return null;
}

/** The OR query: LWD inside the period, or no LWD and NP days inside the period */
export function mojPipelineWhere(
  ranges: MojRange[] | null
): Prisma.RequirementCandidatePipelineWhereInput | null {
  if (!ranges?.length) return null;
  return {
    OR: ranges.flatMap((r) => [
      { lastWorkingDate: { gte: r.start, lte: r.end } },
      ...(r.maxNoticeDays >= 0
        ? [
            {
              lastWorkingDate: null,
              noticePeriodDays: { gte: r.minNoticeDays, lte: r.maxNoticeDays },
            },
          ]
        : []),
    ]),
  };
}
