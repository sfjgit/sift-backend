// File: migrate-yatin-requirements.ts
// Path: src/scripts/migrate-yatin-requirements.ts
//
// Purpose : Seed Requirement rows from Yatin's BulkRequirement Excel export.
//           Source file: TalentOS_BulkRequirement_Template_(2).xlsx
//           Data is hardcoded below — 10 requirements across 3 clients.
//
// ⚠  RUN ORDER — this script must run AFTER migrate-yatin-clients-spocs.ts
//    so that TATA CONSULTANCY SERVICES LIMITED, WIPRO LIMITED, and NPCI
//    already exist in the DB for the client lookup to succeed.
//
// Usage:
//   npx tsx src/scripts/migrate-yatin-requirements.ts           ← dry run (safe, default)
//   npx tsx src/scripts/migrate-yatin-requirements.ts --commit  ← write to DB
//
// Options:
//   --commit          Actually write to the database. Without it, nothing is touched.
//   --bu <name>       Target a specific BusinessUnit by name. Default: B2B.
//   --req-prefix <p>  reqCode prefix to use. Default: KAA-YA-
//                     Codes are auto-sequenced: KAA-YA-001, KAA-YA-002, …
//                     The script reads existing codes with this prefix to avoid collisions.
//
// Assumptions:
//   • Clients "TATA CONSULTANCY SERVICES LIMITED", "WIPRO LIMITED", "NPCI" exist in DB.
//     (Created by migrate-yatin-clients-spocs.ts)
//   • ServiceLine "Knowledge as a Service" (KaaS) exists in DB.
//   • BusinessUnit "B2B" exists in DB.
//   • Handler / creator: anand.y@sfjbs.com (Yatin Anand) — looked up by email.
//   • clientSpocId is left null — update manually or via a follow-up script if needed.
//   • All requirements seeded as DRAFT.
//
// Client name aliases used in the source Excel → full DB name:
//   "TCS"   → "TATA CONSULTANCY SERVICES LIMITED"
//   "Wipro" → "WIPRO LIMITED"
//   "NPCI"  → "NPCI"
//
// Date note (Tanium row only):
//   Excel serials 46217 / 46230 were converted offline → 2026-07-13 / 2026-07-26.

import {
  PrismaClient,
  RequirementType,
  RemoteType,
  Priority,
  RequirementStatus,
  SalaryType,
  JobOpenFor,
} from "@prisma/client";

const prisma = new PrismaClient();

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");

const buFlagIdx = args.indexOf("--bu");
const BU_NAME_ARG: string | null =
  buFlagIdx !== -1 ? args[buFlagIdx + 1] ?? null : null;

const prefixFlagIdx = args.indexOf("--req-prefix");
const REQ_PREFIX: string =
  prefixFlagIdx !== -1 ? args[prefixFlagIdx + 1] ?? "KAA-YA-" : "KAA-YA-";

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT ALIAS MAP
// Maps short names from the source Excel → full client names in DB.
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_ALIAS: Record<string, string> = {
  TCS: "TATA CONSULTANCY SERVICES LIMITED",
  Wipro: "WIPRO LIMITED",
  NPCI: "NPCI",
};

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA — extracted from TalentOS_BulkRequirement_Template_(2).xlsx
// 10 requirements, handler: anand.y@sfjbs.com
//
// Data quality notes from source file:
//   • SAP Honeywell: state column shows "Hyderabad" (should be Telangana) —
//     kept as-is to preserve source fidelity; correct manually if needed.
//   • "N/A" values for education / functionalArea → stored as null here.
//   • Unix Admin title had a leading ": " stripped.
//   • primarySkills / keySkills are single-value arrays (as in source).
// ─────────────────────────────────────────────────────────────────────────────

