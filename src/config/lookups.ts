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
  // project tags on clients and SPOCs (NASSCOM, STPI, AWS-Restart…)
  "PROJECT",
  // SPOC profile (CASPA "Additional SPOC details")
  "SPOC_ROLE",
  "DECISION_AUTHORITY",
  "ORG_TYPE",
  "REVENUE_BAND",
  // client add-ons (21 Nov 2026)
  "CSR_ROLE",
  "GOVT_ORG_TYPE",
] as const;

export type LookupType = (typeof LOOKUP_TYPES)[number];

export type DefaultLookup = { code: string; label: string; meta?: Record<string, number | null> };

// What every tenant starts with (seed + new tenants). Codes the code relies on
// (BRANCH, OTHER, the pipeline's) are system rows: renamable, not deletable.
export const SYSTEM_LOOKUPS: Partial<Record<LookupType, DefaultLookup[]>> = {
  ...(PIPELINE_LOOKUPS as Partial<Record<LookupType, DefaultLookup[]>>),
  DOCUMENT_TYPE: [...(PIPELINE_LOOKUPS.DOCUMENT_TYPE ?? []), { code: "OTHER", label: "Other attachment" }],
  PROJECT: [
    { code: "NASSCOM", label: "NASSCOM" },
    { code: "STPI", label: "STPI" },
    { code: "AWS_RESTART", label: "AWS-Restart" },
  ],
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
  // a client's part in CSR (ClientCsr.csrRoleId)
  CSR_ROLE: [
    { code: "DONOR", label: "Donor" },
    { code: "IMPLEMENTING_AGENCY", label: "Implementing agency" },
    { code: "FOUNDATION", label: "Foundation" },
  ],
  // government body types (ClientGovt.orgTypeId) — the B2G register's org_type codes
  GOVT_ORG_TYPE: [
    { code: "MINISTRY", label: "Ministry" },
    { code: "CENT_DEPT", label: "Central department" },
    { code: "CENT_BODY", label: "Central body / council" },
    { code: "CPSU", label: "Central PSU" },
    { code: "STATE_DEPT", label: "State department" },
    { code: "STATE_DIR", label: "State directorate" },
    { code: "SPSU", label: "State PSU" },
    { code: "STATE_MISSION", label: "State skill mission" },
    { code: "SSC", label: "Sector skill council" },
    { code: "DEV_AUTHORITY", label: "Development authority" },
    { code: "URBAN_TRANSPORT", label: "Urban / transport body" },
    { code: "WATER_BOARD", label: "Water / sewerage board" },
    { code: "DIST_ADMIN", label: "District administration" },
    { code: "DIST_OFFICE", label: "District office" },
    { code: "ULB", label: "Urban local body / municipal" },
    { code: "PRI", label: "Panchayati Raj institution" },
    { code: "COMMISSION", label: "Commission" },
    { code: "ACADEMIC", label: "Academic body" },
    { code: "OTHER", label: "Other government body" },
  ],
  SPOC_ROLE: [
    { code: "FINAL_DECISION_MAKER", label: "Final Decision Maker" },
    { code: "KEY_INFLUENCER", label: "Key Influencer" },
    { code: "INFLUENCER", label: "Influencer" },
    { code: "GATEKEEPER", label: "Gatekeeper" },
    { code: "EXECUTION_OWNER", label: "Execution Owner" },
  ],
  DECISION_AUTHORITY: [
    { code: "FINAL_APPROVAL", label: "Final Approval" },
    { code: "BUDGET_OWNER", label: "Budget Owner" },
    { code: "VENDOR_SELECTION", label: "Vendor Selection" },
    { code: "PROGRAM_DESIGN", label: "Program Design" },
    { code: "EXECUTION", label: "Execution" },
    { code: "COMPLIANCE_APPROVAL", label: "Compliance Approval" },
  ],
  ORG_TYPE: [
    { code: "CORPORATE", label: "Corporate" },
    { code: "CORPORATE_FOUNDATION", label: "Corporate Foundation" },
    { code: "TRUST", label: "Trust" },
  ],
  REVENUE_BAND: [
    { code: "R_0_1L", label: "Up to ₹1 lakh" },
    { code: "R_1L_5L", label: "₹1 – 5 lakh" },
    { code: "R_5L_10L", label: "₹5 – 10 lakh" },
    { code: "R_10L_20L", label: "₹10 – 20 lakh" },
    { code: "R_20L_50L", label: "₹20 – 50 lakh" },
    { code: "R_50L_1CR", label: "₹50 lakh – 1 crore" },
    { code: "R_1CR_PLUS", label: "₹1 crore +" },
  ],
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
