// File: scripts/wipe-business-data.ts
// Usage: npx ts-node -r tsconfig-paths/register scripts/wipe-business-data.ts
//
// WIPES: all business data — requirements, assignments, candidates, clients
// KEEPS: users, roles, permissions, org hierarchy, departments, BUs, service lines

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const G = "\x1b[32m";
const D = "\x1b[90m";
const RESET = "\x1b[0m";

async function wipe() {
  console.log("Starting wipe...\n");

  // 1. Stage logs
  const d1 = await prisma.candidatePipelineStageLog.deleteMany({});
  console.log(
    `${D}CandidatePipelineStageLog${RESET}   → ${G}${d1.count} deleted${RESET}`
  );

  // 2. Pipeline rows
  const d2 = await prisma.requirementCandidatePipeline.deleteMany({});
  console.log(
    `${D}RequirementCandidatePipeline${RESET} → ${G}${d2.count} deleted${RESET}`
  );

  // 3. Snapshots
  const d3 = await prisma.candidateSnapshot.deleteMany({});
  console.log(
    `${D}CandidateSnapshot${RESET}            → ${G}${d3.count} deleted${RESET}`
  );

  // 4. Assignments — children before parents (self-relation)
  const d4a = await prisma.requirementAssignment.deleteMany({
    where: { depth: { gt: 0 } },
  });
  const d4b = await prisma.requirementAssignment.deleteMany({});
  console.log(
    `${D}RequirementAssignment${RESET}        → ${G}${
      d4a.count + d4b.count
    } deleted${RESET}`
  );

  // 5. Requirement sub-tables
  const d5 = await prisma.requirementDocument.deleteMany({});
  console.log(
    `${D}RequirementDocument${RESET}          → ${G}${d5.count} deleted${RESET}`
  );

  const d6 = await prisma.requirementNote.deleteMany({});
  console.log(
    `${D}RequirementNote${RESET}              → ${G}${d6.count} deleted${RESET}`
  );

  const d7 = await prisma.requirementActivity.deleteMany({});
  console.log(
    `${D}RequirementActivity${RESET}          → ${G}${d7.count} deleted${RESET}`
  );

  const d8 = await prisma.requirementStatusHistory.deleteMany({});
  console.log(
    `${D}RequirementStatusHistory${RESET}     → ${G}${d8.count} deleted${RESET}`
  );

  // 6. Parsed JD library
  const d9 = await prisma.parsedJDLibrary.deleteMany({});
  console.log(
    `${D}ParsedJDLibrary${RESET}              → ${G}${d9.count} deleted${RESET}`
  );

  // 7. Requirements
  const d10 = await prisma.requirement.deleteMany({});
  console.log(
    `${D}Requirement${RESET}                  → ${G}${d10.count} deleted${RESET}`
  );

  // 8. Client sub-tables
  const d11 = await prisma.clientNote.deleteMany({});
  console.log(
    `${D}ClientNote${RESET}                   → ${G}${d11.count} deleted${RESET}`
  );

  const d12 = await prisma.clientSpocDM.deleteMany({});
  console.log(
    `${D}ClientSpocDM${RESET}                 → ${G}${d12.count} deleted${RESET}`
  );

  const d13 = await prisma.clientSpoc.deleteMany({});
  console.log(
    `${D}ClientSpoc${RESET}                   → ${G}${d13.count} deleted${RESET}`
  );

  // 9. Clients — children before parents
  const d14a = await prisma.client.deleteMany({
    where: { parentClientId: { not: null } },
  });
  const d14b = await prisma.client.deleteMany({});
  console.log(
    `${D}Client${RESET}                       → ${G}${
      d14a.count + d14b.count
    } deleted${RESET}`
  );

  // 10. Notifications + audit logs
  const d15 = await prisma.notification.deleteMany({});
  console.log(
    `${D}Notification${RESET}                 → ${G}${d15.count} deleted${RESET}`
  );

  const d16 = await prisma.auditLog.deleteMany({});
  console.log(
    `${D}AuditLog${RESET}                     → ${G}${d16.count} deleted${RESET}`
  );

  // Summary of what was kept
  const [users, roles, bus, sls, depts] = await Promise.all([
    prisma.user.count(),
    prisma.role.count(),
    prisma.businessUnit.count(),
    prisma.serviceLine.count(),
    prisma.department.count(),
  ]);

  console.log(`
${G}Done. Preserved:${RESET}
  Users           ${users}
  Roles           ${roles}
  Business Units  ${bus}
  Service Lines   ${sls}
  Departments     ${depts}
`);
}

wipe()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
