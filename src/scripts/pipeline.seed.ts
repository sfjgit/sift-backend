// File: pipeline.seed.ts
// Path: src/scripts/pipeline.seed.ts
//
// npm run seed:pipeline — idempotent. Creates the external services (CSR
// pipeline, branch office finder), their steps (src/config/pipeline.ts) and,
// in every tenant, the lookup codes the engines send.
// Admin edits (labels, limits, isActive) are kept on re-run.
//
// Env per service (see SERVICES): <X>_URL, <X>_INBOUND_KEY (hash stored;
// generated and printed once when missing), e.g. BRANCH_FINDER_URL /
// BRANCH_FINDER_INBOUND_KEY.
// SEED_SERVICES=BRANCH_FINDER seeds only the services named (comma separated).

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PIPELINE_STEPS, SERVICES, serviceOf, type ServiceCode } from "../config/pipeline";
import { ensureTenantLookups } from "../services/tenant.service";

const prisma = new PrismaClient();
const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

async function seedService(code: ServiceCode) {
  const def = SERVICES[code];
  const base = def.keyEnv.replace(/_KEY$/, "");
  const urlEnv = `${base}_URL`;
  const inboundEnv = `${base}_INBOUND_KEY`;

  console.log(`▶ ${def.name} (${code})...`);
  let inboundKey = process.env[inboundEnv];
  const existing = await prisma.externalService.findUnique({ where: { code } });
  let printKey = false;
  if (!inboundKey && !existing?.inboundKeyHash) {
    inboundKey = `svc_${crypto.randomBytes(32).toString("base64url")}`;
    printKey = true;
  }

  const service = await prisma.externalService.upsert({
    where: { code },
    update: {
      ...(process.env[urlEnv] && { baseUrl: process.env[urlEnv] }),
      ...(inboundKey && { inboundKeyHash: sha256(inboundKey) }),
    },
    create: {
      code,
      name: def.name,
      baseUrl: process.env[urlEnv] ?? def.defaultUrl,
      outboundKeyEnv: def.keyEnv,
      inboundKeyHash: inboundKey ? sha256(inboundKey) : null,
      scopes: ["clients:read", "step-runs:write"],
      timeoutMins: def.timeoutMins,
    },
  });

  const steps = PIPELINE_STEPS.filter((s) => serviceOf(s) === code);
  for (const s of steps) {
    await prisma.pipelineStep.upsert({
      where: { serviceId_key: { serviceId: service.id, key: s.key } },
      update: { uiOrder: s.uiOrder },
      create: {
        serviceId: service.id,
        key: s.key,
        label: s.label,
        target: "CLIENT",
        uiOrder: s.uiOrder,
        userClientLimit: s.defaultLimit,
        rerunAfterDays: s.defaultRerunDays,
      },
    });
  }
  console.log(`  ${steps.length} step(s) on ${service.baseUrl}`);
  if (printKey) {
    console.log(`\n⚠️  New callback key for ${code} (shown once). Set it in the engine as CRM_CALLBACK_KEY`);
    console.log(`   and here as ${inboundEnv}:\n\n   ${inboundKey}\n`);
  }
}

async function main() {
  console.log("▶ Lookups used by the pipeline, per tenant...");
  for (const t of await prisma.tenant.findMany({ select: { id: true, slug: true } })) {
    console.log(`  ${t.slug}: ${await ensureTenantLookups(prisma, t.id)} added`);
  }

  const only = process.env.SEED_SERVICES?.split(",").map((s) => s.trim()).filter(Boolean);
  const codes = (Object.keys(SERVICES) as ServiceCode[]).filter((c) => !only?.length || only.includes(c));
  for (const code of codes) await seedService(code);
  console.log("\n✅ Pipeline seed complete");
}

main()
  .catch((e) => {
    console.error("❌ Pipeline seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
