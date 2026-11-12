// File: ai.seed.ts
// Path: src/scripts/ai.seed.ts
//
// AI assistant prefill (spec §14.3, §15.2, §16.4). Safe to re-run: only adds
// what is missing, never changes an edited row.
//   • quota policies: one row per EXISTING role per default limit, in every
//     tenant, plus a tenant default (roleId null) for roles created later.
//     No role names are hardcoded.
//   • pricing: the default model's price (verify on Anthropic's pricing page).
//   • seeded command templates: common phrasings, so the assistant starts
//     partly mature (template hits cost ₹0).
// Does NOT switch the AI on — that's Settings → AI (commandEnabled / canvasEnabled).
//
//   npm run seed:ai

import prisma from "@/utils/prisma/client";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { commandAction } from "@/config/commandRegistry";
import { templateKey } from "@/services/ai/command.service";

type Seed = [phrasing: string, action: string, params?: Record<string, unknown>];
const f = (filters: Record<string, unknown>) => ({ filters });

const TEMPLATES: Seed[] = [
  ["show my clients", "open_clients", f({ assignedTo: "me" })],
  ["my clients", "open_clients", f({ assignedTo: "me" })],
  ["clients assigned to me", "open_clients", f({ assignedTo: "me" })],
  ["open my clients", "open_clients", f({ assignedTo: "me" })],
  ["show clients", "open_clients", {}],
  ["clients", "open_clients", {}],
  ["all clients", "open_clients", {}],
  ["show active clients", "open_clients", f({ status: "ACTIVE" })],
  ["active clients", "open_clients", f({ status: "ACTIVE" })],
  ["show inactive clients", "open_clients", f({ status: "INACTIVE" })],
  ["clients pending approval", "open_clients", f({ status: "PENDING" })],
  ["show unassigned clients", "open_clients", f({ assignedTo: "none" })],
  ["show {industry_1} clients", "open_clients", f({ industryId: "{industry_1}" })],
  ["clients in {industry_1}", "open_clients", f({ industryId: "{industry_1}" })],
  ["show {business_unit_1} clients", "open_clients", f({ businessUnitId: "{business_unit_1}" })],
  ["show clients added {date_range_1}", "open_clients", f({ added: "{date_range_1}" })],
  ["clients added {date_range_1}", "open_clients", f({ added: "{date_range_1}" })],
  ["new clients {date_range_1}", "open_clients", f({ added: "{date_range_1}" })],
  ["clients without website", "open_clients", f({ missing: "website" })],
  ["clients with no spocs", "open_clients", f({ missing: "spocs" })],
  ["clients without reports", "open_clients", f({ missing: "reports" })],
  ["clients with no csr figures", "open_clients", f({ missing: "figures" })],
  ["clients never run", "open_clients", f({ pipeline: "never" })],
  ["clients with failed runs", "open_clients", f({ pipeline: "failed" })],
  ["show {user_1} clients", "open_clients", f({ assignedToId: "{user_1}" })],
  ["clients of {user_1}", "open_clients", f({ assignedToId: "{user_1}" })],
  ["show {client_1}", "open_client", { client: "{client_1}" }],
  ["open {client_1}", "open_client", { client: "{client_1}" }],
  ["{client_1}", "open_client", { client: "{client_1}" }],
  ["show my spocs", "open_spocs", f({ handlerId: "me" })],
  ["my spocs", "open_spocs", f({ handlerId: "me" })],
  ["my contacts", "open_spocs", f({ handlerId: "me" })],
  ["show spocs", "open_spocs", {}],
  ["spocs", "open_spocs", {}],
  ["spocs of {client_1}", "open_spocs", f({ clientId: "{client_1}" })],
  ["show spocs at {client_1}", "open_spocs", f({ clientId: "{client_1}" })],
  ["{user_1} spocs", "open_spocs", f({ handlerId: "{user_1}" })],
  ["approved spocs", "open_spocs", f({ approvalStatus: "APPROVED" })],
  ["spocs pending approval", "open_spocs", f({ approvalStatus: "PENDING" })],
  ["dashboard", "open_dashboard"],
  ["open dashboard", "open_dashboard"],
  ["go to dashboard", "open_dashboard"],
  ["home", "open_dashboard"],
  ["approvals", "open_approvals"],
  ["show approvals", "open_approvals"],
  ["pending approvals", "open_approvals"],
  ["pipeline runs", "open_pipeline_runs"],
  ["show failed runs", "open_pipeline_runs", f({ status: "FAILED" })],
  ["failed pipeline runs", "open_pipeline_runs", f({ status: "FAILED" })],
  ["office map", "open_map"],
  ["show map", "open_map"],
  ["reports", "open_reports"],
  ["outreach", "open_outreach"],
  ["notifications", "open_notifications"],
  ["help", "open_help"],
  ["settings", "open_settings"],
  ["users", "open_users"],
];

const main = async () => {
  // 1. quota policies per tenant
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  let policies = 0;
  for (const t of tenants) {
    const roles = await prisma.role.findMany({ where: { tenantId: t.id }, select: { id: true } });
    for (const roleId of [null, ...roles.map((r) => r.id)]) {
      for (const q of AI_DEFAULTS.quotas) {
        const exists = await prisma.aiQuotaPolicy.findFirst({ where: { tenantId: t.id, roleId, mode: q.mode, period: q.period } });
        if (exists) continue;
        await prisma.aiQuotaPolicy.create({ data: { tenantId: t.id, roleId, mode: q.mode, period: q.period, maxCount: q.maxCount } });
        policies++;
      }
    }
  }

  // 2. pricing
  const p = AI_DEFAULTS.pricing;
  const hasPrice = await prisma.aiModelPricing.findFirst({ where: { model: p.model, isActive: true } });
  if (!hasPrice) {
    await prisma.aiModelPricing.create({
      data: {
        provider: p.provider,
        model: p.model,
        inputPerMTokUsd: p.inputPerMTokUsd,
        outputPerMTokUsd: p.outputPerMTokUsd,
        cacheReadPerMTokUsd: p.cacheReadPerMTokUsd,
        cacheWritePerMTokUsd: p.cacheWritePerMTokUsd,
        usdToInr: p.usdToInr,
        effectiveFrom: new Date(),
      },
    });
  }

  // 3. seeded templates
  let templates = 0;
  for (const [phrasing, action, params] of TEMPLATES) {
    if (!commandAction(action)) throw new Error(`seed uses unknown action ${action}`);
    const template = templateKey(phrasing);
    const exists = await prisma.commandTemplate.findUnique({ where: { template } });
    if (exists) continue;
    await prisma.commandTemplate.create({ data: { template, action, paramMap: (params ?? {}) as object, source: "seed" } });
    templates++;
  }

  console.log(`AI seed: ${policies} quota policies, ${hasPrice ? 0 : 1} price row, ${templates} templates added (${tenants.length} tenants).`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
