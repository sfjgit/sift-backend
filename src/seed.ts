// File: seed.ts
// Path: prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors SYSTEM_MODULES in role.controller.ts — keep in sync manually
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_MODULES = [
  "requirements",
  "clients",
  "candidates",
  "users",
  "roles",
  "business-units",
  "departments",
  "service-lines",
  "audit-logs",
  "reports",
  "settings",
  "pipeline-stages",
] as const;

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         TalentOS Seed Starting           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN ROLE
  // ALL scope on every module in SYSTEM_MODULES
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding Super Admin role...");

  const roleSuperAdmin = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: {},
    create: {
      name: "Super Admin",
      description: "Full system access",
      isSystem: true,
      permissions: {
        create: SYSTEM_MODULES.map((module) => ({
          module,
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
          canViewScope: "ALL" as const,
          canAddScope: "ALL" as const,
          canEditScope: "ALL" as const,
          canDeleteScope: "ALL" as const,
        })),
      },
    },
  });

  console.log("  ✓ Super Admin role created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // SIVA SARATHY — Super Admin user
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding Siva Sarathy...");

  await prisma.user.upsert({
    where: { email: "siva.sarathy@sfjbs.com" },
    update: {},
    create: {
      email: "siva.sarathy@sfjbs.com",
      passwordHash: bcrypt.hashSync("admin@123", 10),
      firstName: "Siva",
      lastName: "Sarathy",
      employeeId: "SFJ-CEO-001",
      isActive: true,
      isSuperAdmin: true,
      roleId: roleSuperAdmin.id,
    },
  });

  console.log("  ✓ Siva Sarathy created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // SERVICE LINES — needed by pipeline stages
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding service lines...");

  const slKaaS = await prisma.serviceLine.upsert({
    where: { name: "Knowledge as a Service" },
    update: {},
    create: { name: "Knowledge as a Service", code: "KAAS", isActive: true },
  });

  const slTaaS = await prisma.serviceLine.upsert({
    where: { name: "Talent as a Service" },
    update: {},
    create: { name: "Talent as a Service", code: "TAAS", isActive: true },
  });

  console.log("  ✓ Service lines created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // PIPELINE STAGES
  // 01–06  → serviceLineId null  (applies to all service lines)
  // 07–10  → paired variants: A = TaaS, B = KaaS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding pipeline stages...");

  const mkStage = (data: {
    code: string;
    label: string;
    order: number;
    serviceLineId?: string | null;
    isMandatory?: boolean;
    isTerminal?: boolean;
  }) =>
    prisma.pipelineStage.upsert({
      where: { code: data.code },
      update: {},
      create: {
        code: data.code,
        label: data.label,
        order: data.order,
        serviceLineId: data.serviceLineId ?? null,
        isMandatory: data.isMandatory ?? true,
        isTerminal: data.isTerminal ?? false,
        isActive: true,
      },
    });

  // Shared stages
  await mkStage({ code: "01", label: "Sourced", order: 1 });
  await mkStage({ code: "02", label: "Pre Screened", order: 2 });
  await mkStage({ code: "03", label: "Submitted for Interview", order: 3 });
  await mkStage({ code: "04", label: "L1", order: 4 });
  await mkStage({ code: "05", label: "L2", order: 5, isMandatory: false });
  await mkStage({ code: "06", label: "Document Collection", order: 6 });

  // Order 7
  await mkStage({
    code: "07B",
    label: "NDA Released / Contract",
    order: 7,
    serviceLineId: slKaaS.id,
  });
  await mkStage({
    code: "07A",
    label: "Offered",
    order: 7,
    serviceLineId: slTaaS.id,
  });

  // Order 8
  await mkStage({
    code: "08B",
    label: "Contract Acceptance",
    order: 8,
    serviceLineId: slKaaS.id,
  });
  await mkStage({
    code: "08A",
    label: "Offer Acceptance",
    order: 8,
    serviceLineId: slTaaS.id,
  });

  // Order 9
  await mkStage({
    code: "09B",
    label: "Training Started",
    order: 9,
    serviceLineId: slKaaS.id,
  });
  await mkStage({
    code: "09A",
    label: "Joined",
    order: 9,
    serviceLineId: slTaaS.id,
    isTerminal: true,
  });

  // Order 10
  await mkStage({
    code: "10B",
    label: "Drop Out",
    order: 10,
    serviceLineId: slKaaS.id,
    isTerminal: true,
  });
  await mkStage({
    code: "10A",
    label: "Absconded",
    order: 10,
    serviceLineId: slTaaS.id,
    isTerminal: true,
  });

  console.log("  ✓ 14 pipeline stages seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // DONE
  // ─────────────────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║               SEED CREDENTIALS                      ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Super Admin : siva.sarathy@sfjbs.com                ║");
  console.log("║  Password    : admin@123                             ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\n✅ Seed complete!\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
