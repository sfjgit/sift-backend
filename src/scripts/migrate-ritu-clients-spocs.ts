// File: migrate-ritu-clients-spocs.ts
// Path: src/scripts/migrate-ritu-clients-spocs.ts
//
// Purpose : Seed Client + ClientSpoc rows from Ritu's TR-Tool Excel export.
//           Source file: Ritu_-_Client_and_SPOCs.xlsx
//           Data is hardcoded below — no file I/O needed (only 7 clients, 15 SPOCs).
//
// Usage:
//   npx tsx src/scripts/migrate-ritu-clients-spocs.ts           ← dry run (safe, default)
//   npx tsx src/scripts/migrate-ritu-clients-spocs.ts --commit  ← write to DB
//
// Options:
//   --commit          Actually write to the database. Without it, nothing is touched.
//   --bu <name>       Target a specific BusinessUnit by name. Default: B2B.
//
// Assumptions:
//   • ServiceLine "Knowledge as a Service" (KaaS) exists in DB.
//   • BusinessUnit "B2B" exists in DB.
//   • Handler: ta221@sfjbs.com (Ritu) — looked up by email.
//     If not found, a placeholder user is auto-created (role = first non-system role,
//     password = pass@123). Review and fix role/reporting after migration.
//   • createdById on Client = Ritu's user id.
//   • ClientSpoc.isPrimary = true for the first SPOC per client.

