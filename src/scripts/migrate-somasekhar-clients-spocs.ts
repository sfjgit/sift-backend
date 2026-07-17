// File: migrate-somasekhar-clients-spocs.ts
// Path: src/scripts/migrate-somasekhar-clients-spocs.ts
//
// Purpose : Seed Client + ClientSpoc rows from Somasekhar's TR-Tool export.
//           Source: client_list_Somasekhar_P_M.xlsx (sheet1 = clients, sheet2 = contacts)
//           27 clients, 30 SPOCs — data hardcoded, no file I/O needed.
//
// Usage:
//   npx tsx src/scripts/migrate-somasekhar-clients-spocs.ts           ← dry run
//   npx tsx src/scripts/migrate-somasekhar-clients-spocs.ts --commit  ← write to DB

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

const HANDLER_EMAIL = "csm19@sfjbs.com";

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

const RAW_CLIENTS: RawClient[] = [
  {
    clientName: "IDFC FIRST BHARAT LIMITED",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://idfcfirstbharat.com/",
    spocs: [
      {
        name: "Seema Salunke",
        email: "seema.salunke@idfcfirst.bank.in",
        phone: null,
        designation: "Learning Manager",
      },
    ],
  },
  {
    clientName: "API Holdings Group",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://www.apiholdings.in/",
    spocs: [
      {
        name: "Gauresh Gaitonde",
        email: "gauresh.gaitonde@apiholdings.in",
        phone: "9552510273",
        designation: "Head of Learning & Development",
      },
      {
        name: "Sneha Kadam",
        email: "sneha.kadan@thyrocare.com",
        phone: "9653379294",
        designation: "Senior Executive L&D",
      },
    ],
  },
  {
    clientName: "Jupiter International Limited",
    city: "Kolkata",
    state: "West Bengal",
    country: "India",
    website: "www.jil-jupiter.com",
    spocs: [
      {
        name: "Saurav Ojha",
        email: "saurav.ojha@jil-jupiter.com",
        phone: "6290236340",
        designation: null,
      },
    ],
  },
  {
    clientName: "Vivicta Private Limited",
    city: "Pune",
    state: "Maharashtra",
    country: "India",
    website: "https://www.vivicta.com/",
    spocs: [
      {
        name: "Somnath Ballal",
        email: "Somnath.Ballal2@vivicta.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Mindsprint",
    city: "Chennai",
    state: "Tamil Nadu",
    country: "India",
    website: "https://www.mindsprint.com/",
    spocs: [
      {
        name: "Vinoth Kumar",
        email: "vinothkumar.r@Mindsprint.com",
        phone: "7305989512",
        designation: null,
      },
    ],
  },
  {
    clientName: "Tata Capital Limited",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://www.tatacapital.com/",
    spocs: [
      {
        name: "Nandini Jha",
        email: "Nandini.Jha@tatacapital.com",
        phone: "9079781374",
        designation: null,
      },
    ],
  },
  {
    clientName: "KPMG India",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://kpmg.com/in/en/about/offices.html",
    spocs: [
      {
        name: "Shruti Shetty",
        email: "shrutishetty2@kpmg.com",
        phone: "9769494646",
        designation: null,
      },
    ],
  },
  {
    clientName: "Indium Software (India) Private Limited",
    city: "Chennai",
    state: "Tamil Nadu",
    country: "India",
    website: "https://www.indium.tech/",
    spocs: [
      {
        name: "Mangala Preetha",
        email: "mangalapreetha.s@indium.tech",
        phone: "9884008627",
        designation: null,
      },
    ],
  },
  {
    clientName: "Tech Mahindra",
    city: "Delhi",
    state: "Delhi",
    country: "India",
    website: "https://www.techmahindra.com/contact-us/",
    spocs: [
      {
        name: "Kashif Masood",
        email: "kashif.masood@techmahindra.com",
        phone: "9717038585",
        designation: null,
      },
    ],
  },
  {
    clientName: "Christ College of Engineering",
    city: null,
    state: "Karnataka",
    country: "India",
    website: "https://www.cce.edu.in/",
    spocs: [
      {
        name: "Suni Jose",
        email: "sunijose.cs@cce.edu.in",
        phone: "7994532402",
        designation: "Assistant Professor",
      },
    ],
  },
  {
    clientName: "Suryoday Small Finance Bank",
    city: "Navi Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://suryoday.bank.in/",
    spocs: [
      {
        name: "Tripti Kaushal",
        email: "tripti.kaushal@suryodaybank.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Azentio Software Private Limited",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    website: "https://www.azentio.com/",
    spocs: [
      {
        name: "Aashish Pillai",
        email: "aashish.pillai@azentio.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "AU Small Finance Bank Limited",
    city: "Jaipur",
    state: "Rajasthan",
    country: "India",
    website: "https://www.aubank.in/",
    spocs: [
      {
        name: "Pankaj Kumar",
        email: "pankaj.kumar31@aubank.in",
        phone: "8306993976",
        designation: null,
      },
    ],
  },
  {
    clientName: "Yash Technologies",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://www.yash.com/",
    spocs: [
      {
        name: "Ishank Chhibber",
        email: "vendortrainings@yash.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Smcc Construction India Pvt Ltd",
    city: null,
    state: "Karnataka",
    country: "India",
    website: "https://www.smcon.co.in/public/welcome",
    spocs: [
      {
        name: "Anugrah Sharma",
        email: "Anugrah.Sharma@smcon.co.in",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Orange Business Services India Technology Private Limited",
    city: "Vashi, Navi Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://www.orange.com/",
    spocs: [
      {
        name: "Pratima Singh",
        email: "pratima.singh@orange.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Coforge Limited",
    city: "Greater Noida",
    state: "Uttar Pradesh",
    country: "India",
    website: "https://www.coforge.com/",
    spocs: [
      {
        name: "Vipin Gaur",
        email: "vipin.gaur@coforge.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Prolifics",
    city: "Hyderabad",
    state: "Telangana",
    country: "India",
    website: "https://prolifics.com/usa/",
    spocs: [
      {
        name: "Dhwani Jain",
        email: "Dhwani.Jain@prolifics.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Sify Technologies",
    city: "Chennai",
    state: "Tamil Nadu",
    country: "India",
    website: "https://www.sifytechnologies.com/",
    spocs: [
      {
        name: "Saritha Tellapudi",
        email: "Saritha.Tellapudi@sifycorp.Com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "invenioLSI",
    city: "Navi Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://invenio-solutions.com/",
    spocs: [
      {
        name: "Varun Singh",
        email: "varun.singh@invenio-solutions.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Welspun Transformation Services Limited",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    website: "https://welspungcc.com/",
    spocs: [
      {
        name: "Pallav Sinha",
        email: "Pallav_Sinha@welspun.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Quest Global",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    website: "https://www.questglobal.com/",
    spocs: [
      {
        name: "Hemanth Bopaiahy",
        email: "Hemanth.bopaiahc@quest-global.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "IOPEX TECHNOLOGIES PRIVATE LIMITED",
    city: "Chennai",
    state: "Tamil Nadu",
    country: "India",
    website: "https://www.iopex.com/",
    spocs: [
      {
        name: "Priya T S",
        email: "Priya.ts@iopex.com",
        phone: "9444236047",
        designation: null,
      },
    ],
  },
  {
    clientName: "NTT Data Inc",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    website: "https://www.nttdata.com/global/en/",
    spocs: [
      {
        name: "Gopan Govindan",
        email: "gopan.govindan@global.ntt",
        phone: null,
        designation: null,
      },
      {
        name: "Jijo Mohan",
        email: "jijo.mohan@nttdata.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Keysight Technologies Pvt Ltd",
    city: "Delhi",
    state: "Delhi",
    country: "India",
    website: "https://www.keysight.com/us/en/home.html",
    spocs: [
      {
        name: "Manav Ratra",
        email: "manav_ratra@keysight.com",
        phone: "9818006209",
        designation: null,
      },
    ],
  },
  {
    clientName: "Evergent Technologies Private Limited",
    city: "Hyderabad",
    state: "Telangana",
    country: "India",
    website: "https://evergent.com/",
    spocs: [
      {
        name: "Sushanth Sabineni",
        email: "sushanth.sabineni@evergent.com",
        phone: null,
        designation: null,
      },
    ],
  },
  {
    clientName: "Keysight Technologies Pvt Ltd",
    city: "Delhi",
    state: "Delhi",
    country: "India",
    website: "https://www.keysight.com/us/en/home.html",
    spocs: [], // deduped — Manav Ratra already listed above
  },
];

// Filter out empty-spoc dedup entry
const CLIENTS = RAW_CLIENTS.filter(
  (c) => c.spocs.length > 0 || RAW_CLIENTS.indexOf(c) === 0
);

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
    `  SOMASEKHAR — CLIENT + SPOC MIGRATION  —  ${
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
          firstName: "Somasekhar",
          lastName: "P M",
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

  // Deduplicate clients list (Keysight appears twice in source)
  const seen = new Set<string>();
  const uniqueClients = RAW_CLIENTS.filter((c) => {
    if (seen.has(c.clientName)) return false;
    seen.add(c.clientName);
    return true;
  });

  for (const raw of uniqueClients) {
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
      log(`  │    website: ${raw.website ?? "(none)"}`);
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