interface RawRequirement {
  title: string;
  clientAlias: string; // key into CLIENT_ALIAS
  jobType: RequirementType;
  remoteType: RemoteType;
  priority: Priority;
  jobOpenFor: JobOpenFor;
  totalOpenings: number;
  status: RequirementStatus;
  primarySkills: string[];
  keySkills: string[];
  city: string | null;
  state: string | null;
  country: string;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryType: SalaryType | null;
  salaryCurrency: string;
  hideSalaryFromCandidate: boolean;
  education: string | null;
  functionalArea: string | null;
  shift: string | null;
  targetCompanies: string[];
  noPoachCompanies: string[];
  startDate: Date | null;
  targetDate: Date | null;
  respondBy: Date | null;
  turnaroundDays: number | null;
  description: string | null;
}

const RAW_REQUIREMENTS: RawRequirement[] = [
  // ── TCS requirements ──────────────────────────────────────────────────────
  {
    title: "Tanium",
    clientAlias: "TCS",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["Tanium"],
    keySkills: ["Tanium"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["TCS"],
    // Excel serials 46217 / 46230 → 2026-07-13 / 2026-07-26
    startDate: new Date("2026-07-13T00:00:00.000Z"),
    targetDate: new Date("2026-07-26T00:00:00.000Z"),
    respondBy: new Date("2026-07-13T00:00:00.000Z"),
    turnaroundDays: 3,
    description: null,
  },
  {
    title: "SAP Honeywell Requirements",
    clientAlias: "TCS",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.ONSITE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["SAP", "Honeywell"],
    keySkills: ["SAP Honeywell"],
    city: "Hyderabad",
    state: "Hyderabad", // ⚠ source data — likely meant "Telangana"; correct if needed
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 1200000,
    salaryMax: 1200000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["TCS"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },

  // ── Wipro requirements ────────────────────────────────────────────────────
  {
    title: "Pega",
    clientAlias: "Wipro",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["Pega"],
    keySkills: ["Pega"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["Wipro"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
  {
    title: "SAP Financial Accounting and Controlling Training",
    clientAlias: "Wipro",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["SAP FICO", "SAP Financial Accounting"],
    keySkills: ["SAP Controlling", "SAP FICO"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["Wipro"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
  {
    title: "FDE",
    clientAlias: "Wipro",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["FDE"],
    keySkills: ["FDE"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["Wipro"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
  {
    title: "Automotive Cloud Advanced Training",
    clientAlias: "Wipro",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["Automotive Cloud"],
    keySkills: ["Automotive Cloud", "Cloud Training"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["Wipro"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
  {
    title: "Unix Admin / Openshift Admin",
    // ↑ leading ": " stripped from source — original: ": Unix Admin_Openshift Admin"
    clientAlias: "Wipro",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["Unix Admin", "OpenShift"],
    keySkills: ["Unix Admin", "OpenShift Admin", "Linux"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["Wipro"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },

  // ── NPCI requirements ─────────────────────────────────────────────────────
  {
    title: "Agentic AI for Finance and Relationship Management Teams",
    clientAlias: "NPCI",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["Agentic AI", "Generative AI"],
    keySkills: ["Agentic AI", "LLM", "Finance AI", "Relationship Management"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["NPCI"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
  {
    title: "Site Reliability Engineering (SRE)",
    clientAlias: "NPCI",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["SRE", "Site Reliability Engineering"],
    keySkills: ["SRE", "Kubernetes", "Observability", "Incident Management"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["NPCI"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
  {
    title: "Generative AI for Developers",
    clientAlias: "NPCI",
    jobType: RequirementType.CONTRACT,
    remoteType: RemoteType.REMOTE,
    priority: Priority.MEDIUM,
    jobOpenFor: JobOpenFor.EXTERNAL,
    totalOpenings: 1,
    status: RequirementStatus.DRAFT,
    primarySkills: ["Generative AI", "LLM"],
    keySkills: ["Generative AI", "LLM", "Prompt Engineering", "Python"],
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    experienceMin: 10,
    experienceMax: 10,
    salaryMin: 500000,
    salaryMax: 500000,
    salaryType: SalaryType.DAILY,
    salaryCurrency: "INR",
    hideSalaryFromCandidate: false,
    education: null,
    functionalArea: null,
    shift: "Flexible",
    targetCompanies: [],
    noPoachCompanies: ["NPCI"],
    startDate: null,
    targetDate: null,
    respondBy: null,
    turnaroundDays: null,
    description: null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${COMMIT ? "LIVE" : "DRY "}] ${msg}`);
}

/**
 * Find the next available reqCode under a given prefix.
 * Reads existing DB codes so re-runs never collide.
 * e.g. prefix "KAA-YA-" + existing ["KAA-YA-001","KAA-YA-002"] → next = 3
 */
async function getStartingSequence(prefix: string): Promise<number> {
  const existing = await prisma.requirement.findMany({
    where: { reqCode: { startsWith: prefix } },
    select: { reqCode: true },
  });
  if (existing.length === 0) return 1;
  const nums = existing
    .map((r) => parseInt(r.reqCode.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function padSeq(n: number): string {
  return String(n).padStart(3, "0");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log(
    `  YATIN — REQUIREMENTS MIGRATION  —  ${
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

  // ── 3. Resolve creator (Yatin) ────────────────────────────────────────────
  const HANDLER_EMAIL = "anand.y@sfjbs.com";
  const handler = await prisma.user.findUnique({
    where: { email: HANDLER_EMAIL },
  });
  if (!handler) {
    console.error(
      `❌  Handler "${HANDLER_EMAIL}" not found in DB.\n` +
        `    Run migrate-yatin-clients-spocs.ts --commit first — it creates the user if missing.`
    );
    process.exit(1);
  }
  log(
    `Creator resolved:  ${HANDLER_EMAIL}  →  ${handler.firstName} ${handler.lastName}  (${handler.id})`
  );

  // ── 4. Resolve all unique client aliases up front ─────────────────────────
  const uniqueAliases = [
    ...new Set(RAW_REQUIREMENTS.map((r) => r.clientAlias)),
  ];
  const clientMap = new Map<string, string>(); // alias → DB client id

  console.log("\n  ── Resolving clients ─────────────────────────────────────");
  for (const alias of uniqueAliases) {
    const fullName = CLIENT_ALIAS[alias];
    if (!fullName) {
      console.error(
        `❌  No CLIENT_ALIAS mapping for "${alias}". Add it to CLIENT_ALIAS in this script.`
      );
      process.exit(1);
    }
    const client = await prisma.client.findFirst({
      where: { name: fullName, deletedAt: null },
    });
    if (!client) {
      console.error(
        `❌  Client "${fullName}" (alias "${alias}") not found in DB.\n` +
          `    Run migrate-yatin-clients-spocs.ts --commit first.`
      );
      process.exit(1);
    }
    clientMap.set(alias, client.id);
    log(`  Client "${alias}" → "${fullName}"  (id: ${client.id})`);
  }

  // ── 5. Determine starting reqCode sequence ────────────────────────────────
  const startSeq = await getStartingSequence(REQ_PREFIX);
  log(`\n  reqCode prefix: "${REQ_PREFIX}"  |  starting sequence: ${startSeq}`);

  // ── 6. Process each requirement ───────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  let seq = startSeq;

  console.log("\n  ── Processing requirements ───────────────────────────────");
  for (const raw of RAW_REQUIREMENTS) {
    const reqCode = `${REQ_PREFIX}${padSeq(seq)}`;
    const clientId = clientMap.get(raw.clientAlias)!;

    console.log(`\n  ┌─ [${reqCode}] ${raw.title}`);
    log(`  │  client:  ${raw.clientAlias} → ${clientId}`);

    // Dedup: skip if a requirement with the same title + clientId already exists (DRAFT)
    const duplicate = await prisma.requirement.findFirst({
      where: {
        title: raw.title,
        clientId,
        status: RequirementStatus.DRAFT,
        deletedAt: null,
      },
    });
    if (duplicate) {
      log(`  │  ⚠  Duplicate found (reqCode: ${duplicate.reqCode}) — skip`);
      skipped++;
      console.log(`  └─ skipped`);
      continue;
    }

    if (!COMMIT) {
      log(`  │  Would create Requirement:`);
      log(`  │    title:          ${raw.title}`);
      log(`  │    jobType:        ${raw.jobType}`);
      log(`  │    remoteType:     ${raw.remoteType}`);
      log(`  │    priority:       ${raw.priority}`);
      log(`  │    totalOpenings:  ${raw.totalOpenings}`);
      log(`  │    status:         ${raw.status}`);
      log(`  │    primarySkills:  ${raw.primarySkills.join(", ")}`);
      log(`  │    keySkills:      ${raw.keySkills.join(", ")}`);
      log(`  │    location:       ${raw.city}, ${raw.state}, ${raw.country}`);
      log(
        `  │    experience:     ${raw.experienceMin}–${raw.experienceMax} yrs`
      );
      log(
        `  │    salary:         ${raw.salaryMin}–${raw.salaryMax} ${raw.salaryType} ${raw.salaryCurrency}`
      );
      if (raw.noPoachCompanies.length > 0)
        log(`  │    noPoach:        ${raw.noPoachCompanies.join(", ")}`);
      if (raw.startDate)
        log(
          `  │    startDate:      ${raw.startDate.toISOString().slice(0, 10)}`
        );
      if (raw.targetDate)
        log(
          `  │    targetDate:     ${raw.targetDate.toISOString().slice(0, 10)}`
        );
      if (raw.respondBy)
        log(
          `  │    respondBy:      ${raw.respondBy.toISOString().slice(0, 10)}`
        );
      if (raw.turnaroundDays)
        log(`  │    turnaround:     ${raw.turnaroundDays} days`);
      created++;
      seq++;
    } else {
      await prisma.requirement.create({
        data: {
          reqCode,
          title: raw.title,
          jobType: raw.jobType,
          remoteType: raw.remoteType,
          priority: raw.priority,
          jobOpenFor: raw.jobOpenFor,
          totalOpenings: raw.totalOpenings,
          status: raw.status,
          primarySkills: raw.primarySkills,
          keySkills: raw.keySkills,
          city: raw.city ?? undefined,
          state: raw.state ?? undefined,
          country: raw.country,
          experienceMin: raw.experienceMin ?? undefined,
          experienceMax: raw.experienceMax ?? undefined,
          salaryMin: raw.salaryMin ?? undefined,
          salaryMax: raw.salaryMax ?? undefined,
          salaryType: raw.salaryType ?? undefined,
          salaryCurrency: raw.salaryCurrency,
          hideSalaryFromCandidate: raw.hideSalaryFromCandidate,
          education: raw.education ?? undefined,
          functionalArea: raw.functionalArea ?? undefined,
          shift: raw.shift ?? undefined,
          targetCompanies: raw.targetCompanies,
          noPoachCompanies: raw.noPoachCompanies,
          startDate: raw.startDate ?? undefined,
          targetDate: raw.targetDate ?? undefined,
          respondBy: raw.respondBy ?? undefined,
          turnaroundDays: raw.turnaroundDays ?? undefined,
          description: raw.description ?? undefined,
          clientId,
          businessUnitId: bu.id,
          serviceLineId: serviceLine.id,
          // clientSpocId intentionally null — link manually or via follow-up script
          createdById: handler.id,
        },
      });
      log(`  │  Requirement created  →  ${reqCode}`);
      created++;
      seq++;
    }

    console.log(`  └─ done`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("════════════════════════════════════════════════");
  console.log(`  Requirements created : ${created}`);
  console.log(`  Requirements skipped : ${skipped}  (duplicate DRAFT found)`);
  if (created > 0 && !COMMIT) {
    console.log(
      `  reqCodes that would be used: ${REQ_PREFIX}${padSeq(
        startSeq
      )} … ${REQ_PREFIX}${padSeq(startSeq + created - 1)}`
    );
  }

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
