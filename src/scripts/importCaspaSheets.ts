// File: importCaspaSheets.ts
// Path: src/scripts/importCaspaSheets.ts
//
// Imports the CASPA client + SPOC sheets (cleaned by data-import/tools/normalize.py)
// into the CRM. Dry run by default — prints what would happen, writes nothing.
//   python3 data-import/tools/normalize.py
//   npx tsx src/scripts/importCaspaSheets.ts            # dry run
//   npx tsx src/scripts/importCaspaSheets.ts --apply    # write
//
// Rules
//  - match: client by CASPA id → CIN → exact name; SPOC by CASPA id → email → name within the client
//  - existing records: only EMPTY fields are filled (CRM values are never overwritten); missing
//    children (offices, CSR years, programmes, assignments, notes, tasks) are added
//  - new records follow the earlier CASPA import: clients ACTIVE (PENDING if "Need Approval From
//    Lead"), SPOCs APPROVED, BU B2B, service line from the sheet (KaaS / TaaS / CSR), source CASPA import
//  - pick-list values the CRM doesn't have yet (industry, category …) are added to the pick-list
//  - --apply saves data-import/reports/import-<time>.json: every row created (for undo) and the
//    old value of every field filled, plus the rows that were skipped and why

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { runInTenant } from "@/utils/prisma/tenant";
import { toNameKey } from "@/utils/names";
import { csrNameKey } from "@/services/csrProgram.service";
import { FINDER_LOCATION_TYPE } from "@/config/pipeline";
import { ownershipFromCin, yearFromCin } from "@/services/clientAddons.service";
import { linkSpocPersons } from "@/services/person.service";

const APPLY = process.argv.includes("--apply");
const DIR = path.resolve(__dirname, "../../data-import");
const C = JSON.parse(fs.readFileSync(path.join(DIR, "normalized/clients.json"), "utf8")) as { clients: any[]; problems: any[] };
const S = JSON.parse(fs.readFileSync(path.join(DIR, "normalized/spocs.json"), "utf8")) as { spocs: any[]; problems: any[] };

const count: Record<string, number> = {};
const bump = (k: string, n = 1) => (count[k] = (count[k] ?? 0) + n);
const created: Record<string, string[]> = {};
const filled: { model: string; id: string; before: Record<string, unknown> }[] = [];
const skipped: { what: string; id: unknown; why: string }[] = [];
const made = (model: string, id: string) => (created[model] ??= []).push(id);
const dec = (x: number | null | undefined) => (x == null ? null : new Prisma.Decimal(Math.round(x * 100) / 100));
const fake = (p: string) => `dry-${p}-${Math.random().toString(36).slice(2)}`;
const addrKey = (a?: string | null) => (a ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60);
const istDate = (d?: string | null, t?: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const x = new Date(`${d.slice(0, 10)}T${/^\d{1,2}:\d{2}/.test(t ?? "") ? t!.padStart(5, "0").slice(0, 5) : "10:00"}:00+05:30`);
  return isNaN(x.getTime()) ? null : x;
};
const stamp = (v?: string | null) => {
  if (!v) return null;
  const x = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(v) ? `${v.replace(" ", "T")}+05:30` : v);
  return isNaN(x.getTime()) ? null : x;
};

/** only the fields that are empty in the CRM row */
function fillEmpty<T extends Record<string, unknown>>(row: T, want: Partial<T>) {
  const data: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(want)) {
    if (v === null || v === undefined || v === "") continue;
    const cur = row[k];
    if (cur === null || cur === undefined || cur === "") {
      data[k] = v;
      before[k] = cur ?? null;
    }
  }
  return { data, before };
}

async function main() {
  const siva = await prisma.user.findUniqueOrThrow({ where: { email: "siva.sarathy@sfjbs.com" }, select: { id: true, tenantId: true } });
  await runInTenant(siva.tenantId, () => run(siva));
}

