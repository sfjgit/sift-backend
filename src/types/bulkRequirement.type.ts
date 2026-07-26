// File: bulkRequirement.type.ts
// Path: src/types/bulkRequirement.type.ts

export type JobType =
  | "CONTRACT"
  | "PERMANENT"
  | "CONTRACT_TO_HIRE"
  | "FREELANCE";
export type RemoteType = "ONSITE" | "REMOTE" | "HYBRID";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type JobOpenFor = "EXTERNAL" | "INTERNAL" | "BOTH";
export type RequirementStatus = "DRAFT" | "PENDING_APPROVAL";
export type SalaryType = "MONTHLY" | "ANNUAL" | "HOURLY" | "DAILY";

// Raw row as parsed from Excel/CSV (all strings)
// clientId, clientSpocId, businessUnitId, serviceLineId are intentionally
// excluded — they come from the UI dropdown selection, not the sheet.
export interface RawRequirementRow {
  title?: string;
  jobType?: string;
  remoteType?: string;
  priority?: string;
  jobOpenFor?: string;
  totalOpenings?: string;
  status?: string;
  primarySkills?: string;
  keySkills?: string;
  city?: string;
  state?: string;
  country?: string;
  experienceMin?: string;
  experienceMax?: string;
  salaryMin?: string;
  salaryMax?: string;
  salaryType?: string;
  salaryCurrency?: string;
  hideSalaryFromCandidate?: string;
  education?: string;
  functionalArea?: string;
  shift?: string;
  targetCompanies?: string;
  noPoachCompanies?: string;
  startDate?: string;
  targetDate?: string;
  respondBy?: string;
  turnaroundDays?: string;
  description?: string;
}

// Validated and coerced row — ready for DB insert.
// clientId, clientSpocId, businessUnitId, serviceLineId are NOT here —
// they are injected by the controller from the validated SPOC lookup.
export interface ValidatedRequirementRow {
  title: string;
  jobType: JobType;
  remoteType: RemoteType;
  priority: Priority;
  jobOpenFor: JobOpenFor;
  totalOpenings: number;
  status: RequirementStatus;
  primarySkills: string[];
  keySkills: string[];
  city: string | undefined;
  state: string | undefined;
  country: string;
  experienceMin: number | undefined;
  experienceMax: number | undefined;
  salaryMin: number | undefined;
  salaryMax: number | undefined;
  salaryType: SalaryType | undefined;
  salaryCurrency: string;
  hideSalaryFromCandidate: boolean;
  education: string | undefined;
  functionalArea: string | undefined;
  shift: string | undefined;
  targetCompanies: string[];
  noPoachCompanies: string[];
  startDate: Date | undefined;
  targetDate: Date | undefined;
  respondBy: Date | undefined;
  turnaroundDays: number | undefined;
  description: string | undefined;
}

export interface RowValidationError {
  row: number;
  field: string;
  message: string;
}

export interface BulkUploadResult {
  totalRows: number;
  created: number;
  skipped: number;
  failed: number;
  errors: RowValidationError[];
  createdRequirementIds: string[];
}
