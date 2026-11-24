// File: person.service.ts
// Path: src/services/person.service.ts
//
// A Person is a human, stored once; each client they work with is a ClientSpoc row (their role there —
// designation, sales status, handler, service line). The SPOC row keeps a copy of the person's name /
// email / phone / LinkedIn so every existing screen, filter and engine keeps working; this file keeps
// those copies and the Person in step.
//
// Merge rules (never merge on weak evidence):
//   - same PERSONAL email AND the same name → same person. Generic inboxes (csr@, hr@, info@ …) are never a
//     merge key; an office mailbox shared by different officers (dg.icar@nic.in) doesn't join different names.
//   - same name + same mobile (last 10 digits) → same person.
//   - anything else (same name only …) → separate people; listed as "possible duplicates" for a human.

import type { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { toNameKey } from "@/utils/names";

const GENERIC = new Set([
  "info", "contact", "contactus", "csr", "hr", "admin", "administrator", "support", "office", "enquiry", "enquiries",
  "inquiry", "mail", "email", "careers", "career", "jobs", "help", "helpdesk", "sales", "account", "accounts", "secretary",
  "cs", "company.secretary", "companysecretary", "ceo", "md", "feedback", "webmaster", "noreply", "no-reply", "corporate",
  "communication", "communications", "media", "pr", "investor", "investors", "investorrelations", "ir", "grievance",
  "grievances", "legal", "compliance", "team", "hello", "query", "queries", "service", "services", "customercare", "care",
  "director", "registrar", "principal", "dean", "office.admin", "foundation", "csr.foundation", "secy", "pa", "ps",
]);

/** a mailbox that belongs to one human (not csr@ / info@ / a placeholder) */
export function isPersonalEmail(email?: string | null) {
  const e = email?.trim().toLowerCase();
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  const [local, domain] = e.split("@") as [string, string];
  if (/placeholder|example\.|invalid$|noemail/.test(domain) || /^noemail/.test(local)) return false;
  return !GENERIC.has(local.replace(/[\d_]+$/, ""));
}
export const normEmail = (e?: string | null) => e?.trim().toLowerCase() || null;
export const phoneKey = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

type Db = Prisma.TransactionClient | typeof prisma;

/** same human by name: the words of one name are all in the other (any order — "Gupta Arup" / "Arup Gupta",
 *  "Ramandeep Sahni" / "Ramandeep Singh Sahni", "Satish" / "Satish Trivedi") */
const sameName = (a: { firstName: string; lastName: string | null }, b: { firstName: string; lastName: string | null }) => {
  const words = (x: { firstName: string; lastName: string | null }) =>
    new Set(`${x.firstName} ${x.lastName ?? ""}`.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1));
  const [x, y] = [words(a), words(b)];
  if (!x.size || !y.size) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((w) => big.has(w));
};
type SpocContact = {
  id: string; tenantId: string; personId: string | null; firstName: string; lastName: string | null; nameKey: string;
  email: string | null; phone: string | null; linkedinUrl: string | null;
};
const CONTACT = { id: true, tenantId: true, personId: true, firstName: true, lastName: true, nameKey: true, email: true, phone: true, linkedinUrl: true } as const;

/** the person this SPOC row is (found by personal email, then name + mobile), or a new one */
async function personFor(db: Db, s: SpocContact) {
  const email = normEmail(s.email);
  if (email && isPersonalEmail(email)) {
    const p = await db.person.findFirst({ where: { tenantId: s.tenantId, email } });
    // an office mailbox can be shared by different officers: the email only joins people with the same name
    if (p && sameName(p, s)) return p;
  }
  const phone = phoneKey(s.phone);
  if (phone) {
    const sameName = await db.clientSpoc.findMany({
      where: { tenantId: s.tenantId, nameKey: s.nameKey, personId: { not: null }, id: { not: s.id }, phone: { not: null } },
      select: { personId: true, phone: true },
      take: 50,
    });
    const hit = sameName.find((x) => phoneKey(x.phone) === phone);
    if (hit?.personId) return db.person.findUniqueOrThrow({ where: { id: hit.personId } });
  }
  // the email goes on the new person only when it is personal and nobody holds it (an office mailbox
  // shared by different officers stays on their SPOC rows)
  const free = email && isPersonalEmail(email) && !(await db.person.findFirst({ where: { tenantId: s.tenantId, email }, select: { id: true } }));
  return db.person.create({
    data: {
      tenantId: s.tenantId, firstName: s.firstName, lastName: s.lastName, nameKey: s.nameKey,
      email: free ? email : null, phone: s.phone, linkedinUrl: s.linkedinUrl,
    },
  });
}

