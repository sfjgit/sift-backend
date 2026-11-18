// File: mergeUsers.ts
// Path: src/scripts/mergeUsers.ts
//
// One-off data fix (18 Nov 2026): the same person exists twice — a real login
// and a copy made by the CASPA import. Moves the live work of FROM onto INTO:
// reporting line, team-lead links, active client / SPOC assignments, SPOCs
// handled, key-account stars, tasks, BU / service-line access, legacyCaspaId.
// History (who created / logged / approved what) stays with FROM, which is
// deactivated and loses super admin. Every touched row id is saved first.
//
//   npx tsx src/scripts/mergeUsers.ts <fromEmail> <intoEmail>            # dry run
//   npx tsx src/scripts/mergeUsers.ts <fromEmail> <intoEmail> --apply    # do it

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [fromEmail, intoEmail] = process.argv.slice(2);
const apply = process.argv.includes("--apply");

async function main() {
  if (!fromEmail || !intoEmail) throw new Error("usage: mergeUsers <fromEmail> <intoEmail> [--apply]");
  const sel = { id: true, email: true, firstName: true, lastName: true, tenantId: true, legacyCaspaId: true, isSuperAdmin: true, isActive: true } as const;
  const from = await prisma.user.findUniqueOrThrow({ where: { email: fromEmail }, select: sel });
  const into = await prisma.user.findUniqueOrThrow({ where: { email: intoEmail }, select: sel });
  if (from.id === into.id) throw new Error("same user");
  if (from.tenantId !== into.tenantId) throw new Error("different companies — refusing");

  // what would move
  const [reports, teamMembers, clientAssign, intoClientAssign, spocAssign, intoSpocAssign, handled, keyClients, keySpocs, tasks, bus, sls] =
    await Promise.all([
      prisma.user.findMany({ where: { reportingToId: from.id }, select: { id: true } }),
      prisma.user.findMany({ where: { teamLeadId: from.id }, select: { id: true } }),
      prisma.clientAssignment.findMany({ where: { userId: from.id, endedAt: null }, select: { id: true, clientId: true } }),
      prisma.clientAssignment.findMany({ where: { userId: into.id, endedAt: null }, select: { clientId: true } }),
      prisma.clientSpocAssignment.findMany({ where: { assignedToId: from.id, endedAt: null }, select: { id: true, spocId: true } }),
      prisma.clientSpocAssignment.findMany({ where: { assignedToId: into.id, endedAt: null }, select: { spocId: true } }),
      prisma.clientSpoc.findMany({ where: { handlerId: from.id }, select: { id: true } }),
      prisma.clientKeyAccount.findMany({ where: { userId: from.id }, select: { clientId: true } }),
      prisma.clientSpoc.findMany({ where: { keyAccountUserId: from.id }, select: { id: true } }),
      prisma.workTask.findMany({ where: { assigneeId: from.id }, select: { id: true } }),
      prisma.userBusinessUnit.findMany({ where: { userId: from.id }, select: { businessUnitId: true } }),
      prisma.userServiceLine.findMany({ where: { userId: from.id }, select: { serviceLineId: true } }),
    ]);
  const intoClients = new Set(intoClientAssign.map((a) => a.clientId));
  const intoSpocs = new Set(intoSpocAssign.map((a) => a.spocId));
  const plan = {
    from,
    into,
    reports: reports.map((r) => r.id),
    teamMembers: teamMembers.map((r) => r.id),
    clientAssignMove: clientAssign.filter((a) => !intoClients.has(a.clientId)).map((a) => a.id),
    clientAssignEnd: clientAssign.filter((a) => intoClients.has(a.clientId)).map((a) => a.id),
    spocAssignMove: spocAssign.filter((a) => !intoSpocs.has(a.spocId)).map((a) => a.id),
    spocAssignEnd: spocAssign.filter((a) => intoSpocs.has(a.spocId)).map((a) => a.id),
    spocsHandled: handled.map((r) => r.id),
    keyAccountClients: keyClients.map((r) => r.clientId),
    keyAccountSpocs: keySpocs.map((r) => r.id),
    tasks: tasks.map((r) => r.id),
    businessUnits: bus.map((r) => r.businessUnitId),
    serviceLines: sls.map((r) => r.serviceLineId),
  };
  const counts = Object.fromEntries(Object.entries(plan).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
  console.log(`${from.email}  →  ${into.email}`);
  console.log(counts);
  console.log(`legacyCaspaId ${from.legacyCaspaId} moves to ${into.email}; ${from.email} is deactivated and loses super admin.`);
  if (!apply) return console.log("\nDry run — nothing changed. Add --apply to do it.");

  const dir = join(__dirname, "../../data-fixes");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `merge-${from.id}-into-${into.id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(plan, null, 2));
  console.log(`backup: ${file}`);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // unique legacyCaspaId: clear it on FROM before INTO takes it
    await tx.user.update({ where: { id: from.id }, data: { legacyCaspaId: null, isActive: false, isSuperAdmin: false, reportingToId: null, teamLeadId: null } });
    await tx.user.update({ where: { id: into.id }, data: { ...(into.legacyCaspaId == null && from.legacyCaspaId != null && { legacyCaspaId: from.legacyCaspaId }) } });
    await tx.user.updateMany({ where: { id: { in: plan.reports, not: into.id } }, data: { reportingToId: into.id } });
    await tx.user.updateMany({ where: { id: { in: plan.teamMembers, not: into.id } }, data: { teamLeadId: into.id } });
    await tx.clientAssignment.updateMany({ where: { id: { in: plan.clientAssignMove } }, data: { userId: into.id } });
    await tx.clientAssignment.updateMany({ where: { id: { in: plan.clientAssignEnd } }, data: { endedAt: now } });
    await tx.clientSpocAssignment.updateMany({ where: { id: { in: plan.spocAssignMove } }, data: { assignedToId: into.id } });
    await tx.clientSpocAssignment.updateMany({ where: { id: { in: plan.spocAssignEnd } }, data: { endedAt: now } });
    await tx.clientSpoc.updateMany({ where: { id: { in: plan.spocsHandled } }, data: { handlerId: into.id } });
    await tx.clientSpoc.updateMany({ where: { id: { in: plan.keyAccountSpocs } }, data: { keyAccountUserId: into.id } });
    await tx.clientKeyAccount.createMany({ data: plan.keyAccountClients.map((clientId) => ({ clientId, userId: into.id })), skipDuplicates: true });
    await tx.clientKeyAccount.deleteMany({ where: { userId: from.id } });
    await tx.workTask.updateMany({ where: { id: { in: plan.tasks } }, data: { assigneeId: into.id } });
    await tx.userBusinessUnit.createMany({ data: plan.businessUnits.map((businessUnitId) => ({ userId: into.id, businessUnitId })), skipDuplicates: true });
    await tx.userServiceLine.createMany({ data: plan.serviceLines.map((serviceLineId) => ({ userId: into.id, serviceLineId })), skipDuplicates: true });
    await tx.refreshToken.deleteMany({ where: { userId: from.id } });
  });
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
