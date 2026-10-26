// File: names.ts
// Path: src/utils/names.ts

// normalized full name — SPOC dedupe key per client
export const toNameKey = (first: string, last?: string | null) =>
  `${first} ${last ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
