// File: backfill-notice-period.ts
// Path: src/scripts/backfill-notice-period.ts
//
// One-time cleanup: legacy free-text `noticePeriod` → clean
// `lastWorkingDate` XOR `noticePeriodDays`.
//
// SOURCE OF TRUTH = pipeline stage flags. Nothing else.
//   freeze point = candidate PLACED = currentStage.isTerminal
//   dropped / off-pipeline, disposition, isRejected, isWithdrawn are IGNORED.
//
//   Dry run (default — read-only, writes two CSVs, touches nothing):
//     npx tsx src/scripts/backfill-notice-period.ts
//   Apply (after you've checked the CSVs):
//     npx tsx src/scripts/backfill-notice-period.ts --apply
//
// Rules, in order:
//   1. LWD already set                      → keep LWD, noticePeriodDays = null
//   2. NP text contains a full date         → lastWorkingDate = that date
//   3. NP text has day + month, no year     → lastWorkingDate, year from row's createdAt   [ASSUMED_YEAR]
//   4. Immediate / imm / immedate           → noticePeriodDays = 0
//   5. "N months" / "N weeks"               → days (×30 / ×7)
//   6. Plain number ("30", "15 days")       → noticePeriodDays = N (0–365)
//   7. Anything else                        → left as is, listed                            [MANUAL]
//   FREEZE: result is NP days AND the candidate is placed (isTerminal stage)
//           → lastWorkingDate = date they ENTERED that stage + NP days, NP cleared
//             (entry date = latest stage log into the current stage; falls back to stageUpdatedAt)
//
// Idempotent: re-running after --apply produces no further changes.
// The legacy `noticePeriod` text is never modified.

import fs from "fs";
import path from "path";
import prisma from "@/utils/prisma/client";

const APPLY = process.argv.includes("--apply");
const BATCH = 200;
const MAX_NOTICE_DAYS = 365;
const DAY_MS = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// PARSING
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const monthNo = (word: string) => MONTHS[word.slice(0, 3).toLowerCase()];

const UNIT_DAYS: { pattern: RegExp; days: number }[] = [
  { pattern: /(\d+(?:\.\d+)?)\s*(?:months?|mnths?)/, days: 30 },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:weeks?|wks?)/, days: 7 },
];

function makeDate(y: number, m: number, d: number): Date | null {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? date : null; // rejects 31 Feb etc.
}

/** Full dates in the formats found in the data */
function parseFullDate(t: string): Date | null {
  // 24-09-2026 · 30.09.2026 · 01/10/2026
  let m = t.match(/(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4})/);
  if (m) return makeDate(+m[3], +m[2], +m[1]);
  // 5-Oct-2026 · 30 TH SEP 2026 · 31 July 2026 · 09OCT2026
  m = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?[\s-]*([a-z]{3,9})[\s,.-]*(\d{4})/);
  if (m && monthNo(m[2])) return makeDate(+m[3], monthNo(m[2]), +m[1]);
  // Nov 18th 2026 · oct 16 2026 · Oct 16, 2026 · Oct-10-2026 · sep 232026
  m = t.match(/([a-z]{3,9})[\s:_-]*(\d{1,2})(?:st|nd|rd|th)?[\s,.-]*(\d{4})/);
  if (m && monthNo(m[1])) return makeDate(+m[3], monthNo(m[1]), +m[2]);
  return null;
}

/** Day + month without a year: "sep29 lwd", "12th oct", "Lwd:Sep 30", "LWD Sep/25" */
function parseNoYearDate(t: string, fallbackYear: number): Date | null {
  let m = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?[\s_-]*([a-z]{3,9})/);
  if (m && monthNo(m[2])) return makeDate(fallbackYear, monthNo(m[2]), +m[1]);
  m = t.match(/([a-z]{3,9})[\s:_/-]*(\d{1,2})(?!\d)/);
  if (m && monthNo(m[1])) return makeDate(fallbackYear, monthNo(m[1]), +m[2]);
  return null;
}

type Rule =
  | "LWD_KEPT"
  | "DATE"
  | "ASSUMED_YEAR"
  | "IMMEDIATE"
  | "UNIT"
  | "DAYS"
  | "MANUAL"
  | "EMPTY";

