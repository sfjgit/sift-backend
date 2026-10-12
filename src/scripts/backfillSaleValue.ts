// File: backfillSaleValue.ts
// Path: scripts/backfillSaleValue.ts
//
// Freezes saleValue / perOpeningValue / saleValueBasis on every existing requirement.
//
//   Dry run (writes NOTHING, prints what would change):
//     npx tsx scripts/backfillSaleValue.ts --dry-run
//
//   Real run:
//     npx tsx scripts/backfillSaleValue.ts
//
// Safe to re-run — same inputs always produce the same frozen values.
// Legacy rows (basis null + saleValue > 0) are treated as manual totals (DIRECT).

import prisma from "@/utils/prisma/client";
import {
  freezeSaleValue,
  isManualSaleValue,
  resolveSaleValue,
} from "@/services/saleValue.service";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;

type Row = {
  reqCode: string;
  openings: number;
  oldSaleValue: number | null;
  newSaleValue: number | null;
  newPerOpening: number | null;
  basis: string;
  salaryType: string;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

async function main() {
  console.log(
    `\n── Sale value backfill ${
      DRY_RUN ? "(DRY RUN — nothing written)" : "(WRITING)"
    } ──\n`
  );

  const byBasis: Record<string, { count: number; total: number }> = {};
  const changed: Row[] = [];
  let processed = 0;
  let failed = 0;
  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.requirement.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        reqCode: true,
        totalOpenings: true,
        saleValue: true,
        saleValueBasis: true,
        salaryMin: true,
        salaryType: true,
        band: { select: { value: true } },
        client: { select: { percentageValue: true } },
      },
    });

    if (!batch.length) break;

    for (const r of batch) {
      try {
        const manual = isManualSaleValue(r.saleValueBasis, r.saleValue)
          ? r.saleValue
          : null;

        // Dry run computes with the exact same function the real run uses
        const frozen = DRY_RUN
          ? resolveSaleValue({
              manualSaleValue: manual,
              totalOpenings: r.totalOpenings,
              bandValue: r.band?.value,
              clientPct: r.client?.percentageValue,
              salaryMin: r.salaryMin,
              salaryType: r.salaryType,
            })
          : await freezeSaleValue(prisma, r.id);

        const basis = frozen.saleValueBasis ?? "NOT_FOUND";
        const newTotal = num(frozen.saleValue);

        if (!byBasis[basis]) byBasis[basis] = { count: 0, total: 0 };
        byBasis[basis].count++;
        byBasis[basis].total += newTotal ?? 0;

        const oldTotal = num(r.saleValue);
        if (oldTotal !== newTotal) {
          changed.push({
            reqCode: r.reqCode,
            openings: r.totalOpenings,
            oldSaleValue: oldTotal,
            newSaleValue: newTotal,
            newPerOpening: num(frozen.perOpeningValue),
            basis,
            salaryType: r.salaryType ?? "—",
          });
        }
      } catch (err) {
        failed++;
        console.error(
          `✗ ${r.reqCode}:`,
          err instanceof Error ? err.message : err
        );
      }
      processed++;
    }

    cursor = batch[batch.length - 1].id;
    console.log(`… ${processed} processed`);
  }

  console.log("\n── Summary by basis ──");
  console.table(
    Object.entries(byBasis).map(([basis, v]) => ({
      basis,
      count: v.count,
      total: Math.round(v.total * 100) / 100,
    }))
  );

  console.log(
    `\n── Rows where saleValue column changes (${changed.length}) ──`
  );
  console.log(
    "(BAND / FIXED_PCT rows showing old = null is expected — they were never stored before)"
  );
  console.table(changed.slice(0, 100));
  if (changed.length > 100) console.log(`… and ${changed.length - 100} more`);

  console.log(
    `\nProcessed: ${processed} | Failed: ${failed} | Mode: ${
      DRY_RUN ? "DRY RUN" : "WRITTEN"
    }\n`
  );
}

main()
  .catch((err) => {
    console.error("Backfill crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
