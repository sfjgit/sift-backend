// File: moj.utils.ts
// Path: src/utils/moj.utils.ts
//
// Single source of truth for Month of Joining helpers.
// Used by reports.controller.ts, reports.recruiter.stats.controller.ts,
// reports.recruiter.drill.controller.ts.

export const MONTH_NAMES = [
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
] as const;

export type MojMonthValue =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "08"
  | "09"
  | "10"
  | "11"
  | "12";

/**
 * Convert "2025-09" → "September 2025"
 * Returns null if the input is invalid.
 */
export function mojMonthToLabel(mojMonth: string): string | null {
  const parts = mojMonth.split("-");
  const year = parts[0];
  const monthIdx = parseInt(parts[1] ?? "0", 10) - 1;
  if (!year || monthIdx < 0 || monthIdx > 11) return null;
  return `${MONTH_NAMES[monthIdx]} ${year}`;
}

/**
 * Build the Prisma where clause fragment for mojMonth / mojYear filters.
 * Returns null if neither param is set.
 *
 * Attach the result to your pipelineWhere directly:
 *   const mojWhere = buildMojWhere(q);
 *   if (mojWhere) Object.assign(pipelineWhere, mojWhere);
 */
export function buildMojWhere(
  q: Record<string, string | string[] | undefined>
): Record<string, any> | null {
  const mojMonth = Array.isArray(q.mojMonth) ? q.mojMonth[0] : q.mojMonth;
  const mojYear = Array.isArray(q.mojYear) ? q.mojYear[0] : q.mojYear;

  if (mojMonth) {
    const label = mojMonthToLabel(mojMonth);
    if (label) return { monthOfJoining: label };
    return null;
  }

  if (mojYear) {
    return { monthOfJoining: { contains: mojYear } };
  }

  return null;
}