/** Legacy row → clean values, before the freeze step */
function parseRow(row: {
  noticePeriod: string | null;
  lastWorkingDate: Date | null;
  createdAt: Date;
}): {
  lastWorkingDate: Date | null;
  noticePeriodDays: number | null;
  rule: Rule;
} {
  if (row.lastWorkingDate)
    return {
      lastWorkingDate: row.lastWorkingDate,
      noticePeriodDays: null,
      rule: "LWD_KEPT",
    };

  const raw = (row.noticePeriod ?? "").trim();
  if (!raw)
    return { lastWorkingDate: null, noticePeriodDays: null, rule: "EMPTY" };
  const t = raw.toLowerCase().replace(/["']/g, "");

  const full = parseFullDate(t);
  if (full)
    return { lastWorkingDate: full, noticePeriodDays: null, rule: "DATE" };

  if (/\bimm/.test(t))
    return { lastWorkingDate: null, noticePeriodDays: 0, rule: "IMMEDIATE" };

  const noYear = parseNoYearDate(t, row.createdAt.getUTCFullYear());
  if (noYear)
    return {
      lastWorkingDate: noYear,
      noticePeriodDays: null,
      rule: "ASSUMED_YEAR",
    };

  for (const u of UNIT_DAYS) {
    const m = t.match(u.pattern);
    if (m)
      return {
        lastWorkingDate: null,
        noticePeriodDays: Math.round(parseFloat(m[1]) * u.days),
        rule: "UNIT",
      };
  }

  const m = t.match(/^(\d{1,3})\s*(?:days?)?$/);
  if (m && +m[1] <= MAX_NOTICE_DAYS)
    return { lastWorkingDate: null, noticePeriodDays: +m[1], rule: "DAYS" };

  return { lastWorkingDate: null, noticePeriodDays: null, rule: "MANUAL" };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────────────────────────

async function loadRows() {
  return prisma.requirementCandidatePipeline.findMany({
    where: {
      OR: [
        { noticePeriod: { not: null } },
        { lastWorkingDate: { not: null } },
        { noticePeriodDays: { not: null } },
      ],
    },
    select: {
      id: true,
      noticePeriod: true,
      noticePeriodDays: true,
      lastWorkingDate: true,
      createdAt: true,
      stageUpdatedAt: true,
      currentStageId: true,
      currentStage: { select: { label: true, isTerminal: true } },
      // newest first — the latest real move into the current stage = when they got there
      stageHistory: {
        select: { createdAt: true, fromStageId: true, toStageId: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];

/** Freeze point = placed (terminal stage) only */
const isSettled = (r: Row) => !!r.currentStage?.isTerminal;

/** When the candidate entered their current stage. Ignores same-stage logs (transfer / reject notes). */
function stageEntry(r: Row): {
  at: Date;
  source: "STAGE_LOG" | "STAGE_UPDATED_AT";
} {
  const entry = r.stageHistory.find(
    (l) => l.toStageId === r.currentStageId && l.fromStageId !== l.toStageId
  );
  return entry
    ? { at: entry.createdAt, source: "STAGE_LOG" }
    : { at: r.stageUpdatedAt, source: "STAGE_UPDATED_AT" };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN
// ─────────────────────────────────────────────────────────────────────────────

interface Planned {
  row: Row;
  rule: Rule;
  frozen: boolean;
  anchor: string;
  lastWorkingDate: Date | null;
  noticePeriodDays: number | null;
  changed: boolean;
}

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

function planRow(r: Row): Planned {
  const parsed = parseRow(r);
  const actionable = parsed.rule !== "MANUAL" && parsed.rule !== "EMPTY";

  // MANUAL / EMPTY rows are left exactly as they are
  if (!actionable)
    return {
      row: r,
      rule: parsed.rule,
      frozen: false,
      anchor: "",
      lastWorkingDate: r.lastWorkingDate,
      noticePeriodDays: r.noticePeriodDays,
      changed: false,
    };

  let { lastWorkingDate, noticePeriodDays } = parsed;
  let frozen = false;
  let anchor = "";

  if (noticePeriodDays != null && isSettled(r)) {
    const entry = stageEntry(r);
    lastWorkingDate = new Date(entry.at.getTime() + noticePeriodDays * DAY_MS);
    anchor = `${entry.source} ${iso(entry.at)}`;
    noticePeriodDays = null;
    frozen = true;
  }

  const changed =
    iso(r.lastWorkingDate) !== iso(lastWorkingDate) ||
    (r.noticePeriodDays ?? null) !== noticePeriodDays;

  return {
    row: r,
    rule: parsed.rule,
    frozen,
    anchor,
    lastWorkingDate,
    noticePeriodDays,
    changed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function writeCsv(file: string, header: string[], rows: unknown[][]) {
  const out = path.resolve(process.cwd(), file);
  fs.writeFileSync(
    out,
    [header.map(csv).join(","), ...rows.map((r) => r.map(csv).join(","))].join(
      "\n"
    )
  );
  return out;
}

function report(plans: Planned[]) {
  const tag = APPLY ? "applied" : "dryrun";

  const byRule: Record<string, number> = {};
  const frozenByStage: Record<string, number> = {};
  const end = { LWD_ONLY: 0, NP_ONLY: 0, BOTH: 0, NEITHER: 0 };
  let frozen = 0;
  let changed = 0;

  for (const p of plans) {
    byRule[p.rule] = (byRule[p.rule] ?? 0) + 1;
    if (p.frozen) {
      frozen++;
      const k = p.row.currentStage?.label ?? "Unknown stage";
      frozenByStage[k] = (frozenByStage[k] ?? 0) + 1;
    }
    if (p.changed) changed++;
    const hasLwd = !!p.lastWorkingDate;
    const hasNp = p.noticePeriodDays != null;
    if (hasLwd && hasNp) end.BOTH++;
    else if (hasLwd) end.LWD_ONLY++;
    else if (hasNp) end.NP_ONLY++;
    else end.NEITHER++;
  }

  console.log(
    `\n${APPLY ? "APPLY" : "DRY RUN"} — ${
      plans.length
    } rows with any notice / LWD data`
  );
  console.log("\nHow each row was read:");
  console.table(byRule);
  console.log(`\nFrozen into LWD (placed — stage isTerminal): ${frozen}`);
  if (frozen) console.table(frozenByStage);
  console.log("\nEnd state:");
  console.table(end);
  console.log(`Rows that will change: ${changed}`);

  const all = writeCsv(
    `notice-period-backfill-${tag}.csv`,
    [
      "pipelineId",
      "stage",
      "placed (isTerminal)",
      "legacy noticePeriod text",
      "old LWD",
      "old noticePeriodDays",
      "rule",
      "frozen",
      "freeze anchor",
      "new LWD",
      "new noticePeriodDays",
      "will change",
    ],
    plans.map((p) => [
      p.row.id,
      p.row.currentStage?.label ?? "",
      p.row.currentStage?.isTerminal ? "yes" : "no",
      p.row.noticePeriod ?? "",
      iso(p.row.lastWorkingDate),
      p.row.noticePeriodDays ?? "",
      p.rule,
      p.frozen ? "yes" : "",
      p.anchor,
      iso(p.lastWorkingDate),
      p.noticePeriodDays ?? "",
      p.changed ? "yes" : "",
    ])
  );

  const review = plans.filter(
    (p) => p.rule === "MANUAL" || p.rule === "ASSUMED_YEAR"
  );
  const reviewFile = writeCsv(
    `notice-period-backfill-${tag}-REVIEW.csv`,
    [
      "pipelineId",
      "stage",
      "legacy noticePeriod text",
      "rule",
      "proposed LWD",
      "proposed noticePeriodDays",
    ],
    review.map((p) => [
      p.row.id,
      p.row.currentStage?.label ?? "",
      p.row.noticePeriod ?? "",
      p.rule,
      p.rule === "MANUAL" ? "" : iso(p.lastWorkingDate),
      p.rule === "MANUAL" ? "" : p.noticePeriodDays ?? "",
    ])
  );

  console.log(`\nFull report:   ${all}`);
  console.log(
    `Needs a look:  ${reviewFile} (${review.length} rows — MANUAL is skipped, ASSUMED_YEAR will be applied)\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const plans = (await loadRows()).map(planRow);
  report(plans);
  if (!APPLY) return;

  const changes = plans.filter((p) => p.changed);
  for (let i = 0; i < changes.length; i += BATCH) {
    const chunk = changes.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((p) =>
        prisma.requirementCandidatePipeline.update({
          where: { id: p.row.id },
          data: {
            lastWorkingDate: p.lastWorkingDate,
            noticePeriodDays: p.noticePeriodDays,
          },
        })
      )
    );
    console.log(
      `Updated ${Math.min(i + BATCH, changes.length)} / ${changes.length}`
    );
  }

  const both = await prisma.requirementCandidatePipeline.count({
    where: { lastWorkingDate: { not: null }, noticePeriodDays: { not: null } },
  });
  console.log(
    `\nRows with BOTH set after apply: ${both}  (must be 0 before adding the check constraint)`
  );
  console.log(
    `Run the dry run again — "Rows that will change" should now be 0.\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