/** give SPOC rows their Person (new rows, or every row without one); fills the person's empty fields */
export async function linkSpocPersons(spocIds?: string[], db: Db = prisma) {
  const rows = await db.clientSpoc.findMany({
    where: spocIds ? { id: { in: spocIds } } : { personId: null },
    select: CONTACT,
    orderBy: { createdAt: "asc" },
  });
  let linked = 0;
  for (const s of rows) {
    const p = s.personId ? await db.person.findUnique({ where: { id: s.personId } }) : await personFor(db, s);
    if (!p) continue;
    const fill: Prisma.PersonUpdateInput = {};
    const email = normEmail(s.email);
    if (!p.email && email && isPersonalEmail(email)) {
      // only if no other person holds it (unique per tenant)
      if (!(await db.person.findFirst({ where: { tenantId: s.tenantId, email }, select: { id: true } }))) fill.email = email;
    }
    if (!p.phone && s.phone) fill.phone = s.phone;
    if (!p.linkedinUrl && s.linkedinUrl) fill.linkedinUrl = s.linkedinUrl;
    if (!p.lastName && s.lastName) fill.lastName = s.lastName;
    if (Object.keys(fill).length) await db.person.update({ where: { id: p.id }, data: fill });
    if (s.personId !== p.id) {
      await db.clientSpoc.update({ where: { id: s.id }, data: { personId: p.id }, select: { id: true } });
      linked++;
    }
  }
  return linked;
}

/**
 * a SPOC's contact details changed: update the Person, then copy them onto the person's other SPOC rows
 * (Shalin's new mobile shows at Adani Ports, Adani Enterprises and Adani Foundation alike).
 * Only the fields that were sent are copied.
 */
export async function syncPersonFromSpoc(
  spocId: string,
  fields: { [K in "firstName" | "lastName" | "email" | "phone" | "linkedinUrl"]?: string | null | undefined },
  db: Db = prisma,
) {
  const s = await db.clientSpoc.findUnique({ where: { id: spocId }, select: CONTACT });
  if (!s) return;
  if (!s.personId) {
    await linkSpocPersons([spocId], db);
    return;
  }
  const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as typeof fields;
  if (!Object.keys(data).length) return;
  const personData = { ...data } as Prisma.PersonUpdateInput;
  if (data.email !== undefined) {
    const e = normEmail(data.email);
    // a generic inbox stays on the SPOC row only; a personal one moves to the person if free
    if (e && isPersonalEmail(e)) {
      const other = await db.person.findFirst({ where: { tenantId: s.tenantId, email: e, id: { not: s.personId } }, select: { id: true } });
      if (other) delete personData.email;
      else personData.email = e;
    } else delete personData.email;
  }
  if (data.firstName !== undefined || data.lastName !== undefined)
    personData.nameKey = toNameKey(data.firstName ?? s.firstName, data.lastName !== undefined ? data.lastName : s.lastName);
  await db.person.update({ where: { id: s.personId }, data: personData });
  // the same human's other roles
  const sib = { ...data } as Prisma.ClientSpocUpdateManyMutationInput;
  if (personData.nameKey) sib.nameKey = personData.nameKey as string;
  await db.clientSpoc.updateMany({ where: { personId: s.personId, id: { not: s.id } }, data: sib });
}

/** the person's other client roles (for "Also works with"), limited to what the viewer may see */
export async function otherRoles(spocId: string, visibleWhere: Prisma.ClientSpocWhereInput) {
  const s = await prisma.clientSpoc.findUnique({ where: { id: spocId }, select: { personId: true } });
  if (!s?.personId) return [];
  return prisma.clientSpoc.findMany({
    where: { AND: [{ personId: s.personId, id: { not: spocId } }, visibleWhere] },
    select: { id: true, designation: true, isActive: true, client: { select: { id: true, name: true } }, serviceLine: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}
