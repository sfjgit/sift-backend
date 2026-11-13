// File: spocProfile.seed.ts
// Path: src/scripts/spocProfile.seed.ts
//
// npm run seed:spoc-profile — adds the CASPA "Additional SPOC details" pick lists
// (role category, decision authority, organization type, SPOC revenue) to every
// tenant. Idempotent; an admin's renames are kept. Pass --dry to only print.

import { PrismaClient } from "@prisma/client";
import { DEFAULT_LOOKUPS } from "../config/lookups";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
const TYPES = ["SPOC_ROLE", "DECISION_AUTHORITY", "ORG_TYPE", "REVENUE_BAND"] as const;

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) {
    console.log(`Tenant ${t.name}${DRY ? " (dry run)" : ""}`);
    for (const type of TYPES) {
      for (const [i, row] of (DEFAULT_LOOKUPS[type] ?? []).entries()) {
        const found = await prisma.lookup.findUnique({
          where: { tenantId_type_code: { tenantId: t.id, type, code: row.code } },
        });
        if (found) continue;
        console.log(`  ${type}: add ${row.label}`);
        if (!DRY) await prisma.lookup.create({ data: { tenantId: t.id, type, code: row.code, label: row.label, order: i + 1 } });
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
