// File: importB2gSheets.ts
// Path: src/scripts/importB2gSheets.ts
//
// CASPA B2G sheets (CPSU = central, SPSU = state bodies; cleaned by data-import/tools/normalize_b2g.py)
// → B2G clients with the government add-on, office contact, offices, technology stack, the named
// officer as SPOC (linked to a Person) and who handles them.
//   python3 -I data-import/tools/normalize_b2g.py "../old crm/CPSU.csv" "../old crm/SPSU.csv"
//   npx tsx src/scripts/importB2gSheets.ts            # dry run
//   npx tsx src/scripts/importB2gSheets.ts --apply
//
// Existing clients (same government CIN, or same name) are completed, never overwritten.

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { runInTenant } from "@/utils/prisma/tenant";
import { toNameKey } from "@/utils/names";
import { ownershipFromCin } from "@/services/clientAddons.service";
import { linkSpocPersons } from "@/services/person.service";

const APPLY = process.argv.includes("--apply");
const DIR = path.resolve(__dirname, "../../data-import");
type Body = {
  sheet: "central" | "state"; legacyId: number; name: string; shortName: string | null; website: string | null; linkedin: string | null;
  industry: string | null; category: string | null; employeeSize: string | null; cin: string | null; yearOfIncorporation: number | null;
  govt: Record<string, string | null> & { level: string; orgType: string };
  officer: { name: string; designation: string | null; email: string | null; phone: string | null } | null;
  office: { email: string | null; phone: string | null } | null;
  hq: { address: string | null; state: string | null };
  office_address: { address: string | null; state: string | null; district: string | null; pincode: string | null; lat: number | null; lng: number | null };
  tech: Record<string, string>;
  assignTo: number[];
};
const bodies = (JSON.parse(fs.readFileSync(path.join(DIR, "normalized/b2g.json"), "utf8")) as { bodies: Body[] }).bodies;

const count: Record<string, number> = {};
const bump = (k: string, n = 1) => (count[k] = (count[k] ?? 0) + n);
const created: Record<string, string[]> = {};
const made = (m: string, id: string) => (created[m] ??= []).push(id);
const filled: { model: string; id: string; before: Record<string, unknown> }[] = [];
const notes: string[] = [];
const empty = (v: unknown) => v === null || v === undefined || v === "";
const fillEmpty = (row: Record<string, unknown>, want: Record<string, unknown>) => {
  const data: Record<string, unknown> = {}, before: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(want)) if (!empty(v) && empty(row[k])) { data[k] = v; before[k] = row[k] ?? null; }
  return { data, before };
};
const splitName = (n: string) => {
  const w = n.trim().split(/\s+/);
  return { firstName: w.length > 1 ? w.slice(0, -1).join(" ") : w[0]!, lastName: w.length > 1 ? w[w.length - 1]! : null };
};

async function main() {
  const siva = await prisma.user.findUniqueOrThrow({ where: { email: "siva.sarathy@sfjbs.com" }, select: { id: true, tenantId: true } });
  await runInTenant(siva.tenantId, () => run(siva));
}

