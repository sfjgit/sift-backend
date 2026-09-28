// File: saleValue.service.ts
// Path: src/services/saleValue.service.ts

import { Prisma, SaleValueBasis } from "@prisma/client";
import prisma from "@/utils/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;
type Num = Prisma.Decimal | number | string | null | undefined;

const D = Prisma.Decimal;
const toDec = (v: Num): Prisma.Decimal | null =>
  v === null || v === undefined || v === "" ? null : new D(v);
const isPositive = (d: Prisma.Decimal | null): d is Prisma.Decimal =>
  d !== null && d.gt(0);

export interface SaleValueInput {
  manualSaleValue: Num; // CSM-entered TOTAL — null when not provided
  totalOpenings: number;
  bandValue: Num;
  clientPct: Num;
  salaryMin: Num;
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
 */
export function resolveSaleValue(input: SaleValueInput): FrozenSaleValue {
  const openings = Math.max(1, input.totalOpenings || 1);
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
  const salary = toDec(input.salaryMin);
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
 *   undefined → keep existing manual value (only if basis was DIRECT)
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
      band: { select: { value: true } },
      client: { select: { percentageValue: true } },
    },
  });

  const manual =
    manualSaleValue !== undefined
      ? manualSaleValue
      : r.saleValueBasis === SaleValueBasis.DIRECT
      ? r.saleValue
      : null;

  const frozen = resolveSaleValue({
    manualSaleValue: manual,
    totalOpenings: r.totalOpenings,
    bandValue: r.band?.value,
    clientPct: r.client?.percentageValue,
    salaryMin: r.salaryMin,
  });

  await db.requirement.update({ where: { id: requirementId }, data: frozen });
  return frozen;
}
