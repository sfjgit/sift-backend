// File: seed.ts
// Path: src/seed.ts
//
// npm run seed — idempotent. Super admin needs no permission rows: the
// permission service grants every action at ALL when user.isSuperAdmin.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "siva.sarathy@sfjbs.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin@123";

async function main() {
  console.log("▶ Seeding Super Admin role...");
  const roleSuperAdmin = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: {},
    create: {
      name: "Super Admin",
      description: "Full system access",
      isSystem: true,
    },
  });

  console.log("▶ Seeding super admin user...");
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      firstName: "Siva",
      lastName: "Sarathy",
      employeeId: "SFJ-CEO-001",
      isSuperAdmin: true,
      roleId: roleSuperAdmin.id,
    },
  });

  console.log("▶ Seeding service lines...");
  for (const sl of [
    { name: "Knowledge as a Service", code: "KAAS" },
    { name: "Talent as a Service", code: "TAAS" },
  ]) {
    await prisma.serviceLine.upsert({ where: { name: sl.name }, update: {}, create: sl });
  }

  console.log(`\n✅ Seed complete — super admin: ${ADMIN_EMAIL}\n`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
