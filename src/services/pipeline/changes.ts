// File: changes.ts
// Path: src/services/pipeline/changes.ts
//
// What one run did to each CRM row, kept on the run (viewData.changes) so the
// results page can mark it: new, changed (old → new), already there, kept the
// CRM value (engine said something else), locked by a person.

export type FieldChange = { field: string; from: string | null; to: string | null };

export type ChangeRow = {
  kind: "spocs" | "offices" | "financials" | "programs" | "documents" | "outreach";
  change: "added" | "updated" | "same" | "kept" | "locked";
  id?: string | null;
  label: string;
  sub?: string | null;
  fields?: FieldChange[];
};

/** at most this many rows are kept on a run */
export const MAX_CHANGES = 1000;

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** one comparable text form: Decimal 1000.00 and number 1000 are both "1000" */
export const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v).trim();
  if (!s) return null;
  return NUMERIC.test(s) ? String(Number(s)) : s;
};

/** the fields whose value changes from cur to next (fields not sent are skipped) */
export const diffFields = (
  cur: Record<string, unknown> | null,
  next: Record<string, unknown>,
  fields: readonly string[],
): FieldChange[] =>
  fields.flatMap((f) => {
    if (next[f] === undefined) return [];
    const from = norm(cur?.[f]);
    const to = norm(next[f]);
    return from === to ? [] : [{ field: f, from, to }];
  });
