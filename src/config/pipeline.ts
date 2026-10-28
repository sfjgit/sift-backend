// File: pipeline.ts
// Path: src/config/pipeline.ts
//
// The CSR pipeline engine's steps as the CRM knows them. Seeded into
// PipelineStep (key = CRM key). `engineStage` is the engine's stable stage key;
// approval is not a step — it is a CRM action (POST /spocs/approval).
//
// Contract with the engine: docs/PIPELINE_INTEGRATION.md

export const CSR_PIPELINE = "CSR_PIPELINE";

// what a step's results may write — the ingest service refuses everything else
export type ResultKind = "documents" | "spocs" | "financials" | "programs" | "outreach";

export type StepDef = {
  key: string;
  label: string;
  uiOrder: number;
  engineStage: string | null; // null = orchestrated by the CRM, never dispatched
  writes: readonly ResultKind[];
  createsSpocs: boolean; // needs BU + SL for the new rows
  spocInput: "none" | "all" | "approved"; // which of the client's SPOCs go in the job
  defaultLimit: number | null; // clients per user, null = unlimited
  defaultRerunDays: number | null; // no re-run within N days unless the input changed
};

export const PIPELINE_STEPS: readonly StepDef[] = [
  {
    key: "reports",
    label: "Find CSR reports",
    uiOrder: 1,
    engineStage: "reports_spocs",
    writes: ["documents"],
    createsSpocs: false,
    spocInput: "none",
    defaultLimit: null,
    defaultRerunDays: 90,
  },
  {
    key: "report_spocs",
    label: "SPOCs from reports",
    uiOrder: 2,
    engineStage: "report_spocs",
    writes: ["spocs"],
    createsSpocs: true,
    spocInput: "all",
    defaultLimit: null,
    defaultRerunDays: 90,
  },
  {
    key: "figures",
    label: "CSR figures & programs",
    uiOrder: 3,
    engineStage: "figures",
    writes: ["financials", "programs"],
    createsSpocs: false,
    spocInput: "none",
    defaultLimit: null,
    defaultRerunDays: 90,
  },
  {
    key: "enrich",
    label: "LinkedIn & email search",
    uiOrder: 4,
    engineStage: "enrich",
    writes: ["spocs"],
    createsSpocs: true,
    spocInput: "all",
    defaultLimit: 20,
    defaultRerunDays: 30,
  },
  {
    key: "apollo",
    label: "Apollo decision-makers",
    uiOrder: 5,
    engineStage: "apollo",
    writes: ["spocs"],
    createsSpocs: true,
    spocInput: "all",
    defaultLimit: 20,
    defaultRerunDays: 30,
  },
  {
    key: "validate",
    label: "Validate & score SPOCs",
    uiOrder: 6,
    engineStage: "validate",
    writes: ["spocs"],
    createsSpocs: false,
    spocInput: "all",
    defaultLimit: null,
    defaultRerunDays: 14,
  },
  {
    key: "emails",
    label: "Write outreach emails",
    uiOrder: 8,
    engineStage: "emails",
    writes: ["outreach"],
    createsSpocs: false,
    spocInput: "approved",
    defaultLimit: 50,
    defaultRerunDays: 30,
  },
  {
    key: "run_all",
    label: "Run all steps",
    uiOrder: 0,
    engineStage: null,
    writes: [],
    createsSpocs: true,
    spocInput: "none",
    defaultLimit: null,
    defaultRerunDays: null,
  },
] as const;

// "Run all steps" stops before approval — a person decides who gets outreach
export const RUN_ALL_DEFAULT = ["reports", "report_spocs", "figures", "enrich", "apollo", "validate"];

export const stepDef = (key: string) => PIPELINE_STEPS.find((s) => s.key === key);

// SPOC_SOURCE / EMAIL_SOURCE / DOCUMENT_TYPE codes the engine sends; seeded as system lookups
export const PIPELINE_LOOKUPS: Record<string, { code: string; label: string }[]> = {
  SPOC_SOURCE: [
    { code: "REPORT", label: "Annual / CSR report" },
    { code: "LINKEDIN", label: "LinkedIn" },
    { code: "APOLLO", label: "Apollo" },
    { code: "WEB_SEARCH", label: "Web search" },
    { code: "MANUAL", label: "Added by hand" },
  ],
  EMAIL_SOURCE: [
    { code: "REPORT", label: "Report" },
    { code: "WEB_SEARCH", label: "Web search" },
    { code: "APOLLO", label: "Apollo" },
  ],
  DOCUMENT_TYPE: [
    { code: "ANNUAL_REPORT", label: "Annual report" },
    { code: "BRSR", label: "BRSR" },
    { code: "CSR_REPORT", label: "CSR report" },
    { code: "IMPACT_REPORT", label: "Impact assessment" },
    { code: "CSR_ACTION_PLAN", label: "CSR annual action plan" },
    { code: "CSR_POLICY", label: "CSR policy" },
    { code: "PROGRAMS_EXCEL", label: "Programs Excel" },
  ],
};
