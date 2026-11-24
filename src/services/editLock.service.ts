// File: editLock.service.ts
// Path: src/services/editLock.service.ts
//
// The edit rule (21 Nov 2026): data that is already filled is changed or removed only by a super admin.
// Everyone else (with the normal permission) may FILL an empty field and ADD new rows — offices,
// CSR years, programmes, notes, documents … — but not change or delete what is there.
// Daily work is not data: sales status, call status, tasks, meetings, assignments, approvals,
// key-account stars stay changeable as before (callers list those fields as `work`).

import { ApiError } from "@/utils/httpError";

type Who = { isSuperAdmin?: boolean | null };

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const norm = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === "object" && v !== null && "toFixed" in v ? Number(v as never).toString() : typeof v === "number" ? String(v) : String(v ?? "");

/**
 * Throws 403 EDIT_LOCKED when a non-super-admin changes a field that already has a value.
 * Arrays (service lines, projects): adding is fine, removing an existing item is a change.
 */
export function assertFillOnly(
  user: Who,
  before: Record<string, unknown>,
  data: Record<string, unknown>,
  work: readonly string[] = [],
) {
  if (user.isSuperAdmin) return;
  const blocked: string[] = [];
  for (const [k, next] of Object.entries(data)) {
    if (next === undefined || work.includes(k)) continue;
    const old = before[k];
    if (Array.isArray(old)) {
      const keep = new Set((Array.isArray(next) ? next : []).map(norm));
      if (old.some((x) => !keep.has(norm(x)))) blocked.push(k);
      continue;
    }
    if (empty(old) || norm(old) === norm(next)) continue;
    blocked.push(k);
  }
  if (blocked.length)
    throw ApiError(
      403,
      `Only a super admin can change values that are already filled (${blocked.join(", ")}). You can fill empty fields and add new entries.`,
      "EDIT_LOCKED",
    );
}

/** editing / deleting an existing row (office, programme, note, document, figure year …) */
export function assertSuperAdmin(user: Who, what: string) {
  if (!user.isSuperAdmin) throw ApiError(403, `Only a super admin can ${what}. You can add new entries.`, "EDIT_LOCKED");
}