async function run(siva: { id: string; tenantId: string }) {
  const tenantId = siva.tenantId;
  // ── reference data
  const users = new Map((await prisma.user.findMany({ where: { legacyCaspaId: { not: null } }, select: { id: true, legacyCaspaId: true } })).map((u) => [u.legacyCaspaId!, u.id]));
  // CASPA owners not in the CRM yet → inactive placeholder accounts (like the earlier import), to merge into real people later
  const template = await prisma.user.findFirstOrThrow({ where: { email: { endsWith: "@legacy.sfjbs.invalid" } }, select: { roleId: true } });
  for (const legacy of [4326, 4289, 4365, 3561, 3637]) {
    if (users.has(legacy)) continue;
    bump("placeholder users created");
    if (!APPLY) { users.set(legacy, fake("user")); continue; }
    const u = await prisma.user.create({
      data: {
        tenantId, email: `caspa.${legacy}@legacy.sfjbs.invalid`, firstName: "Legacy user", lastName: String(legacy),
        isActive: false, roleId: template.roleId, legacyCaspaId: legacy, createdById: siva.id,
        passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10),
      },
      select: { id: true },
    });
    made("user", u.id);
    users.set(legacy, u.id);
  }
  const bu = await prisma.businessUnit.findFirstOrThrow({ where: { code: "B2B" }, select: { id: true } });
  const sls = new Map((await prisma.serviceLine.findMany({ select: { id: true, code: true } })).map((x) => [x.code ?? "", x.id]));
  const lookups = new Map<string, Map<string, string>>();
  for (const l of await prisma.lookup.findMany({ select: { id: true, type: true, label: true, code: true } })) {
    const m = lookups.get(l.type) ?? new Map<string, string>();
    m.set(l.label.toLowerCase(), l.id);
    m.set((l.code ?? "").toLowerCase(), l.id);
    lookups.set(l.type, m);
  }
  const look = async (type: string, label?: string | null) => {
    if (!label) return null;
    // broken cells (task JSON spilt into the column, GPS numbers, "CSR-1,CSR-New") are not pick-list values
    if (/[{}"]|task_|closed_at|^[\d.\s-]+$|^CSR-\d/i.test(label)) {
      skipped.push({ what: `pick-list ${type}`, id: label.slice(0, 60), why: "broken cell value — left empty" });
      return null;
    }
    const m = lookups.get(type) ?? new Map<string, string>();
    lookups.set(type, m);
    const hit = m.get(label.toLowerCase());
    if (hit) return hit;
    bump(`new pick-list value (${type})`);
    const code = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "OTHER";
    const id = APPLY
      ? (await prisma.lookup.create({ data: { tenantId, type: type as never, code, label: label.slice(0, 100) }, select: { id: true } })).id
      : fake("lookup");
    if (APPLY) made("lookup", id);
    m.set(label.toLowerCase(), id);
    return id;
  };
  const locType = new Map((await prisma.lookup.findMany({ where: { type: "LOCATION_TYPE" }, select: { id: true, code: true } })).map((l) => [l.code, l.id]));

  // ── clients
  const clientIdByLegacy = new Map<number, string>();
  for (const [i, c] of C.clients.entries()) {
    if (i % 100 === 0) console.log(`  clients ${i}/${C.clients.length}`);
    let ex = await prisma.client.findFirst({ where: { legacyCaspaId: c.legacyId } });
    ex ??= c.cin ? ((await prisma.clientCompany.findFirst({ where: { cin: c.cin }, select: { client: true } }))?.client ?? null) : null;
    ex ??= await prisma.client.findFirst({ where: { name: { equals: c.name, mode: "insensitive" }, deletedAt: null } });
    // core client fields only — company facts → company add-on, CSR → CSR add-on (below)
    const want = {
      name: c.name,
      website: c.website,
      linkedinUrl: c.linkedin,
      businessUnitId: bu.id,
    };
    const companyFacts = {
      employeeCount: c.employees,
      industryId: await look("INDUSTRY", c.industry),
      categoryId: await look("CLIENT_CATEGORY", c.category),
      linkedinEmployees: c.linkedinEmployees,
    };
    const latest = [...c.csr].filter((y: any) => y.spent != null).sort((a: any, b: any) => b.fy.localeCompare(a.fy))[0];
    let clientId: string;
    let hasLocations = 0;
    if (ex) {
      if (ex.legacyCaspaId && ex.legacyCaspaId !== c.legacyId) {
        skipped.push({ what: "client", id: c.legacyId, why: `matches CRM client "${ex.name}" by CIN/name but that has CASPA id ${ex.legacyCaspaId}` });
        bump("clients skipped (conflict)");
        continue;
      }
      const { data, before } = fillEmpty(ex as any, { ...want, legacyCaspaId: c.legacyId } as any);
      if (Object.keys(data).length) {
        bump("clients updated (empty fields filled)");
        if (APPLY) {
          await prisma.client.update({ where: { id: ex.id }, data });
          filled.push({ model: "client", id: ex.id, before });
        }
      } else bump("clients already complete");
      clientId = ex.id;
      hasLocations = await prisma.clientLocation.count({ where: { clientId } });
    } else {
      bump("clients created");
      if (APPLY) {
        const row = await prisma.client.create({
          data: {
            ...(Object.fromEntries(Object.entries(want).filter(([, v]) => v !== null && v !== undefined)) as any),
            tenantId,
            status: c.status,
            legacyCaspaId: c.legacyId,
            createdById: users.get(c.addedBy) ?? siva.id,
            ...(c.status === "ACTIVE" && { approvedById: siva.id, approvedAt: new Date() }),
          },
          select: { id: true },
        });
        clientId = row.id;
        made("client", clientId);
      } else clientId = fake("client");
    }
    clientIdByLegacy.set(c.legacyId, clientId);
    // add-ons (23 Nov 2026): registration + CSR profile — fill what is empty
    if (APPLY) {
      const reg = await prisma.clientCompany.findUnique({ where: { clientId } });
      const regWant = { ...companyFacts, cin: c.cin ?? null, isListed: c.listed, marketCapRs: dec(c.marketCap), subCategory: c.subCategory, ownership: ownershipFromCin(c.cin), yearOfIncorporation: yearFromCin(c.cin) };
      const cinFree = !c.cin || !(await prisma.clientCompany.findFirst({ where: { cin: c.cin, clientId: { not: clientId } }, select: { id: true } }));
      if (!cinFree) { delete (regWant as any).cin; delete (regWant as any).ownership; delete (regWant as any).yearOfIncorporation; }
      const regData = reg ? fillEmpty(reg as any, regWant as any).data : Object.fromEntries(Object.entries(regWant).filter(([, v]) => v !== null && v !== undefined));
      if (Object.keys(regData).length) {
        bump(reg ? "registrations completed" : "registrations added");
        await prisma.clientCompany.upsert({ where: { clientId }, create: { tenantId, clientId, ...regData } as any, update: regData });
      }
      const csr = await prisma.clientCsr.findUnique({ where: { clientId } });
      const csrWant = { csrEligible: c.csrEligible, foundationName: c.foundationName, foundationWebsite: c.foundationWebsite, ...(latest && { latestFy: latest.fy, latestSpentRs: dec(latest.spent) }) };
      const csrData = csr ? fillEmpty(csr as any, csrWant as any).data : Object.fromEntries(Object.entries(csrWant).filter(([, v]) => v !== null && v !== undefined));
      if (Object.keys(csrData).length) {
        bump(csr ? "CSR profiles completed" : "CSR profiles added");
        await prisma.clientCsr.upsert({ where: { clientId }, create: { clientId, ...csrData }, update: csrData });
      }
    }
    const real = APPLY || !!ex;

    // offices: head office when the client has none; branches not already on file
    const known = new Set(real && !clientId.startsWith("dry") ? (await prisma.clientLocation.findMany({ where: { clientId }, select: { addressLine: true } })).map((l) => addrKey(l.addressLine)) : []);
    const offices: any[] = [];
    if (!hasLocations && (c.hq.address || c.hq.state)) offices.push({ ...c.hq, type: "HQ", primary: true });
    for (const b of c.branches) offices.push({ ...b, type: FINDER_LOCATION_TYPE[b.type] ?? "OFFICE", primary: false });
    for (const o of offices) {
      const k = addrKey(o.address);
      if (k && known.has(k)) continue;
      known.add(k);
      bump(o.primary ? "head offices added" : "branch offices added");
      if (APPLY) {
        const row = await prisma.clientLocation.create({
          data: {
            clientId,
            typeId: locType.get(o.type) ?? null,
            addressLine: o.address,
            city: o.city ?? o.district ?? null,
            district: o.district,
            state: o.state,
            pincode: o.pincode,
            latitude: o.lat == null || o.lng == null ? null : new Prisma.Decimal(o.lat),
            longitude: o.lat == null || o.lng == null ? null : new Prisma.Decimal(o.lng),
            isPrimary: !!o.primary,
            dmEvidence: o.evidence ?? null,
            addedById: siva.id,
          },
          select: { id: true },
        });
        made("clientLocation", row.id);
      }
    }

    // CSR figures by FY (fill empty, never touch locked rows)
    for (const y of c.csr) {
      const cur = real && !clientId.startsWith("dry") ? await prisma.clientCsrFinancial.findUnique({ where: { clientId_fy: { clientId, fy: y.fy } } }) : null;
      const want2 = { spentRs: dec(y.spent), budgetRs: dec(y.budget), unspentRs: dec(y.unspent) };
      if (cur) {
        if (cur.isLocked) continue;
        const { data, before } = fillEmpty(cur as any, want2 as any);
        if (!Object.keys(data).length) continue;
        bump("CSR years updated");
        if (APPLY) {
          await prisma.clientCsrFinancial.update({ where: { id: cur.id }, data });
          filled.push({ model: "clientCsrFinancial", id: cur.id, before });
        }
      } else {
        bump("CSR years added");
        if (APPLY) made("clientCsrFinancial", (await prisma.clientCsrFinancial.create({ data: { clientId, fy: y.fy, ...want2, evidence: "CASPA import" }, select: { id: true } })).id);
      }
    }
    if (c.corporate && (c.corporate.paidUp != null || c.corporate.authorised != null)) {
      const cur = real && !clientId.startsWith("dry") ? await prisma.clientCorporateFinancial.findUnique({ where: { clientId_fy: { clientId, fy: c.corporate.fy } } }) : null;
      if (!cur) {
        bump("company financials added");
        if (APPLY)
          made("clientCorporateFinancial", (await prisma.clientCorporateFinancial.create({ data: { clientId, fy: c.corporate.fy, paidUpCapitalRs: dec(c.corporate.paidUp), authorisedCapitalRs: dec(c.corporate.authorised), source: "CASPA import", updatedById: siva.id }, select: { id: true } })).id);
      }
    }

    // programmes (unique per client + FY + name)
    const progs = c.programs.map((p: any) => ({ ...p, key: csrNameKey(p.name) })).filter((p: any) => p.key);
    const have = new Set(real && !clientId.startsWith("dry") ? (await prisma.clientCsrProgram.findMany({ where: { clientId }, select: { fy: true, nameKey: true } })).map((p) => `${p.fy}|${p.nameKey}`) : []);
    const newProgs = progs.filter((p: any) => !have.has(`${p.fy}|${p.key}`));
    bump("programmes added", newProgs.length);
    if (APPLY && newProgs.length) {
      await prisma.clientCsrProgram.createMany({
        data: newProgs.map((p: any) => ({
          clientId, fy: p.fy, name: p.name, nameKey: p.key, sectorText: p.sector, locationNote: p.locations,
          budgetRs: dec(p.budget), beneficiaries: p.beneficiaries, sdgs: p.sdgs, updatedById: siva.id,
        })),
        skipDuplicates: true,
      });
    }

    // assignments
    for (const u of c.assignTo) {
      const userId = users.get(u);
      if (!userId) { bump("assignments skipped (CASPA user not in CRM)"); continue; }
      const on = real && !clientId.startsWith("dry") ? await prisma.clientAssignment.findFirst({ where: { clientId, userId, endedAt: null }, select: { id: true } }) : null;
      if (on) continue;
      bump("assignments added");
      if (APPLY) made("clientAssignment", (await prisma.clientAssignment.create({ data: { clientId, userId, assignedById: siva.id, note: "CASPA import" }, select: { id: true } })).id);
    }
    // notes
    for (const n of c.notes) {
      const dup = real && !clientId.startsWith("dry") ? await prisma.clientNote.findFirst({ where: { clientId, content: n }, select: { id: true } }) : null;
      if (dup) continue;
      bump("client notes added");
      if (APPLY) made("clientNote", (await prisma.clientNote.create({ data: { clientId, authorId: users.get(c.addedBy) ?? siva.id, content: n }, select: { id: true } })).id);
    }
    if (c.placements || c.trainings) bump("clients with placement/training records NOT imported (no table yet)");
  }

  // ── SPOCs
  const sourceIds = { CASPA_IMPORT: await look("SPOC_SOURCE", "CASPA_IMPORT"), APOLLO: await look("SPOC_SOURCE", "APOLLO") };
  for (const [i, s] of S.spocs.entries()) {
    if (i % 250 === 0) console.log(`  spocs ${i}/${S.spocs.length}`);
    const clientId =
      clientIdByLegacy.get(s.clientLegacyId) ?? (await prisma.client.findFirst({ where: { legacyCaspaId: s.clientLegacyId }, select: { id: true } }))?.id;
    if (!clientId) { skipped.push({ what: "spoc", id: s.legacyId, why: `client CASPA id ${s.clientLegacyId} not found` }); bump("SPOCs skipped (no client)"); continue; }
    const clientReal = !clientId.startsWith("dry");
    const nameKey = toNameKey(s.firstName, s.lastName);
    let ex = await prisma.clientSpoc.findFirst({ where: { legacyCaspaId: s.legacyId } });
    let emailOwner = s.email ? await prisma.clientSpoc.findFirst({ where: { email: s.email } }) : null;
    if (!ex && emailOwner && emailOwner.clientId === clientId) ex = emailOwner;
    if (!ex && clientReal) ex = await prisma.clientSpoc.findFirst({ where: { clientId, nameKey } });
    if (emailOwner && ex && emailOwner.id === ex.id) emailOwner = null;
    let email = s.email;
    // the same email at another client = the same person in another role: keep it (linked to one Person after)
    if (emailOwner && (!ex || emailOwner.id !== ex.id)) {
      if (emailOwner.clientId === clientId) { email = null; bump("SPOC emails left out (another SPOC at this client has it)"); }
      else bump("SPOCs also at another client (same person)");
    }

    const handlerId = users.get(s.handler) ?? users.get(s.associate) ?? (clientReal ? (await prisma.clientAssignment.findFirst({ where: { clientId, endedAt: null }, select: { userId: true } }))?.userId : undefined) ?? siva.id;
    const want = {
      email, phone: s.phone, phone2: s.phone2, phone3: s.phone3, designation: s.designation, linkedinUrl: s.linkedin,
      state: s.state, district: s.district, city: s.city, pincode: s.pincode, address: s.address,
      latitude: s.lat == null || s.lng == null ? null : new Prisma.Decimal(s.lat), longitude: s.lat == null || s.lng == null ? null : new Prisma.Decimal(s.lng),
      distanceKm: s.distanceKm == null ? null : new Prisma.Decimal(Math.round(s.distanceKm * 10) / 10),
      erp: s.erp, seniority: s.seniority,
      totalExpYears: s.totalExp == null ? null : new Prisma.Decimal(s.totalExp), currentOrgExpYears: s.currentExp == null ? null : new Prisma.Decimal(s.currentExp),
      callConnected: s.callConnected,
      salesStatusId: await look("SALES_STATUS", s.salesStatus),
      roleCategoryId: await look("SPOC_ROLE", s.roleCategory),
      decisionAuthorityId: await look("DECISION_AUTHORITY", s.decisionAuthority),
    };
    let spocId: string;
    if (ex) {
      const { data, before } = fillEmpty(ex as any, { ...want, legacyCaspaId: s.legacyId } as any);
      if (Object.keys(data).length) {
        bump("SPOCs updated (empty fields filled)");
        if (APPLY) { await prisma.clientSpoc.update({ where: { id: ex.id }, data }); filled.push({ model: "clientSpoc", id: ex.id, before }); }
      } else bump("SPOCs already complete");
      spocId = ex.id;
    } else {
      bump("SPOCs created");
      if (APPLY) {
        const row = await prisma.clientSpoc.create({
          data: {
            ...(Object.fromEntries(Object.entries(want).filter(([, v]) => v !== null && v !== undefined)) as any),
            tenantId, clientId, firstName: s.firstName, lastName: s.lastName, nameKey,
            handlerId, addedById: handlerId, businessUnitId: bu.id, serviceLineId: sls.get(s.serviceLine) ?? sls.get("CSR")!,
            sourceId: sourceIds[s.source as "CASPA_IMPORT" | "APOLLO"], approvalStatus: "APPROVED", approvedById: siva.id, approvedAt: new Date(),
            legacyCaspaId: s.legacyId,
          },
          select: { id: true },
        });
        spocId = row.id;
        made("clientSpoc", spocId);
      } else spocId = fake("spoc");
    }
    const spocReal = !spocId.startsWith("dry");

    // call comments → notes tagged with the SPOC
    for (const n of s.comments) {
      if (spocReal && (await prisma.clientNote.findFirst({ where: { clientId, spocId, content: n.text }, select: { id: true } }))) continue;
      bump("SPOC comments added");
      if (APPLY) made("clientNote", (await prisma.clientNote.create({ data: { clientId, spocId, authorId: handlerId, content: n.text, ...(stamp(n.at) && { createdAt: stamp(n.at)! }) }, select: { id: true } })).id);
    }
    // tasks → calls / follow-ups
    for (const t of s.tasks) {
      if (spocReal && (await prisma.workTask.findFirst({ where: { clientId, spocId, title: t.task_name }, select: { id: true } }))) continue;
      const st = (t.status ?? "").toLowerCase();
      const status = st.startsWith("close") || st === "done" || st === "completed" ? "DONE" : st.includes("progress") ? "IN_PROGRESS" : "OPEN";
      bump(`SPOC tasks added (${status.toLowerCase()})`);
      if (APPLY)
        made("workTask", (await prisma.workTask.create({
          data: {
            tenantId, clientId, spocId, kind: /call|wa\b|whatsapp/i.test(t.task_name) ? "CALL" : "TASK", title: t.task_name.slice(0, 300),
            dueAt: istDate(t.task_date, t.task_time), status, assigneeId: handlerId, createdById: handlerId,
            closeNote: t.close_note, ...(status === "DONE" && { closedAt: stamp(t.closed_at) ?? new Date(), closedById: handlerId }),
            ...(stamp(t.created_at) && { createdAt: stamp(t.created_at)! }),
          },
          select: { id: true },
        })).id);
    }
  }

  // new SPOC rows → their Person (person.service merge rules)
  if (APPLY) bump("SPOCs linked to people", await linkSpocPersons());

  for (const p of C.problems) skipped.push({ what: "client row", id: p.line ?? p.id, why: p.why });
  for (const p of S.problems) skipped.push({ what: "spoc row", id: p.line ?? p.id, why: p.why });

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN — nothing written"}`);
  for (const [k, v] of Object.entries(count).sort()) console.log(`  ${String(v).padStart(6)}  ${k}`);
  console.log(`  ${String(skipped.length).padStart(6)}  rows skipped / to check by hand`);
  fs.mkdirSync(path.join(DIR, "reports"), { recursive: true });
  const file = path.join(DIR, "reports", `${APPLY ? "import" : "dryrun"}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ applied: APPLY, at: new Date().toISOString(), count, created, filled, skipped }, null, 1));
  console.log(`report: ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    // keep the undo list even when it stops half way (re-running is safe: matches skip what's already in)
    fs.mkdirSync(path.join(DIR, "reports"), { recursive: true });
    const file = path.join(DIR, "reports", `FAILED-${APPLY ? "import" : "dryrun"}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
    fs.writeFileSync(file, JSON.stringify({ applied: APPLY, failed: String(e), count, created, filled, skipped }, null, 1));
    console.error(`partial report: ${file}`);
    process.exit(1);
  });