async function run(siva: { id: string; tenantId: string }) {
  const tenantId = siva.tenantId;
  const bu = await prisma.businessUnit.findFirstOrThrow({ where: { code: "B2G" }, select: { id: true } });
  const kaas = await prisma.serviceLine.findFirstOrThrow({ where: { code: "KAAS" }, select: { id: true } });
  const lk = async (type: string) => new Map((await prisma.lookup.findMany({ where: { type } })).flatMap((l) => [[l.code, l.id], [l.label.toLowerCase(), l.id]]));
  const orgTypes = await lk("GOVT_ORG_TYPE"), sizes = await lk("EMPLOYEE_SIZE"), cats = await lk("CLIENT_CATEGORY");
  const techCats = await lk("TECH_CATEGORY"), locTypes = await lk("LOCATION_TYPE"), sources = await lk("SPOC_SOURCE");
  const industries = await lk("INDUSTRY");
  const industryId = async (label: string | null) => {
    if (!label) return null;
    const hit = industries.get(label.toLowerCase());
    if (hit) return hit;
    bump("new industry values");
    const code = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
    const id = APPLY ? (await prisma.lookup.create({ data: { tenantId, type: "INDUSTRY", code, label } })).id : `dry-${code}`;
    if (APPLY) made("lookup", id);
    industries.set(label.toLowerCase(), id);
    return id;
  };

  // handlers: CASPA user ids → CRM users (placeholders for unknown ones, like the earlier imports)
  const users = new Map((await prisma.user.findMany({ where: { legacyCaspaId: { not: null } }, select: { id: true, legacyCaspaId: true } })).map((u) => [u.legacyCaspaId!, u.id]));
  const template = await prisma.user.findFirstOrThrow({ where: { email: { endsWith: "@legacy.sfjbs.invalid" } }, select: { roleId: true } });
  for (const legacy of [...new Set(bodies.flatMap((b) => b.assignTo))]) {
    if (users.has(legacy)) continue;
    bump("placeholder users created");
    if (!APPLY) { users.set(legacy, `dry-u${legacy}`); continue; }
    const u = await prisma.user.create({
      data: { tenantId, email: `caspa.${legacy}@legacy.sfjbs.invalid`, firstName: "Legacy user", lastName: String(legacy), isActive: false, roleId: template.roleId, legacyCaspaId: legacy, createdById: siva.id, passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10) },
      select: { id: true },
    });
    made("user", u.id);
    users.set(legacy, u.id);
  }

  const clientIdOf = new Map<string, string>();
  const newSpocs: string[] = [];
  for (const b of bodies) {
    // match: government CIN → same name
    let ex = b.cin ? (await prisma.clientRegistration.findFirst({ where: { cin: b.cin }, select: { client: true } }))?.client ?? null : null;
    ex ??= await prisma.client.findFirst({ where: { name: { equals: b.name, mode: "insensitive" }, deletedAt: null } });
    const core = {
      shortName: b.shortName, website: b.website, linkedinUrl: b.linkedin,
      industryId: await industryId(b.industry),
      categoryId: b.category ? (cats.get(b.category.toLowerCase()) ?? null) : null,
      employeeSizeId: b.employeeSize ? (sizes.get(b.employeeSize) ?? null) : null,
      email: b.office?.email ?? null, phone: b.office?.phone ?? null,
      businessUnitId: bu.id,
    };
    let clientId: string;
    if (ex) {
      const { data, before } = fillEmpty(ex as unknown as Record<string, unknown>, core);
      bump(Object.keys(data).length ? "existing clients completed" : "existing clients already complete");
      if (APPLY && Object.keys(data).length) { await prisma.client.update({ where: { id: ex.id }, data, select: { id: true } }); filled.push({ model: "client", id: ex.id, before }); }
      clientId = ex.id;
      notes.push(`${b.name}: already in the CRM as "${ex.name}" — completed, kept its business unit`);
    } else {
      bump(`clients created (${b.sheet})`);
      if (APPLY) {
        const c = await prisma.client.create({
          data: {
            ...(Object.fromEntries(Object.entries(core).filter(([, v]) => !empty(v))) as object),
            tenantId, name: b.name, entityType: "GOVERNMENT", status: "ACTIVE", createdById: siva.id, approvedById: siva.id, approvedAt: new Date(),
          } as Prisma.ClientUncheckedCreateInput,
          select: { id: true },
        });
        clientId = c.id;
        made("client", c.id);
      } else clientId = `dry-${b.legacyId}-${b.sheet}`;
    }
    clientIdOf.set(b.name.toLowerCase(), clientId);
    const real = !clientId.startsWith("dry-");

    // registration — a government company's CIN
    if (b.cin && real) {
      const reg = await prisma.clientRegistration.findUnique({ where: { clientId } });
      const taken = await prisma.clientRegistration.findFirst({ where: { cin: b.cin, clientId: { not: clientId } }, select: { id: true } });
      if (!taken && !reg?.cin) {
        bump("CINs added");
        if (APPLY) await prisma.clientRegistration.upsert({
          where: { clientId },
          create: { tenantId, clientId, cin: b.cin, ownership: ownershipFromCin(b.cin), yearOfIncorporation: b.yearOfIncorporation },
          update: { cin: b.cin, ownership: ownershipFromCin(b.cin), ...(reg?.yearOfIncorporation ? {} : { yearOfIncorporation: b.yearOfIncorporation }) },
        });
      }
    } else if (b.cin) bump("CINs added");

    // government add-on (fill empty only)
    const govtWant = {
      level: b.govt.level, orgTypeId: orgTypes.get(b.govt.orgType) ?? null, ministryName: b.govt.ministryName, departmentName: b.govt.departmentName,
      stateSkillBody: b.govt.stateSkillBody, sector: b.govt.sector, schemeType: b.govt.schemeType, estimatedBudget: b.govt.estimatedBudget,
      tenderPortal: b.govt.tenderPortal, tenderAuthority: b.govt.tenderAuthority, priority: b.govt.priority, digitalMaturity: b.govt.digitalMaturity,
      isNational: b.sheet === "central" ? true : null,
    };
    const g = real ? await prisma.clientGovt.findUnique({ where: { clientId } }) : null;
    if (g) {
      const { data, before } = fillEmpty(g as unknown as Record<string, unknown>, govtWant);
      if (Object.keys(data).length) { bump("government details completed"); if (APPLY) { await prisma.clientGovt.update({ where: { id: g.id }, data }); filled.push({ model: "clientGovt", id: g.id, before }); } }
    } else {
      bump("government details added");
      if (APPLY) made("clientGovt", (await prisma.clientGovt.create({ data: { clientId, ...(Object.fromEntries(Object.entries(govtWant).filter(([, v]) => !empty(v))) as object) } as Prisma.ClientGovtUncheckedCreateInput, select: { id: true } })).id);
    }

    // offices: HQ when the client has none; the contact address as another office
    const hasLoc = real ? await prisma.clientLocation.count({ where: { clientId } }) : 0;
    const offices: { address: string | null; state: string | null; district?: string | null; pincode?: string | null; lat?: number | null; lng?: number | null; type: string; primary: boolean }[] = [];
    if (!hasLoc && (b.hq.address || b.hq.state)) offices.push({ ...b.hq, type: "HQ", primary: true });
    const oa = b.office_address;
    if (oa.address && oa.address !== b.hq.address) offices.push({ ...oa, type: "OFFICE", primary: !hasLoc && !b.hq.address && !b.hq.state });
    for (const o of offices) {
      if (real && o.address && (await prisma.clientLocation.findFirst({ where: { clientId, addressLine: o.address }, select: { id: true } }))) continue;
      bump(o.primary ? "head offices added" : "offices added");
      if (APPLY) made("clientLocation", (await prisma.clientLocation.create({
        data: {
          clientId, typeId: locTypes.get(o.type) ?? null, addressLine: o.address, state: o.state, district: o.district ?? null, city: o.district ?? null,
          pincode: o.pincode ?? null, isPrimary: o.primary, addedById: siva.id,
          ...(o.lat != null && o.lng != null && { latitude: new Prisma.Decimal(o.lat), longitude: new Prisma.Decimal(o.lng) }),
        },
        select: { id: true },
      })).id);
    }

    // technology stack (one row per area)
    for (const [code, details] of Object.entries(b.tech)) {
      const categoryId = techCats.get(code);
      if (!categoryId) continue;
      if (real && (await prisma.clientTechnology.findUnique({ where: { clientId_categoryId: { clientId, categoryId } }, select: { id: true } }))) continue;
      bump("technology rows added");
      if (APPLY) made("clientTechnology", (await prisma.clientTechnology.create({ data: { clientId, categoryId, details, addedById: siva.id }, select: { id: true } })).id);
    }

    // who handles it
    const handlers = b.assignTo.map((u) => users.get(u)).filter((x): x is string => !!x);
    for (const userId of handlers) {
      if (real && (await prisma.clientAssignment.findFirst({ where: { clientId, userId, endedAt: null }, select: { id: true } }))) continue;
      bump("assignments added");
      if (APPLY) made("clientAssignment", (await prisma.clientAssignment.create({ data: { clientId, userId, assignedById: siva.id, note: "CASPA B2G import" }, select: { id: true } })).id);
    }

    // the named officer → SPOC (Person linked after)
    if (b.officer?.name) {
      const { firstName, lastName } = splitName(b.officer.name);
      const nameKey = toNameKey(firstName, lastName);
      if (real && (await prisma.clientSpoc.findFirst({ where: { clientId, nameKey }, select: { id: true } }))) { bump("officers already SPOCs"); continue; }
      bump("officers added as SPOCs");
      if (APPLY) {
        const handlerId = handlers[0] ?? siva.id;
        const s = await prisma.clientSpoc.create({
          data: {
            tenantId, clientId, firstName, lastName, nameKey, designation: b.officer.designation, email: b.officer.email, phone: b.officer.phone,
            handlerId, addedById: siva.id, businessUnitId: bu.id, serviceLineId: kaas.id, sourceId: sources.get("CASPA_IMPORT") ?? null,
            approvalStatus: "APPROVED", approvedById: siva.id, approvedAt: new Date(),
          },
          select: { id: true },
        });
        made("clientSpoc", s.id);
        newSpocs.push(s.id);
      }
    }
  }

  // central departments / bodies → their ministry (administrative parent), when the ministry is a client
  const ministries = await prisma.clientGovt.findMany({ where: { orgType: { code: "MINISTRY" } }, select: { clientId: true, client: { select: { name: true } } } });
  const ministryByName = new Map(ministries.map((m) => [m.client.name.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim(), m.clientId]));
  for (const b of bodies) {
    const mn = b.govt.ministryName?.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
    const childId = clientIdOf.get(b.name.toLowerCase());
    const parentId = mn ? ministryByName.get(mn) : undefined;
    if (!childId || !parentId || parentId === childId || childId.startsWith("dry-")) continue;
    const g = await prisma.clientGovt.findUnique({ where: { clientId: childId }, select: { id: true, parentClientId: true } });
    if (g && !g.parentClientId) { bump("linked to their ministry"); if (APPLY) await prisma.clientGovt.update({ where: { id: g.id }, data: { parentClientId: parentId } }); }
  }

  if (APPLY && newSpocs.length) bump("SPOCs linked to people", await linkSpocPersons(newSpocs));

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN — nothing written"}`);
  for (const [k, v] of Object.entries(count).sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);
  for (const n of notes.slice(0, 10)) console.log("  ·", n);
  fs.mkdirSync(path.join(DIR, "reports"), { recursive: true });
  const file = path.join(DIR, "reports", `b2g-${APPLY ? "import" : "dryrun"}-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ applied: APPLY, count, created, filled, notes }, null, 1));
  console.log(`report: ${file}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