import { PrismaClient, ClientStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const buFlagIdx = args.indexOf("--bu");
const BU_NAME_ARG: string | null =
  buFlagIdx !== -1 ? args[buFlagIdx + 1] ?? null : null;

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA — extracted from Ritu_-_Client_and_SPOCs.xlsx
// 7 unique clients, 15 SPOCs, handler: ta221@sfjbs.com
// ─────────────────────────────────────────────────────────────────────────────

interface RawSpoc {
  name: string;
  email: string | null;
  phone: string | null;
}

interface RawClient {
  clientName: string;
  city: string | null;
  website: string | null;
  handlerEmail: string;
  spocs: RawSpoc[];
}

const HANDLER_EMAIL = "ta221@sfjbs.com";

const RAW_CLIENTS: RawClient[] = [
  {
    clientName: "Edubridge - Capgemini",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Lavanya Pogaru",
        email: "Lavanya.Pogaru@edubridgeindia.in",
        phone: "7337215914",
      },
    ],
  },
  {
    clientName: "Schneider Electric",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Nidhiya Mutunayagam",
        email: "nidhiya.mutunayagam@non.se.com",
        phone: "9844181593",
      },
      {
        name: "Samrah Arothe",
        email: "samrah.arothe@se.com",
        phone: "8980019193",
      },
    ],
  },
  {
    clientName: "ITC Infotech",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Devi Suvvada",
        email: "SUVVADA.DEVI@itcinfotech.com",
        phone: "9030266122",
      },
    ],
  },
  {
    clientName: "Accenture",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Abhishek",
        email: "abhishek.a.k.r@accenture.com",
        phone: "8861033556",
      },
      {
        name: "Muthanna",
        email: "muthanna.kushalappa@accenture.com",
        phone: "9538067969",
      },
      {
        name: "Akshata",
        email: "akshata.mathapati@accenture.com",
        phone: "6363173529",
      },
      {
        name: "Pooja Ramesh",
        email: "pooja.d.ramesh@accenture.com",
        phone: "8123273956",
      },
      {
        name: "Preethi",
        email: "preethi.tn@accenture.com",
        phone: "9611828166",
      },
      {
        name: "Reema",
        email: "reema.vijay@accenture.com",
        phone: "8050211128",
      },
      {
        name: "Sanket",
        email: "sanket.susheelendra@accenture.com",
        phone: "8073956137",
      },
    ],
  },
  {
    clientName: "Hetero Health care / Azista",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Wazeed Khan",
        email: "Wazeed.khan@heterohealthcare.com",
        phone: "9866877691",
      },
    ],
  },
  {
    clientName: "InfoPro Learning",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Yuvraj Shekhawat",
        email: "Yuvraj.Shekhawat@infoprolearning.com",
        phone: "9811589116",
      },
    ],
  },
  {
    clientName: "Thermofisher",
    city: null,
    website: null,
    handlerEmail: HANDLER_EMAIL,
    spocs: [
      {
        name: "Anand Bhattacharya",
        email: "Anand.Bhattacharya@ppd.com",
        phone: "9000526285",
      },
      {
        name: "Deepak Kumar",
        email: "Deepak.Kumar21@thermofisher.com",
        phone: "8008929257",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${COMMIT ? "LIVE" : "DRY "}] ${msg}`);
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "-" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log(
    `  RITU — CLIENT + SPOC MIGRATION  —  ${
      COMMIT ? "LIVE (--commit)" : "DRY RUN"
    }`
  );
  console.log("════════════════════════════════════════════════\n");

  if (!COMMIT) {
    console.log("  ℹ  No --commit flag — nothing will be written.\n");
  }

  // ── 1. Resolve ServiceLine (KaaS) ─────────────────────────────────────────
  const KAAS_VARIANTS = [
    "KaaS",
    "Knowledge as a Service",
    "KAAS",
    "kaas",
    "Knowledge As A Service",
  ];
  const serviceLine = await prisma.serviceLine.findFirst({
    where: { name: { in: KAAS_VARIANTS }, isActive: true },
  });
  if (!serviceLine) {
    const allLines = await prisma.serviceLine.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    });
    console.error("❌  No KaaS ServiceLine found. Tried:", KAAS_VARIANTS);
    console.error("    ServiceLines currently in DB:");
    allLines.forEach((sl) =>
      console.error(
        `      • "${sl.name}"  (id: ${sl.id}, active: ${sl.isActive})`
      )
    );
    console.error(
      "\n    Fix: add the correct name to KAAS_VARIANTS in this script, or seed the ServiceLine."
    );
    process.exit(1);
  }
  log(`ServiceLine resolved: "${serviceLine.name}"  (id: ${serviceLine.id})`);

  // ── 2. Resolve BusinessUnit ────────────────────────────────────────────────
  const targetBU = BU_NAME_ARG ?? "B2B";
  const bu = await prisma.businessUnit.findFirst({
    where: { name: targetBU, isActive: true },
  });
  if (!bu) {
    const allBUs = await prisma.businessUnit.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    });
    console.error(`❌  BusinessUnit "${targetBU}" not found.`);
    console.error("    BusinessUnits currently in DB:");
    allBUs.forEach((b) =>
      console.error(`      • "${b.name}"  (id: ${b.id}, active: ${b.isActive})`)
    );
    process.exit(1);
  }
  log(`BusinessUnit resolved: "${bu.name}"  (id: ${bu.id})`);

  // ── 3. Resolve / auto-create handler (Ritu) ───────────────────────────────
  let handlerId: string;
  const existing = await prisma.user.findUnique({
    where: { email: HANDLER_EMAIL },
  });

  if (existing) {
    handlerId = existing.id;
    log(
      `Handler found:    ${HANDLER_EMAIL}  →  ${existing.firstName} ${existing.lastName}  (${existing.id})`
    );
  } else {
    const fallbackRole = await prisma.role.findFirst({
      where: { isSystem: false },
      orderBy: { createdAt: "asc" },
    });
    if (!fallbackRole) {
      console.error(
        `❌  No role found to auto-create handler: ${HANDLER_EMAIL}`
      );
      process.exit(1);
    }

    if (!COMMIT) {
      handlerId = `[DRY-USER-${HANDLER_EMAIL}]`;
      log(
        `Handler missing → would auto-create: ${HANDLER_EMAIL}  (role: ${fallbackRole.name})`
      );
    } else {
      const passwordHash = await bcrypt.hash("pass@123", 10);
      const created = await prisma.user.create({
        data: {
          email: HANDLER_EMAIL,
          passwordHash,
          firstName: "Ritu",
          lastName: "-",
          roleId: fallbackRole.id,
          buId: bu.id,
          isActive: true,
        },
      });
      handlerId = created.id;
      log(`Handler created:  ${HANDLER_EMAIL}  →  ${created.id}`);
    }
  }

  // ── 4. Process each client ─────────────────────────────────────────────────
  let clientsCreated = 0;
  let clientsSkipped = 0;
  let spocsCreated = 0;
  let spocsSkipped = 0;

  for (const raw of RAW_CLIENTS) {
    console.log(`\n  ┌─ ${raw.clientName}`);

    const existingClient = await prisma.client.findFirst({
      where: { name: raw.clientName, deletedAt: null },
    });

    let clientId: string;

    if (existingClient) {
      clientId = existingClient.id;
      log(`  │  Client already exists — skip  (id: ${clientId})`);
      clientsSkipped++;
    } else {
      if (!COMMIT) {
        clientId = `[DRY-CLIENT-${raw.clientName}]`;
        log(`  │  Would create Client:`);
        log(`  │    name:    ${raw.clientName}`);
        log(`  │    status:  ACTIVE`);
        log(`  │    buId:    ${bu.id}`);
        log(`  │    handler: ${handlerId}`);
        clientsCreated++;
      } else {
        const created = await prisma.client.create({
          data: {
            name: raw.clientName,
            city: raw.city ?? undefined,
            website: raw.website ?? undefined,
            status: ClientStatus.ACTIVE,
            businessUnitId: bu.id,
            createdById: handlerId,
          },
        });
        clientId = created.id;
        log(`  │  Client created  →  ${clientId}`);
        clientsCreated++;
      }
    }

    // ── SPOCs ────────────────────────────────────────────────────────────────
    for (let i = 0; i < raw.spocs.length; i++) {
      const spoc = raw.spocs[i];
      const isPrimary = i === 0;

      if (!spoc.email) {
        log(`  │  ⚠  "${spoc.name}" has no email — skip`);
        spocsSkipped++;
        continue;
      }

      // Dedup check against existing clientId (only meaningful on re-runs)
      const existingSpoc = await prisma.clientSpoc.findFirst({
        where: {
          clientId: existingClient?.id ?? "",
          email: spoc.email,
          serviceLineId: serviceLine.id,
        },
      });
      if (existingSpoc) {
        log(`  │  SPOC exists — skip: ${spoc.email}`);
        spocsSkipped++;
        continue;
      }

      const { firstName, lastName } = splitName(spoc.name);
      const marker = isPrimary ? " [PRIMARY]" : "";

      if (!COMMIT) {
        log(`  │  Would create SPOC: ${spoc.name} <${spoc.email}>${marker}`);
        spocsCreated++;
      } else {
        await prisma.clientSpoc.create({
          data: {
            clientId,
            firstName,
            lastName,
            email: spoc.email,
            phone: spoc.phone ?? undefined,
            serviceLineId: serviceLine.id,
            businessUnitId: bu.id,
            handlerId,
            addedById: handlerId,
            isPrimary,
            isActive: true,
          },
        });
        log(`  │  SPOC created: ${spoc.name} <${spoc.email}>${marker}`);
        spocsCreated++;
      }
    }

    console.log(`  └─ done`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════");
  console.log(`  Clients  created : ${clientsCreated}`);
  console.log(`  Clients  skipped : ${clientsSkipped}  (already exist)`);
  console.log(`  SPOCs    created : ${spocsCreated}`);
  console.log(`  SPOCs    skipped : ${spocsSkipped}`);

  if (!COMMIT) {
    console.log("\n  ⚠  DRY RUN — nothing was written.");
    console.log("  Re-run with --commit to apply.\n");
  } else {
    console.log("\n  ✅  Done.\n");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
