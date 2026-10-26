// File: faqs.seed.ts
// Path: src/scripts/faqs.seed.ts
//
// npm run seed:faqs — starter help-centre content. Idempotent: matched by
// question, so re-running refreshes the answer text without duplicating rows.
// Answers describe what the API actually enforces — keep them in sync.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedFaq = { category: string; module: string | null; question: string; answer: string };

const FAQS: SeedFaq[] = [
  // ── Getting started
  {
    category: "Getting started",
    module: "dashboard",
    question: "What can I see in the CRM?",
    answer: `What you see depends on your **role**. Each role grants actions (view clients, add SPOCs, assign...) and a **scope** for each action that decides *whose* records it covers.

- Menu items and buttons you don't have permission for are hidden.
- The same page can show different rows to two colleagues — that's scope, not a bug.

Ask your admin if you need wider access.`,
  },
  {
    category: "Getting started",
    module: "dashboard",
    question: "Why does a client or SPOC show \"not found\" when a colleague can open it?",
    answer: `Records outside your scope are treated as if they don't exist — you get **not found**, never "access denied". This is deliberate, so the CRM doesn't reveal which records exist.

If you need it, ask the handler to reassign the SPOC to you, or ask your admin to widen your role's scope.`,
  },
  {
    category: "Getting started",
    module: null,
    question: "How do I take or replay a product tour?",
    answer: `Product tours walk you through the main parts of a page step by step. You can start or replay any tour from the **Help centre** whenever you like — handy after a new feature ships.`,
  },

  // ── Clients
  {
    category: "Clients",
    module: "clients",
    question: "What do the client statuses mean?",
    answer: `- **PENDING** — every new client starts here until someone approves it.
- **ACTIVE** — approved and being worked.
- **INACTIVE** — parked; the record and its history are kept.

Changing status needs the **Approve / change status** permission (\`clients.approve\`). The first time a client becomes ACTIVE, the approver and date are recorded.`,
  },
  {
    category: "Clients",
    module: "clients",
    question: "Which clients appear in my client list?",
    answer: `A client is visible to you when, within your **View clients** scope, someone **created it** or **handles at least one of its SPOCs**.

So when a SPOC at a client is assigned to you, that client appears in your list automatically.`,
  },
  {
    category: "Clients",
    module: "clients",
    question: "How do client locations and the primary address work?",
    answer: `A client can have many locations (HQ, branches, plants...). Exactly one can be **primary** — it's the address shown in lists and used for state / city filters and reports.

- The **first** location you add becomes primary automatically.
- Marking another location primary clears the old one.
- Removing a location hides it; SPOCs linked to it keep the link.`,
  },
  {
    category: "Clients",
    module: "clients",
    question: "Who gets notified when I add a note to a client?",
    answer: `Anyone who can see a client can add a note. The **handlers of the client's active SPOCs** get a notification (you never notify yourself), and the note appears on the client's activity timeline.

You can delete only notes **you** wrote.`,
  },
  {
    category: "Clients",
    module: "clients",
    question: "Can I change many clients' status at once?",
    answer: `Yes — select clients in the list and use **Change status**. It applies the same rules as a single change (needs \`clients.approve\`, first activation records the approver) and tells you which rows were **skipped** and why, e.g. already in that status. Up to 200 at a time.`,
  },

  // ── SPOCs
  {
    category: "SPOCs",
    module: "spocs",
    question: "What is required to add a SPOC?",
    answer: `- **First name**, the **client**, a **handler**, a **business unit** and a **service line** are required. BU + service line together say which offering this contact is for.
- The handler must be an **active user inside your scope**.
- A location, if set, must be an active address of the **same client**.`,
  },
  {
    category: "SPOCs",
    module: "spocs",
    question: "Why can't I save a SPOC with this email?",
    answer: `SPOC email addresses are **unique across the whole CRM**, not just per client (emails are stored lowercased). If you get an "already exists" error, the person is already in the system — possibly under a client or handler you can't see. Ask your manager or an admin to find and reassign it instead of creating a duplicate.`,
  },
  {
    category: "SPOCs",
    module: "spocs",
    question: "How do I reassign a SPOC to someone else?",
    answer: `Use **Assign** on the SPOC (needs \`spocs.assign\`).

- The SPOC must be active and in your scope; the new handler must be an active user in your scope and not the current handler.
- Handler history is kept on the SPOC, with an optional reason.
- The new handler is notified.

Select several SPOCs in the list to **bulk assign** — the assignee gets one summary notification and any rows that couldn't be moved are listed with the reason.`,
  },
  {
    category: "SPOCs",
    module: "spocs",
    question: "What do email status and validation band mean?",
    answer: `**Email status**: UNVERIFIED (not checked yet), GOOD (verified deliverable), RISKY, BAD.

**Validation band** summarises the latest validation score:
- **READY** — score of 75 or more and no failed check; safe to contact.
- **REVIEW** — needs a human look before outreach.
- **NOT_USABLE** — don't use as is.
- Blank — not validated yet (shown as *Unscored* in reports).`,
  },
  {
    category: "SPOCs",
    module: "spocs",
    question: "Why are a SPOC's email and phone blank?",
    answer: `Contact details are shown only to roles with **See email / phone** (\`spocs.view_contact\`). Without it, email and phone come back empty everywhere — lists, details, search and outreach — even when they are stored.`,
  },
  {
    category: "SPOCs",
    module: "spocs",
    question: "What happens when I delete a SPOC?",
    answer: `The SPOC is **deactivated**, not erased: it disappears from the default list, while its activity and handler history stay. Filter by inactive to find it again.`,
  },

  // ── Views & tables
  {
    category: "Views & tables",
    module: "clients",
    question: "How do saved views work?",
    answer: `Arrange a table the way you like — columns, filters, sort, density, page size — then **Save view**.

- Mark one view per page as your **default**; it loads automatically. Setting a new default clears the old one.
- **Share** a view to make it visible (read-only) to everyone. Only you can edit or delete your views.`,
  },

  // ── Reports
  {
    category: "Reports",
    module: "reports",
    question: "How do I build a report?",
    answer: `In **Reports**, pick what to count (clients or SPOCs), **group by** a field (handler, business unit, status, state...) and optionally **split by** a second field to get a stacked chart. Add filters and a date range, then save it as a view to reuse.

Use **Trend** to see counts over time by day, week or month.`,
  },
  {
    category: "Reports",
    module: "reports",
    question: "Why don't my report numbers match a colleague's?",
    answer: `Reports only count records **inside your scope** for that module — the same records your lists show you. Sections you have no permission for (for example pipeline runs) are hidden. Empty values are grouped as **Not set**.`,
  },

  // ── Notifications
  {
    category: "Notifications",
    module: null,
    question: "What will I be notified about?",
    answer: `- A SPOC is **assigned** to you (one summary for bulk assignments).
- Someone adds a **note** to a client where you handle a SPOC.
- A pipeline step you started **finishes** or **fails**.

You never get notified about your own actions. Mark notifications read individually or all at once, and clear read ones.`,
  },

  // ── Permissions
  {
    category: "Admin",
    module: "admin",
    question: "What do the permission scopes mean?",
    answer: `A scope decides whose records an action covers:

- **OWN** — only records I own
- **TEAM** — me + users whose team lead is me
- **REPORTING** — me + my direct reports
- **REPORTING_LINE** — me + my entire reporting hierarchy
- **DEPARTMENT** — everyone in my department
- **BU** — everyone in my business units
- **ALL** — all records

"Owner" means the SPOC's **handler**, the client's creator (or a handler of any of its SPOCs), and the requester of a pipeline run.`,
  },
  {
    category: "Admin",
    module: "admin",
    question: "I changed a role's permissions — when does it take effect?",
    answer: `Permissions are cached per role for up to **one minute**. After that, every user with the role gets the new access on their next request — no need to log out.`,
  },

  // ── Account
  {
    category: "Account",
    module: null,
    question: "How do I reset my password?",
    answer: `On the sign-in page choose **Forgot password** and enter your work email. The reset link is valid for **15 minutes** and works once.

New accounts get a welcome email with a set-password link valid for **24 hours**. If it expired, use Forgot password or ask an admin to reset it — an admin reset signs you out of every device.`,
  },
];

const main = async () => {
  let created = 0;
  let updated = 0;

  // order follows the list position inside each category
  const position = new Map<string, number>();

  for (const f of FAQS) {
    const order = position.get(f.category) ?? 0;
    position.set(f.category, order + 1);

    const data = { ...f, order, isPublished: true };
    const existing = await prisma.faq.findFirst({
      where: { question: f.question },
      select: { id: true },
    });

    if (existing) {
      await prisma.faq.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.faq.create({ data });
      created++;
    }
  }

  console.log(`✅ FAQs seeded — ${created} created, ${updated} updated`);
};

main()
  .catch((e) => {
    console.error("❌ FAQ seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
