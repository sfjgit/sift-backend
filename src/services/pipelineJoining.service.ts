// File: pipelineJoining.service.ts
// Path: src/services/pipelineJoining.service.ts
//
// The ONLY way pipeline code should write notice period / last working day.
//
//   normalizeJoiningInput(body)  → use in every create / update handler
//     - both sent with values     → 400 "either LWD or notice period"
//     - LWD sent                  → { lastWorkingDate, noticePeriodDays: null }
//     - notice period sent        → { noticePeriodDays, lastWorkingDate: null }
//     - one sent as null / ""     → clears just that one
//     - neither sent              → {} (nothing changes)
//
//   freezeNoticeOnSettle(current) → use when a candidate is PLACED (moves into an
//     isTerminal stage). NP-only candidates get
//     LWD = now + NP days and NP is cleared, so they stop drifting month to month.
//
// The legacy `noticePeriod` text column is never written.

const DAY_MS = 86_400_000;

/** Allowed notice periods (days). Configurable: NOTICE_PERIOD_DAY_OPTIONS="0,15,30,45,60,90" */
export const NOTICE_PERIOD_DAY_OPTIONS: number[] = (
  process.env.NOTICE_PERIOD_DAY_OPTIONS ?? "0,15,30,45,60,90"
)
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 0)
  .sort((a, b) => a - b);

/** Hard bounds — matches the DB check constraint */
export const NOTICE_PERIOD_MAX_DAYS = 365;

/** When true, only values in NOTICE_PERIOD_DAY_OPTIONS are accepted (dropdown only) */
const OPTIONS_ONLY = process.env.NOTICE_PERIOD_OPTIONS_ONLY === "true";

export class JoiningInputError extends Error {
  status = 400;
}

export interface JoiningPatch {
  lastWorkingDate?: Date | null;
  noticePeriodDays?: number | null;
}

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const has = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function toDate(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime()))
    throw new JoiningInputError("Last working day is not a valid date.");
  return d;
}

function toNoticeDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > NOTICE_PERIOD_MAX_DAYS)
    throw new JoiningInputError(
      `Notice period must be a whole number of days between 0 and ${NOTICE_PERIOD_MAX_DAYS}.`
    );
  if (OPTIONS_ONLY && !NOTICE_PERIOD_DAY_OPTIONS.includes(n))
    throw new JoiningInputError(
      `Notice period must be one of: ${NOTICE_PERIOD_DAY_OPTIONS.join(
        ", "
      )} days.`
    );
  return n;
}

/**
 * Legacy `noticePeriod` (old frontend) → days, while the frontend is migrated.
 * Accepts "30", "30 days", "Immediate". Anything else → 400.
 */
function legacyNoticeToDays(v: unknown): number | null {
  if (isBlank(v)) return null;
  const t = String(v).trim().toLowerCase();
  if (/^imm/.test(t)) return 0;
  const m = t.match(/^(\d{1,3})\s*(?:days?)?$/);
  if (m) return Number(m[1]);
  throw new JoiningInputError(
    "Notice period must be a number of days (e.g. 30) or Immediate."
  );
}

/**
 * Accepts `lastWorkingDate` and `noticePeriodDays` from a request body.
 * Spread the result straight into the Prisma `data`.
 */
export function normalizeJoiningInput(
  rawBody: Record<string, unknown>
): JoiningPatch {
  const body = { ...rawBody };
  // Old frontend sends `noticePeriod` text — map it onto noticePeriodDays
  if (has(body, "noticePeriod") && !has(body, "noticePeriodDays")) {
    body.noticePeriodDays = legacyNoticeToDays(body.noticePeriod);
  }
  delete body.noticePeriod;

  const lwdSent = has(body, "lastWorkingDate");
  const npSent = has(body, "noticePeriodDays");
  const lwdValue = lwdSent && !isBlank(body.lastWorkingDate);
  const npValue = npSent && !isBlank(body.noticePeriodDays);

  if (lwdValue && npValue)
    throw new JoiningInputError(
      "Give either the last working day or the notice period, not both."
    );

  if (lwdValue)
    return {
      lastWorkingDate: toDate(body.lastWorkingDate),
      noticePeriodDays: null,
    };
  if (npValue)
    return {
      noticePeriodDays: toNoticeDays(body.noticePeriodDays),
      lastWorkingDate: null,
    };

  const patch: JoiningPatch = {};
  if (lwdSent) patch.lastWorkingDate = null; // explicit clear
  if (npSent) patch.noticePeriodDays = null; // explicit clear
  return patch;
}

/**
 * Call when the candidate is placed (moves into an isTerminal stage). Returns the patch to merge into the same update.
 */
export function freezeNoticeOnSettle(
  current: { lastWorkingDate: Date | null; noticePeriodDays: number | null },
  at: Date = new Date()
): JoiningPatch {
  if (current.lastWorkingDate || current.noticePeriodDays == null) return {};
  return {
    lastWorkingDate: new Date(at.getTime() + current.noticePeriodDays * DAY_MS),
    noticePeriodDays: null,
  };
}

/** Freeze point = candidate PLACED (stage.isTerminal). Dropped / off-pipeline is ignored for now. */
export function isSettledStage(
  stage: { isTerminal?: boolean | null } | null | undefined
): boolean {
  return !!stage?.isTerminal;
}
