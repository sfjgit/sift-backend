// File: seed.ts
// Path: src/seed.ts
//
// npm run seed — idempotent. Creates SFJBS (the first tenant), its pick-lists,
// Super Admin role and the first admin, who also runs the enterprise console
// (isPlatformAdmin). Super admin needs no permission rows: the permission
// service grants every action at ALL when user.isSuperAdmin.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { ensureTenantLookups } from "./services/tenant.service";

const prisma = new PrismaClient();

const TENANT_SLUG = "sfjbs";
const ADMIN_EMAIL = "siva.sarathy@sfjbs.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin@123";

async function main() {
  console.log("▶ Tenant SFJBS...");
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: { slug: TENANT_SLUG, name: "SFJBS", plan: "ENTERPRISE" },
  });
  const tenantId = tenant.id;

  console.log("▶ Pick-lists...");
  await ensureTenantLookups(prisma, tenantId);

  console.log("▶ Super Admin role...");
  const roleSuperAdmin = await prisma.role.upsert({
    where: { tenantId_name: { tenantId, name: "Super Admin" } },
    update: {},
    create: { tenantId, name: "Super Admin", description: "Full system access", isSystem: true },
  });

  console.log("▶ Super admin user...");
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { isPlatformAdmin: true },
    create: {
      tenantId,
      email: ADMIN_EMAIL,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      firstName: "Siva",
      lastName: "Sarathy",
      employeeId: "SFJ-CEO-001",
      isSuperAdmin: true,
      isPlatformAdmin: true,
      roleId: roleSuperAdmin.id,
    },
  });

  console.log("▶ Service lines...");
  for (const sl of [
    { name: "Knowledge as a Service", code: "KAAS" },
    { name: "Talent as a Service", code: "TAAS" },
  ]) {
    await prisma.serviceLine.upsert({
      where: { tenantId_name: { tenantId, name: sl.name } },
      update: {},
      create: { ...sl, tenantId },
    });
  }

  console.log(`\n✅ Seed complete — tenant ${TENANT_SLUG}, super admin: ${ADMIN_EMAIL}\n`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
