// File: bulkRequirements.ts
// Path: src/utils/bulkRequirements.ts

import {
  JobOpenFor,
  JobType,
  Priority,
  RawRequirementRow,
  RemoteType,
  RequirementStatus,
  RowValidationError,
  SalaryType,
  ValidatedRequirementRow,
} from "@/types/bulkRequirement.type";

// ─── Allowed enum values ──────────────────────────────────────────────────────

const JOB_TYPES: JobType[] = [
  "CONTRACT",
  "PERMANENT",
  "CONTRACT_TO_HIRE",
  "FREELANCE",
];
const REMOTE_TYPES: RemoteType[] = ["ONSITE", "REMOTE", "HYBRID"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const JOB_OPEN_FOR: JobOpenFor[] = ["EXTERNAL", "INTERNAL", "BOTH"];
const STATUSES: RequirementStatus[] = ["DRAFT", "PENDING_APPROVAL"];
const SALARY_TYPES: SalaryType[] = ["MONTHLY", "ANNUAL", "HOURLY", "DAILY"];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── Main validator ───────────────────────────────────────────────────────────

export interface RowValidationResult {
  valid: boolean;
  data?: ValidatedRequirementRow;
  errors: RowValidationError[];
}

/**
 * Validates and coerces a single raw row (1-based rowNumber for error reporting).
 * clientId, clientSpocId, businessUnitId, serviceLineId are NOT validated here —
 * they come from the request body (UI dropdown), not the Excel sheet.
 */
export function validateRequirementRow(
  raw: RawRequirementRow,
  rowNumber: number,
): RowValidationResult {
  const errors: RowValidationError[] = [];

  // ─── Mandatory fields ─────────────────────────────────────────────────────

  const title = requireString(raw.title, "title", rowNumber, errors);
  const jobType = requireEnum<JobType>(
    raw.jobType,
    "jobType",
    JOB_TYPES,
    rowNumber,
    errors,
  );
  const remoteType = requireEnum<RemoteType>(
    raw.remoteType,
    "remoteType",
    REMOTE_TYPES,
    rowNumber,
    errors,
  );
  const primarySkillsRaw = requireString(
    raw.primarySkills,
    "primarySkills",
    rowNumber,
    errors,
  );
  const totalOpeningsRaw = requirePositiveInt(
    raw.totalOpenings,
    "totalOpenings",
    rowNumber,
    errors,
  );

  // ─── Optional fields with defaults ───────────────────────────────────────

  const priority =
    optionalEnum<Priority>(
      raw.priority,
      "priority",
      PRIORITIES,
      rowNumber,
      errors,
    ) ?? "MEDIUM";
  const jobOpenFor =
    optionalEnum<JobOpenFor>(
      raw.jobOpenFor,
      "jobOpenFor",
      JOB_OPEN_FOR,
      rowNumber,
      errors,
    ) ?? "EXTERNAL";
  const status =
    optionalEnum<RequirementStatus>(
      raw.status,
      "status",
      STATUSES,
      rowNumber,
      errors,
    ) ?? "DRAFT";
  const country = optionalString(raw.country) ?? "India";
  const salaryCurrency = optionalString(raw.salaryCurrency) ?? "INR";
  const hideSalaryFromCandidate =
    parseBoolean(raw.hideSalaryFromCandidate) ?? false;

  // ─── Optional scalars ─────────────────────────────────────────────────────

  const experienceMin = optionalDecimal(
    raw.experienceMin,
    "experienceMin",
    rowNumber,
    errors,
  );
  const experienceMax = optionalDecimal(
    raw.experienceMax,
    "experienceMax",
    rowNumber,
    errors,
  );
  const salaryMin = optionalDecimal(
    raw.salaryMin,
    "salaryMin",
    rowNumber,
    errors,
  );
  const salaryMax = optionalDecimal(
    raw.salaryMax,
    "salaryMax",
    rowNumber,
    errors,
  );
  const turnaroundDays = optionalPositiveInt(
    raw.turnaroundDays,
    "turnaroundDays",
    rowNumber,
    errors,
  );

  // ─── Salary type (required when salaryMin/Max is present) ────────────────
  let salaryType: SalaryType | undefined;
  if (salaryMin !== undefined || salaryMax !== undefined) {
    salaryType = requireEnum<SalaryType>(
      raw.salaryType,
      "salaryType",
      SALARY_TYPES,
      rowNumber,
      errors,
      {
        hint: "salaryType is required when salaryMin or salaryMax is provided",
      },
    );
  } else {
    salaryType = optionalEnum<SalaryType>(
      raw.salaryType,
      "salaryType",
      SALARY_TYPES,
      rowNumber,
      errors,
    );
  }

  // ─── Dates ────────────────────────────────────────────────────────────────

  const startDate = optionalDate(raw.startDate, "startDate", rowNumber, errors);
  const targetDate = optionalDate(
    raw.targetDate,
    "targetDate",
    rowNumber,
    errors,
  );
  const respondBy = optionalDate(raw.respondBy, "respondBy", rowNumber, errors);

  // ─── Comma-separated lists ────────────────────────────────────────────────

  const primarySkills = parseCommaSeparated(primarySkillsRaw ?? "");
  const keySkills = parseCommaSeparated(optionalString(raw.keySkills) ?? "");
  const targetCompanies = parseCommaSeparated(
    optionalString(raw.targetCompanies) ?? "",
  );
  const noPoachCompanies = parseCommaSeparated(
    optionalString(raw.noPoachCompanies) ?? "",
  );

  // ─── Cross-checks ─────────────────────────────────────────────────────────

  if (
    experienceMin !== undefined &&
    experienceMax !== undefined &&
    experienceMin > experienceMax
  ) {
    errors.push({
      row: rowNumber,
      field: "experienceMin/experienceMax",
      message: `experienceMin (${experienceMin}) cannot be greater than experienceMax (${experienceMax})`,
    });
  }

  if (
    salaryMin !== undefined &&
    salaryMax !== undefined &&
    salaryMin > salaryMax
  ) {
    errors.push({
      row: rowNumber,
      field: "salaryMin/salaryMax",
      message: `salaryMin (${salaryMin}) cannot be greater than salaryMax (${salaryMax})`,
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      title: title!,
      jobType: jobType!,
      remoteType: remoteType!,
      priority,
      jobOpenFor,
      totalOpenings: totalOpeningsRaw ?? 1,
      status,
      primarySkills,
      keySkills,
      city: optionalString(raw.city),
      state: optionalString(raw.state),
      country,
      experienceMin,
      experienceMax,
      salaryMin,
      salaryMax,
      salaryType,
      salaryCurrency,
      hideSalaryFromCandidate,
      education: optionalString(raw.education),
      functionalArea: optionalString(raw.functionalArea),
      shift: optionalString(raw.shift),
      targetCompanies,
      noPoachCompanies,
      startDate,
      targetDate,
      respondBy,
      turnaroundDays,
      description: optionalString(raw.description),
      // clientId, clientSpocId, businessUnitId, serviceLineId — NOT here
      // injected by controller from SPOC lookup
    },
  };
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function requireString(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowValidationError[],
): string | undefined {
  const v = value?.trim();
  if (!v) {
    errors.push({ row, field, message: `"${field}" is required` });
    return undefined;
  }
  return v;
}

function requireEnum<T extends string>(
  value: string | undefined,
  field: string,
  allowed: T[],
  row: number,
  errors: RowValidationError[],
  options?: { hint?: string },
): T | undefined {
  const v = value?.trim().toUpperCase() as T;
  if (!v) {
    errors.push({
      row,
      field,
      message:
        options?.hint ??
        `"${field}" is required. Allowed: ${allowed.join(" | ")}`,
    });
    return undefined;
  }
  if (!allowed.includes(v)) {
    errors.push({
      row,
      field,
      message: `"${field}" has invalid value "${v}". Allowed: ${allowed.join(" | ")}`,
    });
    return undefined;
  }
  return v;
}

function optionalEnum<T extends string>(
  value: string | undefined,
  field: string,
  allowed: T[],
  row: number,
  errors: RowValidationError[],
): T | undefined {
  const v = value?.trim().toUpperCase() as T;
  if (!v) return undefined;
  if (!allowed.includes(v)) {
    errors.push({
      row,
      field,
      message: `"${field}" has invalid value "${v}". Allowed: ${allowed.join(" | ")}`,
    });
    return undefined;
  }
  return v;
}

function requirePositiveInt(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowValidationError[],
): number | undefined {
  const v = value?.trim();
  if (!v) {
    errors.push({
      row,
      field,
      message: `"${field}" is required (positive integer)`,
    });
    return undefined;
  }
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) {
    errors.push({
      row,
      field,
      message: `"${field}" must be a positive integer, got "${v}"`,
    });
    return undefined;
  }
  return n;
}

function optionalPositiveInt(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowValidationError[],
): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) {
    errors.push({
      row,
      field,
      message: `"${field}" must be a positive integer, got "${v}"`,
    });
    return undefined;
  }
  return n;
}

function optionalDecimal(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowValidationError[],
): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const n = parseFloat(v);
  if (isNaN(n) || n < 0) {
    errors.push({
      row,
      field,
      message: `"${field}" must be a non-negative number, got "${v}"`,
    });
    return undefined;
  }
  return n;
}

function optionalDate(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowValidationError[],
): Date | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!DATE_REGEX.test(v)) {
    errors.push({
      row,
      field,
      message: `"${field}" must be in YYYY-MM-DD format, got "${v}"`,
    });
    return undefined;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) {
    errors.push({
      row,
      field,
      message: `"${field}" is not a valid date: "${v}"`,
    });
    return undefined;
  }
  return d;
}

function optionalString(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  const v = value?.trim().toUpperCase();
  if (!v) return undefined;
  if (v === "TRUE" || v === "1" || v === "YES") return true;
  if (v === "FALSE" || v === "0" || v === "NO") return false;
  return undefined;
}

function parseCommaSeparated(value: string): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
