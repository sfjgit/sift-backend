// File: salesMarks.seed.ts
// Path: src/scripts/salesMarks.seed.ts
//
// npm run seed:sales-marks — CASPA parity for the sales marks (12 Nov 2026).
// Idempotent, per tenant:
//  1. SALES_STATUS gets CASPA's 11 SPOC statuses (existing codes kept, order set).
//  2. ERP names that were imported as a sales status (SAP, Oracle…) move to the
//     SPOC's own `erp` field; the status is cleared and the ERP lookup row is
//     deactivated (never deleted — history may point at it).
//  3. PROJECT lookup (project tags on clients and SPOCs): NASSCOM, STPI, AWS-Restart.
// Pass --dry to only print what would change.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const STATUSES: [code: string, label: string][] = [
  ["NEW", "New"],
  ["ATTEMPTING_CONTACT", "Attempting Contact"],
  ["FRESH_MAIL", "Fresh Mail"],
  ["FOLLOW_UP_1", "1st Follow Up"],
  ["FOLLOW_UP_2", "2nd Follow Up"],
  ["FOLLOW_UP_FINAL", "Final Follow Up"],
  ["WRONG_CONTACT", "Wrong Contact Details"],
  ["IN_DISCUSSION", "In Discussion"],
  ["PROPOSAL_SHARED", "Proposal Shared"],
  ["CLOSED_WON", "Closed Won"],
  ["CLOSED_LOST", "Closed Lost"],
];

// ERP products that ended up in SALES_STATUS during the CASPA import
const ERP_CODES = ["SAP", "SAP_ERP", "ORACLE", "EPICOR", "WORKDAY", "MICROSOFT_DYNAMICS"];

const PROJECTS: [code: string, label: string][] = [
  ["NASSCOM", "NASSCOM"],
  ["STPI", "STPI"],
  ["AWS_RESTART", "AWS-Restart"],
];

const upsertList = async (tenantId: string, type: string, rows: [string, string][]) => {
  for (const [i, [code, label]] of rows.entries()) {
    const found = await prisma.lookup.findUnique({ where: { tenantId_type_code: { tenantId, type, code } } });
    if (found) {
      if (found.order !== i + 1 || !found.isActive) {
        console.log(`  ${type}: refresh ${code}`);
        if (!DRY) await prisma.lookup.update({ where: { id: found.id }, data: { order: i + 1, isActive: true } });
      }
      continue; // keep an admin's relabel
    }
    console.log(`  ${type}: add ${label}`);
    if (!DRY) await prisma.lookup.create({ data: { tenantId, type, code, label, order: i + 1, isSystem: true } });
  }
};

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) {
    console.log(`Tenant ${t.name}${DRY ? " (dry run)" : ""}`);
    await upsertList(t.id, "SALES_STATUS", STATUSES);
    await upsertList(t.id, "PROJECT", PROJECTS);

    const erps = await prisma.lookup.findMany({
      where: { tenantId: t.id, type: "SALES_STATUS", code: { in: ERP_CODES } },
      select: { id: true, label: true, isActive: true },
    });
    for (const erp of erps) {
      const spocs = await prisma.clientSpoc.findMany({
        where: { salesStatusId: erp.id },
        select: { id: true, erp: true },
      });
      console.log(`  ERP "${erp.label}": ${spocs.length} SPOC(s) move to the ERP field`);
      if (DRY) continue;
      await prisma.$transaction([
        // an ERP already typed on the SPOC wins
        ...spocs.map((s) =>
          prisma.clientSpoc.update({
            where: { id: s.id },
            data: { salesStatusId: null, ...(!s.erp && { erp: erp.label }) },
          }),
        ),
        prisma.lookup.update({ where: { id: erp.id }, data: { isActive: false } }),
      ]);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
