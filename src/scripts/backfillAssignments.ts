// File: backfillAssignments.ts
// Path: src/scripts/backfillAssignments.ts
//
// npm run backfill:assignments [-- --dry]
// Clients with nobody assigned get the people who handle their SPOCs as owners
// (14 Nov 2026: only 2 of 363 clients were assigned, so "my clients" was empty).
// Clients without SPOCs stay unassigned. Runs as ONE recycle-bin batch: the
// printed batch id undoes all of it (Recycle bin → "Undo action").

import "dotenv/config";
import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma/client";
import { runInTenant } from "@/utils/prisma/tenant";
import { runWithChanges } from "@/utils/prisma/changes";

const DRY = process.argv.includes("--dry");

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) {
    const batchId = randomUUID();
    await runInTenant(t.id, () =>
      runWithChanges({ batchId, source: "system" }, async () => {
        const admin = await prisma.user.findFirst({ where: { isSuperAdmin: true, isActive: true }, select: { id: true } });
        if (!admin) return console.log(`${t.name}: no admin to record as "assigned by" — skipped`);
        const clients = await prisma.client.findMany({
          where: { deletedAt: null, assignments: { none: { endedAt: null } }, spocs: { some: { isActive: true } } },
          select: { id: true, name: true, spocs: { where: { isActive: true, handler: { isActive: true } }, select: { handlerId: true } } },
        });
        const rows = clients.flatMap((c) =>
          [...new Set(c.spocs.map((s) => s.handlerId))].map((userId) => ({ clientId: c.id, userId, assignedById: admin.id, note: "From the handlers of its SPOCs" })),
        );
        console.log(`${t.name}: ${clients.length} clients, ${rows.length} assignments${DRY ? " (dry run — nothing saved)" : ""}`);
        if (DRY || !rows.length) return;
        for (let i = 0; i < rows.length; i += 500) await prisma.clientAssignment.createMany({ data: rows.slice(i, i + 500) });
        console.log(`  saved. Undo all of it: Recycle bin → "Undo action", or POST /api/recycle-bin/batches/${batchId}/undo`);
      }),
    );
  }
  // let the recycle-bin history finish writing
  await new Promise((r) => setTimeout(r, 3000));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
