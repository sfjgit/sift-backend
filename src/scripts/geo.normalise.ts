// File: geo.normalise.ts
// Path: src/scripts/geo.normalise.ts
//
// One-off: rewrite stored client locations to the standard names
// ("BANGALORE." → "Bengaluru") so location filters match every row.
//   npm run geo:normalise            → shows what would change
//   npm run geo:normalise -- --apply → writes it

import prisma from "@/utils/prisma/client";
import { normaliseLocation } from "@/services/geo.service";

const apply = process.argv.includes("--apply");

(async () => {
  const rows = await prisma.clientLocation.findMany({ select: { id: true, country: true, state: true, city: true } });
  const changes = new Map<string, number>();
  let changed = 0;
  for (const r of rows) {
    const n = normaliseLocation(r);
    const diff = (["country", "state", "city"] as const).filter((k) => (n[k] ?? null) !== (r[k] ?? null));
    if (!diff.length) continue;
    changed++;
    for (const k of diff) {
      const line = `${k}: "${r[k]}" → "${n[k]}"`;
      changes.set(line, (changes.get(line) ?? 0) + 1);
    }
    if (apply) {
      await prisma.clientLocation.update({
        where: { id: r.id },
        data: Object.fromEntries(diff.map((k) => [k, n[k]])),
      });
    }
  }
  for (const [line, n] of [...changes].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)} × ${line}`);
  console.log(`\n${changed} of ${rows.length} locations ${apply ? "updated" : "would change (dry run — add --apply)"}`);
  await prisma.$disconnect();
})();
