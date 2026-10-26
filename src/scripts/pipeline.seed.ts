// File: pipeline.seed.ts
// Path: src/scripts/pipeline.seed.ts
//
// npm run seed:pipeline — idempotent. Creates the CSR_PIPELINE service, its
// steps (src/config/pipeline.ts) and the lookup codes the engine sends.
// Admin edits (labels, limits, isActive) are kept on re-run.
//
// Env: CSR_PIPELINE_URL, CSR_PIPELINE_INBOUND_KEY (hash stored; generated and
// printed once when missing).

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { CSR_PIPELINE, PIPELINE_LOOKUPS, PIPELINE_STEPS } from "../config/pipeline";

const prisma = new PrismaClient();
const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

async function main() {
  console.log("▶ Lookups used by the pipeline...");
  for (const [type, rows] of Object.entries(PIPELINE_LOOKUPS)) {
    for (const [i, r] of rows.entries()) {
      await prisma.lookup.upsert({
        where: { type_code: { type, code: r.code } },
        update: { isSystem: true },
        create: { type, code: r.code, label: r.label, order: i + 1, isSystem: true },
      });
    }
  }

  console.log("▶ CSR pipeline service...");
  let inboundKey = process.env.CSR_PIPELINE_INBOUND_KEY;
  const existing = await prisma.externalService.findUnique({ where: { code: CSR_PIPELINE } });
  let printKey = false;
  if (!inboundKey && !existing?.inboundKeyHash) {
    inboundKey = `svc_${crypto.randomBytes(32).toString("base64url")}`;
    printKey = true;
  }

  const service = await prisma.externalService.upsert({
    where: { code: CSR_PIPELINE },
    update: {
      ...(process.env.CSR_PIPELINE_URL && { baseUrl: process.env.CSR_PIPELINE_URL }),
      ...(inboundKey && { inboundKeyHash: sha256(inboundKey) }),
    },
    create: {
      code: CSR_PIPELINE,
      name: "CSR outreach pipeline",
      baseUrl: process.env.CSR_PIPELINE_URL ?? "http://127.0.0.1:8770",
      outboundKeyEnv: "CSR_PIPELINE_KEY",
      inboundKeyHash: inboundKey ? sha256(inboundKey) : null,
      scopes: ["clients:read", "step-runs:write"],
      timeoutMins: 240,
    },
  });

  console.log("▶ Pipeline steps...");
  for (const s of PIPELINE_STEPS) {
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
      },
    });
  }

  console.log(`\n✅ Pipeline seed complete — ${PIPELINE_STEPS.length} steps on ${service.baseUrl}`);
  if (printKey) {
    console.log("\n⚠️  New engine callback key (shown once). Set it in the engine as CRM_CALLBACK_KEY");
    console.log(`   and here as CSR_PIPELINE_INBOUND_KEY:\n\n   ${inboundKey}\n`);
  }
}

main()
  .catch((e) => {
    console.error("❌ Pipeline seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
