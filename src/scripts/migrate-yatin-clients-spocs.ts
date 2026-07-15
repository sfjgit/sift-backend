// File: migrate-yatin-clients-spocs.ts
// Path: src/scripts/migrate-yatin-clients-spocs.ts
//
// Purpose : Seed Client + ClientSpoc rows from Yatin's TR-Tool Excel export.
//           Source file: Yatin_-_Clients.xlsx
//           Data is hardcoded below — no file I/O needed (3 clients, 3 SPOCs).
//
// Usage:
//   npx tsx src/scripts/migrate-yatin-clients-spocs.ts           ← dry run (safe, default)
//   npx tsx src/scripts/migrate-yatin-clients-spocs.ts --commit  ← write to DB
//
// Options:
//   --commit          Actually write to the database. Without it, nothing is touched.
//   --bu <name>       Target a specific BusinessUnit by name. Default: B2B.
//
// Assumptions:
//   • ServiceLine "Knowledge as a Service" (KaaS) exists in DB.
//   • BusinessUnit "B2B" exists in DB.
//   • Handler: anand.y@sfjbs.com (Yatin Anand) — looked up by email.
//     If not found, a placeholder user is auto-created (role = first non-system role,
//     password = pass@123). Review and fix role/reporting after migration.
//   • createdById on Client = Yatin's user id.
//   • ClientSpoc.isPrimary = true for the first SPOC per client (only 1 SPOC each here).

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
// STATIC DATA — extracted from Yatin_-_Clients.xlsx
// 3 unique clients, 3 SPOCs, handler: anand.y@sfjbs.com
//
// Clients sheet   → name / city / state / website
// Client Contacts → name / email / phone / designation
// ─────────────────────────────────────────────────────────────────────────────

interface RawSpoc {
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
}

interface RawClient {
  clientName: string;
  city: string | null;
  state: string | null;
  country: string;
  website: string | null;
  spocs: RawSpoc[];
}

const HANDLER_EMAIL = "anand.y@sfjbs.com";

const RAW_CLIENTS: RawClient[] = [
  {
    clientName: "TATA CONSULTANCY SERVICES LIMITED",
    city: "New Town",
    state: "West Bengal",
    country: "India",
    website: "www.tcs.com",
    spocs: [
      {
        name: "Subhadeep",
        email: "subhadeep1.c@tcs.com",
        phone: "9830937333", // from Clients sheet (office contact)
        designation: null,
      },
    ],
  },
  {
    clientName: "WIPRO LIMITED",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    website: "www.wipro.com",
    spocs: [
      {
        name: "Kevin",
        email: "kevin.kotecha@wipro.com",
        phone: "8898127977", // from Clients sheet (office contact)
        designation: null,
      },
    ],
  },
  {
    clientName: "NPCI",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "www.npci.org.in",
    spocs: [
      {
        name: "Srideep Mondal",
        email: "srideep.mondal@npci.org.in",
        phone: "8296043332", // mobile from Client Contacts sheet
        designation: "HR Manager",
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
    `  YATIN — CLIENT + SPOC MIGRATION  —  ${
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

  // ── 3. Resolve / auto-create handler (Yatin) ──────────────────────────────
  let handlerId: string;
  const existingHandler = await prisma.user.findUnique({
    where: { email: HANDLER_EMAIL },
  });

  if (existingHandler) {
    handlerId = existingHandler.id;
    log(
      `Handler found:    ${HANDLER_EMAIL}  →  ${existingHandler.firstName} ${existingHandler.lastName}  (${existingHandler.id})`
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
          firstName: "Yatin",
          lastName: "Anand",
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
        log(`  │    city:    ${raw.city ?? "—"}`);
        log(`  │    state:   ${raw.state ?? "—"}`);
        log(`  │    country: ${raw.country}`);
        log(`  │    website: ${raw.website ?? "—"}`);
        log(`  │    status:  ACTIVE`);
        log(`  │    buId:    ${bu.id}`);
        log(`  │    handler: ${handlerId}`);
        clientsCreated++;
      } else {
        const created = await prisma.client.create({
          data: {
            name: raw.clientName,
            city: raw.city ?? undefined,
            state: raw.state ?? undefined,
            country: raw.country,
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

      // Dedup check — only fires on re-runs where client already existed
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
        if (spoc.designation) log(`  │    designation: ${spoc.designation}`);
        if (spoc.phone) log(`  │    phone:       ${spoc.phone}`);
        spocsCreated++;
      } else {
        await prisma.clientSpoc.create({
          data: {
            clientId,
            firstName,
            lastName,
            email: spoc.email,
            phone: spoc.phone ?? undefined,
            designation: spoc.designation ?? undefined,
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
