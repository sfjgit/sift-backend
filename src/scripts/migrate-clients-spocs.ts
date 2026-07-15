// File: migrate-clients-spocs.ts
// Path: src/scripts/migrate-clients-spocs.ts
//
// Purpose : Seed Client + ClientSpoc rows from the legacy TR-Tool Excel export.
//           Data is hardcoded below — no file I/O needed (only 5 rows).
//
// Usage:
//   npx tsx src/scripts/migrate-clients-spocs.ts           ← dry run (safe, default)
//   npx tsx src/scripts/migrate-clients-spocs.ts --commit  ← write to DB
//
// Options:
//   --commit          Actually write to the database. Without it, nothing is touched.
//   --bu <name>       Target a specific BusinessUnit by name. Default: first active BU.
//
// Assumptions:
//   • A ServiceLine with name "TaaS" already exists.
//   • A BusinessUnit already exists (pass --bu "name" to target a specific one).
//   • Handler user at cg_captive005@sfjbs.com is looked up by email.
//     If not found, a placeholder user is auto-created (role = first non-system role,
//     password = pass@123). Review and fix role/reporting after migration.
//   • createdById on Client = handler user id (same as SPOC handler/addedBy).
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
// STATIC DATA — extracted from Client_and_SPOC_database_-_TR_Tool__1___2_.xlsx
// Capgemini contacts trimmed to the key named contacts only (the raw field had
// 200+ auto-generated TA contacts which are not meaningful SPOCs)
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
  businessVertical: string | null; // maps to ServiceLine.name
  handlerEmail: string; // last @sfjbs.com email in Account Manager column
  spocs: RawSpoc[];
}

