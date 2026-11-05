// File: lookups.ts
// Path: src/config/lookups.ts
//
// Lookup.type values. Labels/rows are admin-editable; the types are not.

import { OTHER_SECTOR, SCHEDULE_VII_SECTORS } from "./csr";
import { PIPELINE_LOOKUPS } from "./pipeline";

export const LOOKUP_TYPES = [
  "INDUSTRY",
  "CLIENT_CATEGORY",
  // head-count band — meta { min, max } lets the CRM pick it from the employee count
  "EMPLOYEE_SIZE",
  "LOCATION_TYPE",
  "TECH_CATEGORY",
  "DOCUMENT_TYPE",
  "SPOC_SOURCE",
  "EMAIL_SOURCE",
  "SALES_STATUS",
  "PROGRAM_SECTOR",
] as const;

export type LookupType = (typeof LOOKUP_TYPES)[number];

export type DefaultLookup = { code: string; label: string; meta?: Record<string, number | null> };

// What every tenant starts with (seed + new tenants). Codes the code relies on
// (BRANCH, OTHER, the pipeline's) are system rows: renamable, not deletable.
export const SYSTEM_LOOKUPS: Partial<Record<LookupType, DefaultLookup[]>> = {
  ...(PIPELINE_LOOKUPS as Partial<Record<LookupType, DefaultLookup[]>>),
  DOCUMENT_TYPE: [...(PIPELINE_LOOKUPS.DOCUMENT_TYPE ?? []), { code: "OTHER", label: "Other attachment" }],
  LOCATION_TYPE: [
    { code: "HQ", label: "Head office" },
    { code: "REGISTERED_OFFICE", label: "Registered office" },
    { code: "BRANCH", label: "Branch office" },
    { code: "DEV_CENTER", label: "Development centre" },
    { code: "PLANT", label: "Plant / factory" },
    { code: "OFFICE", label: "Other office" },
  ],
};

export const DEFAULT_LOOKUPS: Partial<Record<LookupType, DefaultLookup[]>> = {
  EMPLOYEE_SIZE: [
    { code: "E_1_10", label: "1–10", meta: { min: 1, max: 10 } },
    { code: "E_11_50", label: "11–50", meta: { min: 11, max: 50 } },
    { code: "E_51_200", label: "51–200", meta: { min: 51, max: 200 } },
    { code: "E_201_500", label: "201–500", meta: { min: 201, max: 500 } },
    { code: "E_501_1000", label: "501–1,000", meta: { min: 501, max: 1000 } },
    { code: "E_1001_5000", label: "1,001–5,000", meta: { min: 1001, max: 5000 } },
    { code: "E_5001_10000", label: "5,001–10,000", meta: { min: 5001, max: 10000 } },
    { code: "E_10001_PLUS", label: "10,000+", meta: { min: 10001, max: null } },
  ],
  // Schedule VII activities — CSR programme sectors
  PROGRAM_SECTOR: [...SCHEDULE_VII_SECTORS.map(({ code, label }) => ({ code, label })), OTHER_SECTOR],
};
