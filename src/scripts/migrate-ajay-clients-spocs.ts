// File: migrate-ajay-clients-spocs.ts
// Path: src/scripts/migrate-ajay-clients-spocs.ts
//
// Purpose : Seed Client + ClientSpoc rows from Ajay's TR-Tool export.
//           Source: client_contact_list_Ajay_D.xlsx
//           21 unique clients, 22 SPOCs — data hardcoded, no file I/O needed.
//
// Usage:
//   npx tsx src/scripts/migrate-ajay-clients-spocs.ts           ← dry run
//   npx tsx src/scripts/migrate-ajay-clients-spocs.ts --commit  ← write to DB

import { PrismaClient, ClientStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const buFlagIdx = args.indexOf("--bu");
const BU_NAME_ARG: string | null =
  buFlagIdx !== -1 ? args[buFlagIdx + 1] ?? null : null;

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA
// ─────────────────────────────────────────────────────────────────────────────

const HANDLER_EMAIL = "csm23@sfjbs.com";

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
  spocs: RawSpoc[];
}

// One entry per unique client — SPOCs grouped under their client
const RAW_CLIENTS: RawClient[] = [
  {
    clientName: "Samsung Data systems India Pvt Ltd",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Satya P S",
        email: "satyaps@samsung.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "SA Engineering College",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Satya",
        email: "satya.ps@samsung.com",
        phone: null,
        designation: null,
      },
      {
        name: "Dr. Rohini",
        email: "rohiniv@saec.ac.in",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Bitwise Solutions Private Limited",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Pravin Kundekar",
        email: "Pravin.Kundekar@bitwiseglobal.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "volkswagen",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Anurag Malhotra",
        email: "anurag.malhotra@vwgds.in",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Birla soft",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Pragati Lakade",
        email: "pragati.lakade@birlasoft.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "NASSCOM",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Ashvin",
        email: "t-Ashvin@mail.nasscom.in",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "E&Y",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Swati Ojha",
        email: "Swati.Ojha1@in.ey.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "anunta technology management services ltd",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Parag Narkhede",
        email: "Parag.Narkhede@anuntatech.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Dolda Dairy",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Anusha S",
        email: "anusha.s@dodladairy.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Yaskawa",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Raghavendra K",
        email: "raghav_k@yaskawa.in",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "IGT soltuions",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Harpreet Porwal",
        email: "Harpreet.Porwal@igtsolutions.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Cognizant",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Mohammad Yasir",
        email: "MohammadYasir.Khan@cognizant.com",
        phone: null,
        designation: null,
      },
      {
        name: "Bavya B",
        email: "Bavya.B@cognizant.com",
        phone: "7708413382",
        designation: null,
      },
      {
        name: "Muhil Indrajith",
        email: "Muhil.Indrajith@cognizant.com",
        phone: "9894743164",
        designation: null,
      },
      {
        name: "Kavipriya",
        email: "Kavipriya.Paramasivam@cognizant.com",
        phone: "9626801387",
        designation: null,
      },
    ],
  },
  {
    clientName: "Mastek",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Lisha Jain",
        email: "Lisha.Jain@mastek.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "National Skill Development Corporation",
    city: "Delhi",
    state: "Delhi",
    country: "India",
    spocs: [
      {
        name: "Shaunak Ghose",
        email: "shaunak.ghose@nsdcindia.org",
        phone: "8373974948",
        designation: null,
      },
    ],
  },
  {
    clientName: "Siemens",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Ajay Y G",
        email: "ajay.y-g@siemens.com",
        phone: "9611099400",
        designation: null,
      },
    ],
  },
  {
    clientName: "TIETOEVRY FINTECH INDIA PRIVATE LIMITED",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Rupali A S",
        email: "rupali.a.shirsekar@tietoevry.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Aljomaih Bottling Company",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Huthaifa",
        email: "HBdour@ALJOMAIHBEV.com",
        phone: "6567131211",
        designation: null,
      },
    ],
  },
  {
    clientName: "Motherson technologies",
    city: null,
    state: "Karnataka",
    country: "India",
    spocs: [
      {
        name: "Chhavi Jain",
        email: "chhavi.jain@motherson.com",
        phone: "9582605114",
        designation: null,
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

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return parts.length === 1
    ? { firstName: parts[0], lastName: "-" }
    : { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════════════");
  console.log(
    `  AJAY — CLIENT + SPOC MIGRATION  —  ${
      COMMIT ? "LIVE (--commit)" : "DRY RUN"
    }`
  );
  console.log("════════════════════════════════════════════════════════\n");
  if (!COMMIT)
    console.log("  ℹ  No --commit flag — nothing will be written.\n");

  // ── ServiceLine ────────────────────────────────────────────────────────────
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
    const all = await prisma.serviceLine.findMany({
      select: { id: true, name: true, isActive: true },
    });
    console.error("❌  No KaaS ServiceLine found. Tried:", KAAS_VARIANTS);
    console.error("    In DB:", all.map((s) => `"${s.name}"`).join(", "));
    process.exit(1);
  }
  log(`ServiceLine resolved: "${serviceLine.name}"  (id: ${serviceLine.id})`);

  // ── BusinessUnit ───────────────────────────────────────────────────────────
  const targetBU = BU_NAME_ARG ?? "B2B";
  const bu = await prisma.businessUnit.findFirst({
    where: { name: targetBU, isActive: true },
  });
  if (!bu) {
    const all = await prisma.businessUnit.findMany({
      select: { id: true, name: true, isActive: true },
    });
    console.error(
      `❌  BusinessUnit "${targetBU}" not found. In DB:`,
      all.map((b) => `"${b.name}"`).join(", ")
    );
    process.exit(1);
  }
  log(`BusinessUnit resolved: "${bu.name}"  (id: ${bu.id})`);

  // ── Handler ────────────────────────────────────────────────────────────────
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
      console.error(`❌  No role to auto-create handler: ${HANDLER_EMAIL}`);
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
          firstName: "Ajay",
          lastName: "D",
          roleId: fallbackRole.id,
          buId: bu.id,
          isActive: true,
        },
      });
      handlerId = created.id;
      log(`Handler created:  ${HANDLER_EMAIL}  →  ${created.id}`);
    }
  }

  // ── Clients + SPOCs ────────────────────────────────────────────────────────
  let clientsCreated = 0,
    clientsSkipped = 0,
    spocsCreated = 0,
    spocsSkipped = 0;

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
    } else if (!COMMIT) {
      clientId = `[DRY-CLIENT-${raw.clientName}]`;
      log(`  │  Would create Client:`);
      log(`  │    name:    ${raw.clientName}`);
      log(
        `  │    city:    ${raw.city ?? "(none)"}  |  state: ${
          raw.state ?? "(none)"
        }  |  country: ${raw.country}`
      );
      log(`  │    handler: ${handlerId}`);
      clientsCreated++;
    } else {
      const created = await prisma.client.create({
        data: {
          name: raw.clientName,
          city: raw.city ?? undefined,
          state: raw.state ?? undefined,
          country: raw.country,
          status: ClientStatus.ACTIVE,
          businessUnitId: bu.id,
          createdById: handlerId,
        },
      });
      clientId = created.id;
      log(`  │  Client created  →  ${clientId}`);
      clientsCreated++;
    }

    for (let i = 0; i < raw.spocs.length; i++) {
      const spoc = raw.spocs[i];
      const isPrimary = i === 0;

      if (!spoc.email) {
        log(`  │  ⚠  "${spoc.name}" has no email — skip`);
        spocsSkipped++;
        continue;
      }

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

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════════════");
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
