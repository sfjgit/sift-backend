// scripts/fetchIds.js
// Run: node scripts/fetchIds.js
// Prints all real UUIDs from DB so you can use them in API calls / testing

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const [bus, roles, teams, users, clients] = await Promise.all([
    prisma.businessUnit.findMany({ select: { id: true, name: true } }),
    prisma.role.findMany({ select: { id: true, name: true } }),
    prisma.team.findMany({
      select: { id: true, name: true, businessUnitId: true },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: { select: { name: true } },
        businessUnit: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.client.findMany({ select: { id: true, name: true, status: true } }),
  ]);

  console.log("\n═══════════════════════════════════════════");
  console.log("  REAL UUIDs FROM DB");
  console.log("═══════════════════════════════════════════\n");

  console.log("── BUSINESS UNITS ──────────────────────────");
  bus.forEach((b) => console.log(`  ${b.name.padEnd(20)} ${b.id}`));

  console.log("\n── ROLES ───────────────────────────────────");
  roles.forEach((r) => console.log(`  ${r.name.padEnd(20)} ${r.id}`));

  console.log("\n── TEAMS ───────────────────────────────────");
  teams.forEach((t) => console.log(`  ${t.name.padEnd(25)} ${t.id}`));

  console.log("\n── USERS ───────────────────────────────────");
  users.forEach((u) =>
    console.log(
      `  ${(u.firstName + " " + u.lastName).padEnd(25)} ${u.id}  [${
        u.role.name
      }] [${u.businessUnit?.name ?? "no BU"}]`
    )
  );

  console.log("\n── CLIENTS ─────────────────────────────────");
  clients.forEach((c) =>
    console.log(`  ${c.name.padEnd(25)} ${c.id}  [${c.status}]`)
  );

  console.log("\n═══════════════════════════════════════════\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
