// File: lookups.ts
// Path: src/config/lookups.ts
//
// Lookup.type values. Labels/rows are admin-editable; the types are not.

export const LOOKUP_TYPES = [
  "INDUSTRY",
  "CLIENT_CATEGORY",
  "LOCATION_TYPE",
  "TECH_CATEGORY",
  "DOCUMENT_TYPE",
  "SPOC_SOURCE",
  "EMAIL_SOURCE",
  "SALES_STATUS",
  "PROGRAM_SECTOR",
] as const;

export type LookupType = (typeof LOOKUP_TYPES)[number];
