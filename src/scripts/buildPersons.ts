// File: buildPersons.ts
// Path: src/scripts/buildPersons.ts
//
// One-time: every SPOC row gets its Person (21 Nov 2026 person model).
//  1. SPOCs the CASPA import created without an email (because another SPOC already had it) get it back
//  2. persons: same personal email → one person; same name + mobile → one person; else one each
//  3. report: people with several client roles, and "possible duplicates" (same name, different people)
//   npx tsx src/scripts/buildPersons.ts            # dry run
//   npx tsx src/scripts/buildPersons.ts --apply

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import prisma from "@/utils/prisma/client";
import { isPersonalEmail, linkSpocPersons, normEmail, phoneKey } from "@/services/person.service";

const APPLY = process.argv.includes("--apply");
const DIR = path.resolve(__dirname, "../../data-import");

async function main() {
  // 1. emails the import left out
  const sheet = JSON.parse(fs.readFileSync(path.join(DIR, "normalized/spocs.json"), "utf8")).spocs as { legacyId: number; email: string | null }[];
  const emailByLegacy = new Map(sheet.filter((s) => s.email).map((s) => [s.legacyId, normEmail(s.email)!]));
  const blank = await prisma.clientSpoc.findMany({ where: { email: null, legacyCaspaId: { not: null } }, select: { id: true, legacyCaspaId: true } });
  const restore = blank.filter((s) => emailByLegacy.has(s.legacyCaspaId!));
  console.log(`emails to restore: ${restore.length}`);
  if (APPLY) for (const s of restore) await prisma.clientSpoc.update({ where: { id: s.id }, data: { email: emailByLegacy.get(s.legacyCaspaId!)! }, select: { id: true } });

  // 2. who would merge (in memory — the same rules as person.service)
  const spocs = await prisma.clientSpoc.findMany({
    select: { id: true, tenantId: true, nameKey: true, firstName: true, lastName: true, email: true, phone: true, client: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const restored = new Map(restore.map((r) => [r.id, emailByLegacy.get(r.legacyCaspaId!)!]));
  const parent = new Map<string, string>();
  const find = (x: string): string => (parent.get(x) === x || !parent.has(x) ? x : find(parent.get(x)!));
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const byEmail = new Map<string, string>();
  const byNamePhone = new Map<string, string>();
  let genericSkipped = 0;
  for (const s of spocs) {
    parent.set(s.id, s.id);
    const e = normEmail(restored.get(s.id) ?? s.email);
    if (e) {
      if (isPersonalEmail(e)) {
        const k = `${s.tenantId}|${e}`;
        if (byEmail.has(k)) union(s.id, byEmail.get(k)!);
        else byEmail.set(k, s.id);
      } else genericSkipped++;
    }
    const p = phoneKey(s.phone);
    if (p) {
      const k = `${s.tenantId}|${s.nameKey}|${p}`;
      if (byNamePhone.has(k)) union(s.id, byNamePhone.get(k)!);
      else byNamePhone.set(k, s.id);
    }
  }
  const groups = new Map<string, typeof spocs>();
  for (const s of spocs) (groups.get(find(s.id)) ?? groups.set(find(s.id), []).get(find(s.id))!).push(s);
  const multi = [...groups.values()].filter((g) => g.length > 1);
  // same name, different people (not merged — a human decides)
  const byName = new Map<string, Set<string>>();
  for (const [root, g] of groups) for (const s of g) (byName.get(`${s.tenantId}|${s.nameKey}`) ?? byName.set(`${s.tenantId}|${s.nameKey}`, new Set()).get(`${s.tenantId}|${s.nameKey}`)!).add(root);
  const possible = [...byName.entries()].filter(([k, roots]) => roots.size > 1 && k.split("|")[1]!.length > 3);

  console.log(`SPOC rows: ${spocs.length} → people: ${groups.size}`);
  console.log(`people with several client roles: ${multi.length} (${multi.reduce((n, g) => n + g.length, 0)} SPOC rows)`);
  console.log(`generic inboxes not used to merge: ${genericSkipped}`);
  console.log(`possible duplicates (same name, kept separate): ${possible.length}`);
  for (const g of multi.slice(0, 6)) console.log("  e.g.", g.map((s) => `${s.firstName} ${s.lastName ?? ""} @ ${s.client.name}`).join("  |  "));

  fs.mkdirSync(path.join(DIR, "reports"), { recursive: true });
  const file = path.join(DIR, "reports", `persons-${APPLY ? "apply" : "dryrun"}-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({
    restoredEmails: restore.map((r) => ({ spocId: r.id, email: emailByLegacy.get(r.legacyCaspaId!) })),
    multiRole: multi.map((g) => g.map((s) => ({ spocId: s.id, name: `${s.firstName} ${s.lastName ?? ""}`.trim(), client: s.client.name, email: s.email }))),
    possibleDuplicates: possible.map(([k, roots]) => ({ name: k.split("|")[1], people: [...roots].map((r) => groups.get(r)!.map((s) => ({ spocId: s.id, client: s.client.name, email: s.email, phone: s.phone }))) })),
  }, null, 1));
  console.log(`report: ${file}`);

  // 3. write: link every SPOC to its person (same rules, in person.service)
  if (APPLY) {
    const n = await linkSpocPersons();
    const people = await prisma.person.count();
    console.log(`linked ${n} SPOC rows → ${people} people`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
