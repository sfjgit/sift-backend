// File: saleValue.service.ts
// Path: src/services/saleValue.service.ts

import { Prisma, SaleValueBasis, SalaryType } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import {
  DEFAULT_SALARY_TYPE,
  SALARY_TO_ANNUAL_MULTIPLIER,
} from "@/config/saleValue.config";

type Db = Prisma.TransactionClient | typeof prisma;
type Num = Prisma.Decimal | number | string | null | undefined;

const D = Prisma.Decimal;

// Never throws — garbage input ("abc", "1,50,000", NaN, Infinity) → null
const toDec = (v: Num): Prisma.Decimal | null => {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new D(v as Prisma.Decimal.Value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};

const isPositive = (d: Prisma.Decimal | null): d is Prisma.Decimal =>
  d !== null && d.gt(0);

/**
 * Was this requirement's saleValue typed by a CSM (vs derived from band / %)?
 *
 *   basis DIRECT                → yes
 *   basis null + saleValue > 0  → yes — legacy row from before freezing existed;
 *                                 the old code only ever stored CSM input in saleValue
 *   anything else               → no
 *
 * Safe to keep after backfill: resolveSaleValue always writes basis and
 * saleValue together, so "null basis + positive value" only exists on legacy rows.
 */
export function isManualSaleValue(
  basis: SaleValueBasis | null | undefined,
  saleValue: Num
): boolean {
  if (basis === SaleValueBasis.DIRECT) return true;
  if (basis == null) return isPositive(toDec(saleValue));
  return false;
}

/** salaryMin in its own unit → annual figure. Unknown / null type → DEFAULT_SALARY_TYPE. */
export function annualiseSalary(
  salary: Prisma.Decimal | null,
  salaryType: SalaryType | null | undefined
): Prisma.Decimal | null {
  if (salary === null) return null;
  const multiplier =
    SALARY_TO_ANNUAL_MULTIPLIER[salaryType ?? DEFAULT_SALARY_TYPE] ?? 1;
  return salary.mul(multiplier);
}

export interface SaleValueInput {
  manualSaleValue: Num; // CSM-entered TOTAL — null when not provided
  totalOpenings: number;
  bandValue: Num;
  clientPct: Num;
  salaryMin: Num;
  salaryType: SalaryType | null | undefined; // null → treated as ANNUAL
}

export interface FrozenSaleValue {
  saleValue: Prisma.Decimal | null;
  perOpeningValue: Prisma.Decimal | null;
  saleValueBasis: SaleValueBasis | null;
  saleValueRate: Prisma.Decimal | null;
  saleValueFrozenAt: Date;
}

/**
 * Pure — no DB. Priority: DIRECT → BAND → FIXED_PCT → null.
 * DIRECT is already the total and is never multiplied by openings.
 * FIXED_PCT uses the ANNUALISED salaryMin (MONTHLY × 12 etc. — see saleValue.config).
 */
export function resolveSaleValue(input: SaleValueInput): FrozenSaleValue {
  const openings = Math.max(1, Math.floor(input.totalOpenings || 1));
  const frozenAt = new Date();

  const manual = toDec(input.manualSaleValue);
  if (isPositive(manual)) {
    return {
      saleValue: manual.toDecimalPlaces(2),
      perOpeningValue: manual.div(openings).toDecimalPlaces(2),
      saleValueBasis: SaleValueBasis.DIRECT,
      saleValueRate: null,
      saleValueFrozenAt: frozenAt,
    };
  }

  const band = toDec(input.bandValue);
  if (isPositive(band)) {
    return {
      saleValue: band.mul(openings).toDecimalPlaces(2),
      perOpeningValue: band.toDecimalPlaces(2),
      saleValueBasis: SaleValueBasis.BAND,
      saleValueRate: band,
      saleValueFrozenAt: frozenAt,
    };
  }

  const pct = toDec(input.clientPct);
  const salary = annualiseSalary(toDec(input.salaryMin), input.salaryType);
  if (isPositive(pct) && isPositive(salary)) {
    const perOpening = salary.mul(pct).div(100);
    return {
      saleValue: perOpening.mul(openings).toDecimalPlaces(2),
      perOpeningValue: perOpening.toDecimalPlaces(2),
      saleValueBasis: SaleValueBasis.FIXED_PCT,
      saleValueRate: pct,
      saleValueFrozenAt: frozenAt,
    };
  }

  return {
    saleValue: null,
    perOpeningValue: null,
    saleValueBasis: null,
    saleValueRate: null,
    saleValueFrozenAt: frozenAt,
  };
}

/**
 * Reads the requirement's current inputs, freezes, writes.
 * Call inside the same transaction as the create / update.
 *
 * manualSaleValue:
 *   undefined → keep existing manual value (DIRECT or legacy manual)
 *   null      → CSM cleared it → fall back to band / %
 *   number    → new manual total
 */
export async function freezeSaleValue(
  db: Db,
  requirementId: string,
  manualSaleValue?: Num
): Promise<FrozenSaleValue> {
  const r = await db.requirement.findUniqueOrThrow({
    where: { id: requirementId },
    select: {
      saleValue: true,
      saleValueBasis: true,
      totalOpenings: true,
      salaryMin: true,
      salaryType: true,
      band: { select: { value: true } },
      client: { select: { percentageValue: true } },
    },
  });

  const manual =
    manualSaleValue !== undefined
      ? manualSaleValue
      : isManualSaleValue(r.saleValueBasis, r.saleValue)
      ? r.saleValue
      : null;

  const frozen = resolveSaleValue({
    manualSaleValue: manual,
    totalOpenings: r.totalOpenings,
    bandValue: r.band?.value,
    clientPct: r.client?.percentageValue,
    salaryMin: r.salaryMin,
    salaryType: r.salaryType,
  });

  await db.requirement.update({ where: { id: requirementId }, data: frozen });
  return frozen;
}