const RAW_CLIENTS: RawClient[] = [
  {
    clientName: "TCS_TaaS_2023",
    city: "Bangalore",
    website: null,
    businessVertical: "TaaS",
    handlerEmail: "cg_captive005@sfjbs.com",
    spocs: [
      { name: "Abdul Alim", email: "abdul.alim@tcs.com", phone: null },
      {
        name: "Akhilesh Kumar",
        email: "akhilesh.kumar@coinapplies.nl",
        phone: null,
      },
      { name: "Deepa Chauhan", email: "deepa.chauhan@tcs.com", phone: null },
      { name: "Suman Guha", email: "guha.suman@tcs.com", phone: "9831550430" },
      {
        name: "Krishnamoorthy AB",
        email: "krishnamoorthy.ab@tcs.com",
        phone: null,
      },
      { name: "Prasanth L", email: "l.prasanth@tcs.com", phone: "7010193169" },
      { name: "Maneesh Randon", email: "maneesh.randon@tcs.com", phone: null },
      { name: "Muniza Aftab", email: "muniza.aftab@tcs.com", phone: null },
      {
        name: "Muthukumar Krishnan",
        email: "muthukumar.krishnan@tcs.com",
        phone: null,
      },
      {
        name: "Saritha Muthyala",
        email: "saritha.muthyala@tcs.com",
        phone: null,
      },
      {
        name: "Sharban Dutta",
        email: "sharban.dutta@tcs.com",
        phone: "9836003797",
      },
      { name: "Ulhas Shinde", email: "ulhas.shinde@tcs.com", phone: null },
      {
        name: "Vaibhav Chitaley",
        email: "vaibhav.chitaley@tcs.com",
        phone: null,
      },
      {
        name: "Vallidevi Prabhu",
        email: "vallidevi1.prabhu@tcs.com",
        phone: "9945367377",
      },
      { name: "Vinod Manickam", email: "vinod.manickam@tcs.com", phone: null },
    ],
  },
  {
    clientName: "Capgemini_TaaS_2023",
    city: null,
    website: null,
    businessVertical: "TaaS",
    handlerEmail: "cg_captive005@sfjbs.com",
    spocs: [
      { name: "Gracy", email: "gracy@capgemini.com", phone: null },
      { name: "Sowmya Y", email: "sowmya.y@capgemini.com", phone: null },
      { name: "Rekha J", email: "rekha.j@capgemini.com", phone: null },
      { name: "V Indira", email: "vindira@capgemini.com", phone: null },
      { name: "Nalini A", email: "nalini.a@capgemini.com", phone: null },
      { name: "Rahul L", email: "rahul.a.l@capgemini.com", phone: null },
      { name: "Isha Dhar", email: "isha.dhar@capgemini.com", phone: null },
      { name: "V Gowthami", email: "v.gowthami@capgemini.com", phone: null },
      {
        name: "Deepa Chauhan",
        email: "deepa.chauhan@capgemini.com",
        phone: "8178731419",
      },
      {
        name: "Jabeen Ismail",
        email: "ismail.jabbin@capgemini.com",
        phone: null,
      },
      {
        name: "Prachi Gangad",
        email: "prachi.gangad@capgemini.com",
        phone: "9561954936",
      },
      { name: "Jatin Koli", email: "jatin.koli@capgemini.com", phone: null },
      {
        name: "Shreya Chandra",
        email: "shreya.chandra@capgemini.com",
        phone: null,
      },
      {
        name: "Rachana Jadhav",
        email: "rachana.jadhav@capgemini.com",
        phone: "9930704629",
      },
      {
        name: "Anuradha Chavan",
        email: "anuradha.a.chavan@capgemini.com",
        phone: null,
      },
      {
        name: "Sameerulla R",
        email: "sameerulla.r@capgemini.com",
        phone: null,
      },
      {
        name: "Rajashekar M",
        email: "rajashekar.m@capgemini.com",
        phone: null,
      },
    ],
  },
  {
    clientName: "Ernst & Young Global Limited_TaaS_2023",
    city: null,
    website: null,
    businessVertical: "TaaS",
    handlerEmail: "cg_captive005@sfjbs.com",
    spocs: [
      { name: "Mr Vinod", email: "mr.vinod@in.ey.com", phone: "9108399303" },
      {
        name: "Richa Jain",
        email: "richa.jain@in.ey.com",
        phone: "9643075690",
      },
      {
        name: "Jithendra K",
        email: "jithendra.k@in.ey.com",
        phone: "9741777449",
      },
      {
        name: "Kriti Saxena",
        email: "kriti.saxena@in.ey.com",
        phone: "9711970373",
      },
      {
        name: "Arijit Sarkar",
        email: "arijit.sarkar@in.ey.com",
        phone: "9923697098",
      },
      {
        name: "Sudheer Kumar P",
        email: "penubaku.kumar@in.ey.com",
        phone: "9441486195",
      },
      {
        name: "Pratika Karmaker",
        email: "pratika.karmaker@in.ey.com",
        phone: "8013657473",
      },
      {
        name: "Aakriti Verma",
        email: "Aakriti.Verma1@in.ey.com",
        phone: "9315830793",
      },
      {
        name: "Abhay Dwivedi",
        email: "abhay.dwivedi@in.ey.com",
        phone: "9752084508",
      },
    ],
  },
  {
    clientName: "SCITARA",
    city: "Pune",
    website: "www.scitara.com",
    businessVertical: "TaaS",
    handlerEmail: "cg_captive005@sfjbs.com",
    spocs: [
      {
        name: "Taruna Vatsa",
        email: "Taruna.Vatsa@Scitara.com",
        phone: "9899575226",
      },
    ],
  },
  {
    clientName: "QNAP",
    city: "Bengaluru",
    website: "www.qnap.com",
    businessVertical: "TaaS",
    handlerEmail: "cg_captive005@sfjbs.com",
    spocs: [
      { name: "Kavya TB", email: "kavyatb@qnap.com", phone: "9611085549" },
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
    `  CLIENT + SPOC MIGRATION  —  ${COMMIT ? "LIVE (--commit)" : "DRY RUN"}`
  );
  console.log("════════════════════════════════════════════════\n");

  if (!COMMIT) {
    console.log("  ℹ  No --commit flag — nothing will be written.\n");
  }

  // ── 1. Resolve ServiceLine ─────────────────────────────────────────────────
  // TaaS = "Talent as a Service" — DB may store it under any of these names
  const TAAS_VARIANTS = [
    "TaaS",
    "Talent as a Service",
    "TAAS",
    "taas",
    "Talent As A Service",
  ];
  const serviceLine = await prisma.serviceLine.findFirst({
    where: { name: { in: TAAS_VARIANTS }, isActive: true },
  });
  if (!serviceLine) {
    const allLines = await prisma.serviceLine.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    });
    console.error("❌  No TaaS ServiceLine found. Tried:", TAAS_VARIANTS);
    console.error("    ServiceLines currently in DB:");
    allLines.forEach((sl) =>
      console.error(
        `      • "${sl.name}"  (id: ${sl.id}, active: ${sl.isActive})`
      )
    );
    console.error(
      "\n    Fix: add the correct name to TAAS_VARIANTS in this script, or seed the ServiceLine."
    );
    process.exit(1);
  }
  log(`ServiceLine resolved: "${serviceLine.name}"  (id: ${serviceLine.id})`);

  // ── 2. Resolve BusinessUnit ────────────────────────────────────────────────
  const bu = await prisma.businessUnit.findFirst({
    where: BU_NAME_ARG
      ? { name: BU_NAME_ARG, isActive: true }
      : { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!bu) {
    console.error(
      `❌  No active BusinessUnit found${
        BU_NAME_ARG ? ` matching "${BU_NAME_ARG}"` : ""
      }. Create one first.`
    );
    process.exit(1);
  }
  log(`BusinessUnit resolved: ${bu.name}  (id: ${bu.id})`);

  // ── 3. Resolve / auto-create handler users ─────────────────────────────────
  const handlerEmailSet = new Set(RAW_CLIENTS.map((c) => c.handlerEmail));
  const handlerMap: Record<string, string> = {}; // email → userId

  for (const email of handlerEmailSet) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      handlerMap[email] = existing.id;
      log(
        `Handler found:    ${email}  →  ${existing.firstName} ${existing.lastName}  (${existing.id})`
      );
    } else {
      const fallbackRole = await prisma.role.findFirst({
        where: { isSystem: false },
        orderBy: { createdAt: "asc" },
      });
      if (!fallbackRole) {
        console.error(
          `❌  No role found to auto-create handler user: ${email}`
        );
        process.exit(1);
      }

      const namePart = email.split("@")[0].replace(/[._]/g, " ");
      const { firstName, lastName } = splitName(namePart);

      if (!COMMIT) {
        handlerMap[email] = `[DRY-USER-${email}]`;
        log(
          `Handler missing → would auto-create: ${email}  (name: ${firstName} ${lastName}, role: ${fallbackRole.name})`
        );
      } else {
        const passwordHash = await bcrypt.hash("pass@123", 10);
        const created = await prisma.user.create({
          data: {
            email,
            passwordHash,
            firstName,
            lastName,
            roleId: fallbackRole.id,
            buId: bu.id,
            isActive: true,
          },
        });
        handlerMap[email] = created.id;
        log(`Handler created:  ${email}  →  ${created.id}`);
      }
    }
  }

  // ── 4. Process each client ─────────────────────────────────────────────────
  let clientsCreated = 0;
  let clientsSkipped = 0;
  let spocsCreated = 0;
  let spocsSkipped = 0;

  for (const raw of RAW_CLIENTS) {
    console.log(`\n  ┌─ ${raw.clientName}`);

    const handlerId = handlerMap[raw.handlerEmail];

    // Check if client already exists (by name, non-deleted)
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
        log(`  │    name:     ${raw.clientName}`);
        log(`  │    city:     ${raw.city ?? "(none)"}`);
        log(`  │    website:  ${raw.website ?? "(none)"}`);
        log(`  │    status:   ACTIVE`);
        log(`  │    buId:     ${bu.id}`);
        log(`  │    handler:  ${handlerId}`);
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

      // Dedup check (always run, even dry — so we preview accurately)
      const existingSpoc = await prisma.clientSpoc.findFirst({
        where: {
          clientId: existingClient?.id ?? "", // only meaningful on re-runs
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
