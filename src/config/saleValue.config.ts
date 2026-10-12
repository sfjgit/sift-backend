// File: saleValue.config.ts
// Path: src/config/saleValue.config.ts

import { SalaryType } from "@prisma/client";

const envNum = (key: string, fallback: number): number => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Multiplier that converts a salary of the given type into an ANNUAL figure.
 * FIXED_PCT sale value = annualised salaryMin × client % × openings.
 *
 * Record<SalaryType, …> — if a new SalaryType is added to the enum,
 * TypeScript fails here until a multiplier is defined. No silent gaps.
 */
export const SALARY_TO_ANNUAL_MULTIPLIER: Record<SalaryType, number> = {
  ANNUAL: 1,
  MONTHLY: 12,
  DAILY: envNum("SALE_VALUE_WORKING_DAYS_PER_YEAR", 260),
  HOURLY: envNum("SALE_VALUE_WORKING_HOURS_PER_YEAR", 2080),
};

// Requirements with no salaryType are treated as annual (matches historical behaviour)
export const DEFAULT_SALARY_TYPE: SalaryType = SalaryType.ANNUAL;
