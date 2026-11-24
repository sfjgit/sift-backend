// File: assist.service.ts
// Path: src/services/ai/assist.service.ts
//
// One brain for the assistant (14 Nov 2026). It always knows the page the user
// is on — the path, the filters in the URL, the open record — and picks ONE of:
//
//   1. do it on the page   "only Karnataka", "my SPOCs", "clear filters"  → the page changes
//   2. show stats          "show stats"                                   → the page's own stats view,
//                                                                            for the rows on screen
//   3. explain what's on screen  "explain this", "summary"                → plain words, from live numbers
//   4. build / refine a report   anything else                           → a canvas (threads)
//
// 2 and 3 never call the LLM: the server reads the same data the page shows,
// with the same filters and the user's own access. The LLM is only asked to
// turn words into a page command (1) or a report design (4), and never sees a
// row either way. Nothing here changes a record.

import { z } from "zod";
import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import prisma from "@/utils/prisma/client";
import { clientScopeWhere, spocScopeWhere } from "@/services/scope.service";
import { listClientsQuery, listSpocsQuery } from "@/validators/client.validators";
import { computeSpocStats } from "@/controller/spoc.controller";
import { computeClientStats } from "@/controller/client.controller";
import { resolveCommand } from "@/services/ai/command.service";
import { askThread, isExplainRequest, isNewThreadRequest, startPresetThread, type ThreadReply } from "@/services/ai/thread.service";
import { logAi } from "@/services/ai/audit.service";
import { extractEntities } from "@/services/ai/entities.service";
import { definitionAsked } from "@/services/ai/glossary";
import { ACTION_RE, planAction, type ActionProposal } from "@/services/ai/action.service";

export interface PageContext {
  /** "/spocs", "/clients/<id>" */
  path: string;
  /** the page's query string: its filters ("status=ACTIVE&industryId=…") */
  query?: string | undefined;
  /** true while a canvas is on screen in the panel — "explain this" then means the canvas */
  canvasShown?: boolean | undefined;
  /** the assistant workspace is open: nothing navigates away — filters / stats become report changes */
  inCanvas?: boolean | undefined;
}

export type PageAction =
  /** go to / re-filter a page; samePage = the page the user is already on */
  | { type: "navigate"; url: string; samePage: boolean }
  /** open the stats view of the current page */
  | { type: "stats" };

export type AssistReply = ThreadReply & { action?: PageAction; proposal?: ActionProposal };

const inCanvasOf = (b: { page: PageContext }) => !!b.page.inCanvas;

const local = (kind: ThreadReply["kind"], message: string, action?: PageAction): AssistReply => ({
  kind,
  thread: null,
  turn: null,
  message,
  free: true,
  ...(action && { action }),
});

// ── the page ─────────────────────────────────────────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
type Page =
  | { kind: "spocs" | "clients"; path: string }
  | { kind: "spoc" | "client"; path: string; id: string }
  | { kind: "other"; path: string };

const readPage = (path: string): Page => {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/spocs") return { kind: "spocs", path: p };
  if (p === "/clients") return { kind: "clients", path: p };
  const s = new RegExp(`^/spocs/(${UUID})$`, "i").exec(p);
  if (s) return { kind: "spoc", path: p, id: s[1]! };
  const c = new RegExp(`^/clients/(${UUID})$`, "i").exec(p);
  if (c) return { kind: "client", path: p, id: c[1]! };
  return { kind: "other", path: p };
};

/** the URL's filters as the list endpoint would read them (q = search; paging / sort ignored) */
const filtersOf = (query: string | undefined) => {
  const sp = new URLSearchParams(query ?? "");
  const out: Record<string, string> = {};
  for (const [k, v] of sp) if (v && !["page", "sort", "limit", "tab", "edit", "run"].includes(k)) out[k === "q" ? "search" : k] = v;
  return out;
};
const filterCount = (f: Record<string, string>) => Object.keys(f).length;

// ── free intents ─────────────────────────────────────────────────────────────

const CLEAR_RE = /^\s*(please\s+)?(clear|reset|remove|drop|clean)( all)?( the| my)? (filters?|search)( and (filters?|search))?\s*[.!]*$|^\s*(show|see) (all|everything)( of them)?\s*[.!]*$/i;
const STATS_RE = /\b(stats|statistics|numbers|overview|dashboard|break ?down|at a glance)\b/i;
const isStatsRequest = (t: string) => STATS_RE.test(t) && t.trim().split(/\s+/).length <= 7;
/** words that mean "on top of what I already have" */
const ADD_RE = /\b(only|also|and|plus|too|as well|among (them|these)|of (them|these|those)|narrow|further|keep|within)\b/i;
const ANALYTIC_RE =
  /\b(top|how many|count|number of|total|sum|average|avg|trend|per (day|week|month|year)|by (fy|industry|status|business unit|bu|sales status|approval|approval status|month|step|category|role|handler|state)|compare|comparison|chart|graph|report|breakdown|split|rank(ing)?|lowest|least|most|highest|biggest|largest|pie|bar|table)\b/i;
const FOLLOW_UP_RE = /\b(make it|show it|change it|turn it|instead|as a (pie|bar|line|table)|i meant|add (a|the|another)|remove the)\b/i;

// ── words ────────────────────────────────────────────────────────────────────

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const n = (v: number) => inr.format(v);
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");
const nameOf = (p: { firstName: string; lastName: string | null } | null | undefined) => (p ? `${p.firstName} ${p.lastName ?? ""}`.trim() : "nobody");
const dayOf = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null);
const agoOf = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : `${Math.floor(days / 30)} months ago`;
};
type Bucket = { key: string; label: string; count: number };
const topOf = (b: Bucket[], total: number, max = 3) =>
  b
    .filter((x) => x.key !== "_none")
    .slice(0, max)
    .map((x) => `${x.label} ${n(x.count)} (${pct(x.count, total)})`)
    .join(", ");
const unset = (b: Bucket[]) => b.find((x) => x.key === "_none")?.count ?? 0;
const scopeLine = (filters: Record<string, string>) => {
  const c = filterCount(filters);
  return c ? ` with your current ${c === 1 ? "filter" : `${c} filters`}${filters.search ? ` (search “${filters.search}”)` : ""}` : "";
};
/** coverage gaps worth a line: more than a quarter missing */
const gaps = (total: number, items: [label: string, has: number | null][]) =>
  items.filter(([, has]) => has !== null && total > 0 && (total - has!) / total > 0.25).map(([label, has]) => `${n(total - has!)} have no ${label} (${pct(total - has!, total)})`);

// ── explain: lists ───────────────────────────────────────────────────────────

const explainSpocs = async (user: AuthUser, perms: PermissionMap, filters: Record<string, string>) => {
  const q = listSpocsQuery.safeParse(filters);
  const d = await computeSpocStats({ user, scope: perms["spocs.read"] }, q.success ? q.data : listSpocsQuery.parse({}));
  if (!d.total) return `**SPOCs on screen** — nothing matches${scopeLine(filters)}. Try clearing a filter.`;
  const out = [`**SPOCs on screen** — ${n(d.total)} SPOCs at ${n(d.clients)} clients${scopeLine(filters)} (about ${(d.total / Math.max(1, d.clients)).toFixed(1)} per client).`, ""];
  out.push("**Where they stand**");
  const noStatus = unset(d.by.salesStatus);
  out.push(`- Sales status: ${topOf(d.by.salesStatus, d.total) || "none set"}${noStatus ? `. **${n(noStatus)} have no status yet** (${pct(noStatus, d.total)}).` : "."}`);
  out.push(`- Handlers: ${topOf(d.by.handler, d.total)}${d.by.handler.length > 3 ? `, and ${d.by.handler.length - 3} more` : ""}.`);
  if (topOf(d.by.state, d.total)) out.push(`- Location: ${topOf(d.by.state, d.total)}.`);
  if (topOf(d.by.category, d.total)) out.push(`- Client category: ${topOf(d.by.category, d.total)}.`);
  out.push(`- ${n(d.keyAccounts)} key account${d.keyAccounts === 1 ? "" : "s"}, ${n(d.withProjects)} tagged to a project, ${n(d.flagged)} flagged for wrong contact data.`);
  out.push("", "**Can you reach them?**");
  out.push(`- Email: ${n(d.has.email)} of ${n(d.total)} (${pct(d.has.email, d.total)}). Mobile: ${n(d.has.phone)} (${pct(d.has.phone, d.total)}). LinkedIn: ${n(d.has.linkedin)} (${pct(d.has.linkedin, d.total)}).`);
  const g = gaps(d.total, [["email", d.has.email], ["mobile", d.has.phone], ["LinkedIn", d.has.linkedin], ["sales status", d.has.salesStatus], ["designation", d.has.designation]]);
  if (g.length) out.push("", "**Needs attention**", ...g.map((x) => `- ${x}.`));
  if (d.capped) out.push("", "Counted on the first 50,000 rows — narrow the filters for exact numbers.");
  return out.join("\n");
};

const explainClients = async (user: AuthUser, perms: PermissionMap, filters: Record<string, string>) => {
  const q = listClientsQuery.safeParse(filters);
  const figures = !!perms["client_financials.read"];
  const d = await computeClientStats({ user, scope: perms["clients.read"], figures }, q.success ? q.data : listClientsQuery.parse({}));
  if (!d.total) return `**Clients on screen** — nothing matches${scopeLine(filters)}. Try clearing a filter.`;
  const out = [`**Clients on screen** — ${n(d.total)} clients${scopeLine(filters)}, with ${n(d.spocs)} active SPOCs between them.`, ""];
  out.push("**What they are**");
  out.push(`- Status: ${d.by.status.map((x) => `${x.label.toLowerCase()} ${n(x.count)}`).join(", ")}.`);
  if (topOf(d.by.industry, d.total)) out.push(`- Industry: ${topOf(d.by.industry, d.total)}${unset(d.by.industry) ? `; ${n(unset(d.by.industry))} not set` : ""}.`);
  if (topOf(d.by.category, d.total)) out.push(`- Category: ${topOf(d.by.category, d.total)}.`);
  if (topOf(d.by.state, d.total)) out.push(`- Head office: ${topOf(d.by.state, d.total)}.`);
  if (d.csrSpentRs !== null) out.push(`- CSR spent (latest year on record): **₹${n(d.csrSpentRs)}** across the ${n(d.has.csrFigures ?? 0)} clients that have figures.`);
  out.push(`- ${n(d.keyAccounts)} marked as a key account, ${n(d.csrEligible)} marked CSR eligible.`);
  const g = gaps(d.total, [["SPOC", d.has.spocs], ["website", d.has.website], ["CIN", d.has.cin], ["CSR figures", d.has.csrFigures], ["LinkedIn page", d.has.linkedin]]);
  if (g.length) out.push("", "**Needs attention**", ...g.map((x) => `- ${x}.`));
  return out.join("\n");
};

// ── explain: one record ──────────────────────────────────────────────────────

const workLines = async (where: { clientId: string; spocId?: string }) => {
  const [open, acts, last] = await Promise.all([
    prisma.workTask.findMany({ where: { ...where, status: { not: "DONE" } }, select: { kind: true, title: true, dueAt: true }, orderBy: { dueAt: { sort: "asc", nulls: "last" } }, take: 50 }),
    prisma.clientActivity.findMany({ where: { ...where, type: { in: ["INTERACTION_LOGGED", "NOTE_ADDED", "TASK_CLOSED"] } }, select: { type: true, meta: true }, take: 500 }),
    prisma.clientActivity.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true, summary: true } }),
  ]);
  const channel = (c: string) => acts.filter((a) => a.type === "INTERACTION_LOGGED" && (a.meta as { channel?: string } | null)?.channel === c).length;
  const out: string[] = [];
  const touches = [`${channel("CALL")} call${channel("CALL") === 1 ? "" : "s"}`, `${channel("EMAIL")} email${channel("EMAIL") === 1 ? "" : "s"}`, `${channel("WHATSAPP")} WhatsApp`, `${acts.filter((a) => a.type === "NOTE_ADDED").length} comments`];
  out.push(`- Logged so far: ${touches.join(", ")}.`);
  if (open.length) {
    const overdue = open.filter((t) => t.dueAt && t.dueAt.getTime() < Date.now()).length;
    const next = open[0]!;
    out.push(`- **${open.length} open task${open.length === 1 ? "" : "s"}**${overdue ? ` (${overdue} overdue)` : ""}. Next: ${next.kind.toLowerCase()} “${next.title}”${next.dueAt ? ` due ${dayOf(next.dueAt)}` : ""}.`);
  } else out.push("- No open tasks, calls or meetings.");
  out.push(last ? `- Last activity ${agoOf(last.createdAt)}: ${last.summary.slice(0, 140)}.` : "- No activity recorded yet.");
  return out;
};

const explainSpoc = async (user: AuthUser, perms: PermissionMap, id: string) => {
  const g = perms["spocs.read"];
  const s = await prisma.clientSpoc.findFirst({
    where: { id, ...(g === true || !g ? {} : await spocScopeWhere(user, g)) },
    select: {
      firstName: true, lastName: true, designation: true, clientId: true, isActive: true, isPrimary: true, email: true, phone: true, linkedinUrl: true,
      emailStatus: true, approvalStatus: true, validationBand: true, validationScore: true, callConnected: true, dataFlag: true, state: true, city: true,
      client: { select: { name: true } }, handler: { select: { firstName: true, lastName: true } }, salesStatus: { select: { label: true } },
      keyAccountUser: { select: { firstName: true, lastName: true } }, roleCategory: { select: { label: true } }, decisionAuthority: { select: { label: true } },
    },
  });
  if (!g || !s) return "I can't see this SPOC — it may be outside your access.";
  const seeContact = !!perms["spocs.view_contact"];
  const out = [`**${nameOf(s)}** — ${s.designation ?? "no designation"} at ${s.client.name}${s.isPrimary ? " (primary SPOC)" : ""}${s.isActive ? "" : " — inactive"}.`, ""];
  out.push("**Where it stands**");
  out.push(`- Sales status: **${s.salesStatus?.label ?? "not set"}**. Approval: ${s.approvalStatus.toLowerCase()}. Handled by ${nameOf(s.handler)}${s.keyAccountUser ? `; key account of ${nameOf(s.keyAccountUser)}` : ""}.`);
  if (s.roleCategory || s.decisionAuthority) out.push(`- Role: ${[s.roleCategory?.label, s.decisionAuthority?.label].filter(Boolean).join(" · ")}.`);
  out.push(`- Last call: ${s.callConnected === true ? "connected" : s.callConnected === false ? "did not connect" : "none recorded"}.`);
  out.push(...(await workLines({ clientId: s.clientId, spocId: id })));
  out.push("", "**Data**");
  out.push(`- Quality: ${s.validationBand ? `${s.validationBand.toLowerCase().replace("_", " ")} (${s.validationScore ?? "–"}/100)` : "not checked yet"}. Email is ${s.emailStatus.toLowerCase()}.${s.dataFlag ? ` **Flagged: ${s.dataFlag.toLowerCase().replace(/_/g, " ")}.**` : ""}`);
  const missing = [
    seeContact && !s.email && "email", seeContact && !s.phone && "mobile", !s.linkedinUrl && "LinkedIn", !s.salesStatus && "sales status", !s.state && !s.city && "location", !s.roleCategory && "role category",
  ].filter(Boolean);
  if (missing.length) out.push(`- Missing: ${missing.join(", ")}.`);
  return out.join("\n");
};

const explainClient = async (user: AuthUser, perms: PermissionMap, id: string) => {
  const g = perms["clients.read"];
  const c = await prisma.client.findFirst({
    where: { id, deletedAt: null, ...(g === true || !g ? {} : await clientScopeWhere(user, g)) },
    select: {
      name: true, status: true, website: true, entityType: true, hasCompany: true, csr: { select: { csrEligible: true } },
      // company facts live in the company add-on
      company: { select: { cin: true, employeeCount: true, industry: { select: { label: true } }, category: { select: { label: true } } } },
      locations: { where: { isPrimary: true, isActive: true }, select: { city: true, state: true }, take: 1 },
      csrFinancials: { select: { fy: true, obligationRs: true, spentRs: true, unspentRs: true }, orderBy: { fy: "desc" }, take: 1 },
      spocs: { where: { isActive: true }, select: { approvalStatus: true, email: true, salesStatus: { select: { label: true } } } },
      assignments: { where: { endedAt: null }, select: { user: { select: { firstName: true, lastName: true } } } },
      _count: { select: { locations: { where: { isActive: true } }, keyAccounts: true } },
    },
  });
  if (!g || !c) return "I can't see this client — it may be outside your access.";
  const hq = c.locations[0];
  const out = [`**${c.name}** — ${c.status.toLowerCase()} client${c.company?.industry ? `, ${c.company.industry.label}` : ""}${c.company?.category ? ` (${c.company.category.label})` : ""}${hq?.state ? `, head office in ${[hq.city, hq.state].filter(Boolean).join(", ")}` : ""}.`, ""];
  out.push("**Where it stands**");
  out.push(`- Assigned to ${c.assignments.length ? c.assignments.map((a) => nameOf(a.user)).join(", ") : "nobody yet"}${c._count.keyAccounts ? `; a key account for ${c._count.keyAccounts}` : ""}${c.csr?.csrEligible === true ? "; marked CSR eligible" : c.csr?.csrEligible === false ? "; marked not CSR eligible" : ""}.`);
  if (perms["spocs.read"]) {
    const approved = c.spocs.filter((s) => s.approvalStatus === "APPROVED").length;
    const status = new Map<string, number>();
    for (const s of c.spocs) status.set(s.salesStatus?.label ?? "no status", (status.get(s.salesStatus?.label ?? "no status") ?? 0) + 1);
    out.push(
      c.spocs.length
        ? `- **${c.spocs.length} SPOC${c.spocs.length === 1 ? "" : "s"}** (${approved} approved, ${c.spocs.filter((s) => s.email).length} with email): ${[...status].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}.`
        : "- **No SPOCs yet** — nobody to contact.",
    );
  }
  out.push(...(await workLines({ clientId: id })));
  if (perms["client_financials.read"]) {
    const f = c.csrFinancials[0];
    out.push("", "**CSR**");
    out.push(
      f
        ? `- FY ${f.fy}: spent ${f.spentRs !== null ? `₹${n(Number(f.spentRs))}` : "—"}, obligation ${f.obligationRs !== null ? `₹${n(Number(f.obligationRs))}` : "—"}, unspent ${f.unspentRs !== null ? `**₹${n(Number(f.unspentRs))}**` : "—"}.`
        : "- No CSR figures on record yet.",
    );
  }
  // company facts are only "missing" for a company (a ministry has no CIN or head count)
  const isCompany = c.entityType === "COMPANY" || c.hasCompany;
  const missing = [
    !c.website && "website",
    isCompany && !c.company?.cin && "CIN",
    isCompany && !c.company?.industry && "industry",
    !c._count.locations && "an office address",
    isCompany && (c.company?.employeeCount ?? null) === null && "employee count",
  ].filter(Boolean);
  if (missing.length) out.push("", `**Missing:** ${missing.join(", ")}.`);
  return out.join("\n");
};

/** any other page (dashboard, reports…): the overall picture of what the user can see, plus their own open work */
const explainOverview = async (user: AuthUser, perms: PermissionMap) => {
  const out: string[] = ["**Where things stand** — everything you have access to, right now.", ""];
  if (perms["clients.read"]) {
    const c = await computeClientStats({ user, scope: perms["clients.read"], figures: !!perms["client_financials.read"] }, listClientsQuery.parse({}));
    out.push("**Clients**");
    out.push(`- ${n(c.total)} clients: ${c.by.status.map((x) => `${x.label.toLowerCase()} ${n(x.count)}`).join(", ")}.`);
    if (topOf(c.by.industry, c.total)) out.push(`- Mostly ${topOf(c.by.industry, c.total)}.`);
    if (c.csrSpentRs !== null) out.push(`- CSR spent on record: **₹${n(c.csrSpentRs)}** across ${n(c.has.csrFigures ?? 0)} clients.`);
    const g = gaps(c.total, [["SPOC", c.has.spocs], ["CSR figures", c.has.csrFigures], ["website", c.has.website]]);
    if (g.length) out.push(`- Gaps: ${g.join("; ")}.`);
    out.push("");
  }
  if (perms["spocs.read"]) {
    const d = await computeSpocStats({ user, scope: perms["spocs.read"] }, listSpocsQuery.parse({}));
    out.push("**SPOCs**");
    out.push(`- ${n(d.total)} SPOCs at ${n(d.clients)} clients. Email for ${pct(d.has.email, d.total)}, mobile for ${pct(d.has.phone, d.total)}.`);
    const noStatus = unset(d.by.salesStatus);
    out.push(`- Sales status: ${topOf(d.by.salesStatus, d.total) || "none set"}${noStatus ? `; **${n(noStatus)} have no status yet**` : ""}.`);
    out.push("");
  }
  const mine = await prisma.workTask.findMany({ where: { assigneeId: user.id, status: { not: "DONE" } }, select: { kind: true, title: true, dueAt: true, client: { select: { name: true } } }, orderBy: { dueAt: { sort: "asc", nulls: "last" } }, take: 100 });
  out.push("**Your open work**");
  if (!mine.length) out.push("- No open tasks, calls or meetings assigned to you.");
  else {
    const overdue = mine.filter((t) => t.dueAt && t.dueAt.getTime() < Date.now()).length;
    out.push(`- ${mine.length} open${overdue ? `, **${overdue} overdue**` : ""}.`);
    for (const t of mine.slice(0, 3)) out.push(`- ${t.kind[0]}${t.kind.slice(1).toLowerCase()}: “${t.title}” — ${t.client.name}${t.dueAt ? `, due ${dayOf(t.dueAt)}` : ""}.`);
  }
  out.push("", "For more detail, open Clients or SPOCs and say “explain this” or “show stats” — or ask me for any report.");
  return out.join("\n");
};

const explainPage = async (user: AuthUser, perms: PermissionMap, page: Page, filters: Record<string, string>): Promise<string | null> => {
  if (page.kind === "spocs" && perms["spocs.read"]) return explainSpocs(user, perms, filters);
  if (page.kind === "clients" && perms["clients.read"]) return explainClients(user, perms, filters);
  if (page.kind === "spoc") return explainSpoc(user, perms, page.id);
  if (page.kind === "client") return explainClient(user, perms, page.id);
  return explainOverview(user, perms);
};

// ── "generate report": a ready-made report of the page, no LLM ───────────────

const REPORT_WORD = /\b(reports?|dashboards?|overview|analysis|analyse|analyze|canvas)\b/i;
const FILLER = new Set(
  "generate create build make prepare give show open get me us a an the my our detailed detail full complete proper nice good quick big whole entire report reports dashboard dashboards overview analysis analyse analyze canvas for of on about this that these those page here all everything please pls now can you could would i want need to with in and it them data current".split(" "),
);
/** "generate a detailed report", "build a dashboard for this page" — nothing more specific asked */
const isGenericReport = (t: string) =>
  REPORT_WORD.test(t) && t.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w)).length === 0;

type PresetBlock = { component: string; query: string; params?: Record<string, unknown>; title: string; width?: string };

/** the page's own filters, as the report catalogue reads them (ids / enums only) */
const clientFilterParams = (f: Record<string, string>) => {
  const UUIDS = (v?: string) => (v ? v.split(",").filter((x) => new RegExp(`^${UUID}$`, "i").test(x)).slice(0, 20) : []);
  const out: Record<string, unknown> = {};
  if (f.status && /^(PENDING|ACTIVE|INACTIVE)$/.test(f.status)) out.status = f.status;
  if (f.entityType && /^(COMPANY|GOVERNMENT|INSTITUTION)$/.test(f.entityType)) out.entityType = f.entityType;
  for (const k of ["industryId", "categoryId", "businessUnitId"]) if (UUIDS(f[k]).length) out[k] = UUIDS(f[k]);
  if (f.createdFrom && f.createdTo && /^\d{4}-\d{2}-\d{2}$/.test(f.createdFrom) && /^\d{4}-\d{2}-\d{2}$/.test(f.createdTo)) out.added = { from: f.createdFrom, to: f.createdTo };
  return out;
};

const clientsReport = (cf: Record<string, unknown>): PresetBlock[] => [
  { component: "kpi", query: "clients_count", params: cf, title: "Clients", width: "third" },
  { component: "kpi", query: "csr_total", params: { metric: "spent", ...cf }, title: "CSR spent", width: "third" },
  { component: "kpi", query: "clients_missing", params: { what: "spocs", ...cf }, title: "Clients with no SPOC", width: "third" },
  { component: "bar", query: "clients_by", params: { by: "industry", top: 10, ...cf }, title: "By industry (top 10)", width: "half" },
  { component: "pie", query: "clients_by", params: { by: "category", top: 8, ...cf }, title: "By category", width: "half" },
  { component: "line", query: "clients_added_trend", params: cf, title: "Clients added per month", width: "half" },
  { component: "bar", query: "csr_by_fy", params: cf, title: "CSR by financial year", width: "half" },
  { component: "table", query: "top_clients_by_csr", params: { top: 10, ...cf }, title: "Top 10 clients by CSR spent", width: "full" },
];

const spocsReport = (clientId?: string): PresetBlock[] => {
  const c = clientId ? { clientId } : {};
  return [
    { component: "kpi", query: "spocs_count", params: c, title: "SPOCs", width: "third" },
    { component: "kpi", query: "spocs_count", params: { ...c, approvalStatus: "APPROVED" }, title: "Approved for outreach", width: "third" },
    { component: "kpi", query: "spocs_count", params: { ...c, approvalStatus: "PENDING" }, title: "Waiting for approval", width: "third" },
    { component: "bar", query: "spocs_by", params: { by: "sales_status", ...c }, title: "By sales status", width: "half" },
    { component: "pie", query: "spocs_by", params: { by: "email_status", ...c }, title: "Email status", width: "half" },
    ...(clientId ? [] : [{ component: "bar", query: "spocs_by", params: { by: "handler", top: 10 }, title: "By handler (top 10)", width: "half" }]),
    { component: "bar", query: "spocs_by", params: { by: "validation_band", ...c }, title: "Data quality", width: clientId ? "full" : "half" },
    { component: "table", query: "spocs_list", params: { ...c, limit: 100 }, title: clientId ? "SPOCs of this client" : "SPOCs", width: "full" },
  ];
};

/** one client: its row, CSR by year, its programmes' money, its SPOCs */
const clientReport = (clientId: string): PresetBlock[] => [
  { component: "table", query: "clients_list", params: { clientId, limit: 1 }, title: "Client", width: "full" },
  { component: "kpi", query: "csr_total", params: { metric: "spent", clientId }, title: "CSR spent (latest year)", width: "third" },
  { component: "kpi", query: "csr_total", params: { metric: "obligation", clientId }, title: "CSR obligation (latest year)", width: "third" },
  { component: "kpi", query: "spocs_count", params: { clientId }, title: "SPOCs", width: "third" },
  { component: "bar", query: "csr_by_fy", params: { clientId }, title: "CSR by financial year", width: "half" },
  { component: "bar", query: "spocs_by", params: { by: "sales_status", clientId }, title: "SPOCs by sales status", width: "half" },
  { component: "table", query: "spocs_list", params: { clientId, limit: 100 }, title: "SPOCs of this client", width: "full" },
];

// ── a client named on its own ────────────────────────────────────────────────
// "open Infosys" → its page; "Infosys details", "3FIVE8 … report of this client
// alone" → a report on that client only. Read from the names in the CRM, no AI.

const OPEN_VERB = /\b(open|go to|goto|take me to|navigate to|jump to|visit)\b/i;
const CLIENT_REPORT_WORD = /\b(report|reports|details?|detailed|summary|overview|profile|info|information|data|everything|canvas)\b/i;
const FILLER_WORDS = new Set(
  ("please pls kindly can could would you me i want to see show open go goto take navigate jump visit get give bring pull up " +
    "the a an of about for on this that client company account alone only just generate make create build prepare full complete " +
    "detailed detail details report reports summary overview profile info information data everything page canvas all its it " +
    "with and in here now quickly").split(" "),
);

const namedClient = async (text: string) => {
  const ex = await extractEntities(text);
  const clients = ex.entities.filter((e) => e.kind === "client");
  if (clients.length !== 1 || ex.entities.length !== 1) return null;
  const rest = ex.masked
    .replace(clients[0]!.ph, " ")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!rest.every((w) => FILLER_WORDS.has(w))) return null;
  const words = rest.join(" ");
  return { id: clients[0]!.value!, label: clients[0]!.label, open: OPEN_VERB.test(words) && !CLIENT_REPORT_WORD.test(words), report: CLIENT_REPORT_WORD.test(words) };
};

const presetFor = (page: Page, filters: Record<string, string>): { title: string; blocks: PresetBlock[]; note: string } | null => {
  if (page.kind === "clients") {
    const cf = clientFilterParams(filters);
    const used = Object.keys(cf).length;
    const extra = filterCount(filters) - used;
    return {
      title: "Clients report",
      blocks: clientsReport(cf),
      note: `Built a clients report${used ? " with the filters on your page" : ""}.${extra > 0 ? ` (${extra} of your filters can't be used in reports yet, so they are left out.)` : ""}`,
    };
  }
  if (page.kind === "spocs")
    return { title: "SPOCs report", blocks: spocsReport(), note: `Built a SPOCs report.${filterCount(filters) ? " Note: it covers all your SPOCs — the page filters aren't applied to reports yet." : ""}` };
  if (page.kind === "client") return { title: "Client report", blocks: clientReport(page.id), note: "Built a report of this client: CSR by year and its SPOCs." };
  if (page.kind === "spoc") return null;
  return {
    title: "CRM overview",
    blocks: [...clientsReport({}).slice(0, 4), ...spocsReport().slice(3, 5), clientsReport({})[7]!],
    note: "Built an overview report of everything you can see.",
  };
};

// ── a question about the record on screen ("is this from Maharashtra?") ───────

const QUESTION_RE = /^(is|are|was|does|do|did|what|whats|what's|who|whos|who's|when|where|which|how|has|have|any|tell me)\b/i;

/** the facts of the open record as { label, value } — only what this user may see */
const recordFacts = async (user: AuthUser, perms: PermissionMap, page: Page): Promise<{ name: string; facts: [string, string][] } | null> => {
  if (page.kind === "client") {
    const g = perms["clients.read"];
    if (!g) return null;
    const c = await prisma.client.findFirst({
      where: { id: page.id, deletedAt: null, ...(g === true ? {} : await clientScopeWhere(user, g)) },
      select: {
        name: true, status: true, website: true, entityType: true, businessUnit: { select: { name: true } },
        company: { select: { cin: true, employeeCount: true, industry: { select: { label: true } }, category: { select: { label: true } } } },
        locations: { where: { isActive: true }, select: { city: true, state: true, district: true, isPrimary: true }, take: 50 },
        assignments: { where: { endedAt: null }, select: { user: { select: { firstName: true, lastName: true } } } },
        _count: { select: { spocs: { where: { isActive: true } } } },
      },
    });
    if (!c) return null;
    const facts: [string, string][] = [["status", c.status.toLowerCase()], ["type", c.entityType.toLowerCase()]];
    if (c.company?.industry) facts.push(["industry", c.company.industry.label]);
    if (c.company?.category) facts.push(["category", c.company.category.label]);
    if (c.businessUnit) facts.push(["business unit", c.businessUnit.name]);
    for (const l of c.locations) {
      if (l.state) facts.push([l.isPrimary ? "head office state" : "office state", l.state]);
      if (l.city) facts.push([l.isPrimary ? "head office city" : "office city", l.city]);
      if (l.district) facts.push(["district", l.district]);
    }
    for (const a of c.assignments) facts.push(["assigned to", nameOf(a.user)]);
    facts.push(["SPOCs", String(c._count.spocs)]);
    if (c.website) facts.push(["website", c.website]);
    if (c.company?.cin) facts.push(["CIN", c.company.cin]);
    if (c.company?.employeeCount != null) facts.push(["employees", String(c.company.employeeCount)]);
    return { name: c.name, facts };
  }
  if (page.kind === "spoc") {
    const g = perms["spocs.read"];
    if (!g) return null;
    const sp = await prisma.clientSpoc.findFirst({
      where: { id: page.id, ...(g === true ? {} : await spocScopeWhere(user, g)) },
      select: {
        firstName: true, lastName: true, designation: true, department: true, state: true, city: true, approvalStatus: true, emailStatus: true,
        client: { select: { name: true } }, handler: { select: { firstName: true, lastName: true } }, salesStatus: { select: { label: true } },
        location: { select: { city: true, state: true } }, businessUnit: { select: { name: true } },
      },
    });
    if (!sp) return null;
    const facts: [string, string][] = [["client", sp.client.name], ["handler", nameOf(sp.handler)], ["approval", sp.approvalStatus.toLowerCase()], ["email status", sp.emailStatus.toLowerCase()], ["business unit", sp.businessUnit.name]];
    if (sp.designation) facts.push(["designation", sp.designation]);
    if (sp.department) facts.push(["department", sp.department]);
    if (sp.salesStatus) facts.push(["sales status", sp.salesStatus.label]);
    for (const [k, v] of [["state", sp.state ?? sp.location?.state], ["city", sp.city ?? sp.location?.city]] as const) if (v) facts.push([k, v]);
    return { name: nameOf(sp), facts };
  }
  return null;
};

const SPELLINGS: [RegExp, string][] = [[/\b(bengaluru|bangalore|bengalooru|bangaluru)\b/g, "bengaluru"], [/\b(mumbai|bombay)\b/g, "mumbai"], [/\b(chennai|madras)\b/g, "chennai"], [/\b(kolkata|calcutta)\b/g, "kolkata"], [/\b(gurugram|gurgaon)\b/g, "gurugram"], [/\b(pune|poona)\b/g, "pune"]];
const same = (t: string) => SPELLINGS.reduce((x, [re, to]) => x.replace(re, to), t.toLowerCase());
const PLACE_Q = /\b(from|in|at|located|based|belongs? to|office|state|city|where)\b/i;

/** yes / no from the record's own facts; null = not something the facts can answer */
const answerAboutRecord = async (user: AuthUser, perms: PermissionMap, page: Page, prompt: string): Promise<string | null> => {
  const rec = await recordFacts(user, perms, page);
  if (!rec) return null;
  const q = same(prompt);
  // one line per distinct fact
  const facts = [...new Map(rec.facts.map(([k, v]) => [`${k.replace(/^(head office|office) /, "")}:${v.toLowerCase()}`, [k, v] as [string, string]])).values()];
  const NOISE = new Set(["this", "that", "from", "they", "them", "their", "have", "does", "what", "which", "where", "when", "client", "spoc", "company", "based", "located", "office", "state", "city", "there", "with", "about", "tell", "many", "much", "name", "limited", "private"]);
  const words = (q.match(/[a-z]{4,}/g) ?? []).filter((w) => !NOISE.has(w));
  // the question names a value the record has ("Karnataka", "Bangalore" ↔ "Bengaluru Urban")
  const hits = facts.filter(([, v]) => {
    const val = same(v);
    return v.length >= 3 && (q.includes(val) || words.some((w) => new RegExp(`\\b${w}\\b`).test(val)));
  });
  if (hits.length) return `**Yes.** ${rec.name} — ${hits.slice(0, 4).map(([k, v]) => `${k}: **${v}**`).join(", ")}.`;
  // asked about a field by name: "what is the industry", "who is the handler"
  const asked = facts.filter(([k]) => q.includes(k.toLowerCase()) || q.includes(k.toLowerCase().replace(/^(head office|office) /, "")));
  if (asked.length) return `${rec.name} — ${asked.slice(0, 6).map(([k, v]) => `${k}: **${v}**`).join(", ")}.`;
  if (PLACE_Q.test(prompt)) {
    const states = [...new Set(facts.filter(([k]) => /state/.test(k)).map(([, v]) => v))];
    const cities = [...new Set(facts.filter(([k]) => /city|district/.test(k)).map(([, v]) => v))];
    return states.length || cities.length
      ? `**No** — I don't see that on ${rec.name}. Its offices are in ${[states.slice(0, 6).join(", "), cities.length ? `(${cities.slice(0, 6).join(", ")})` : ""].filter(Boolean).join(" ")}.`
      : `${rec.name} has no location on record yet, so I can't tell.`;
  }
  return null;
};

// ── which person? ────────────────────────────────────────────────────────────

/** a first name shared by several people ("Rahul") → ask which one, instead of guessing */
const whichPerson = async (prompt: string): Promise<AssistReply | null> => {
  const words = [...new Set(prompt.match(/\b[A-Za-z]{3,}\b/g) ?? [])];
  if (!words.length || words.length > 30) return null;
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: words.map((w) => ({ firstName: { equals: w, mode: "insensitive" as const } })) },
    select: { firstName: true, lastName: true },
    take: 20,
  });
  const byFirst = new Map<string, { firstName: string; lastName: string | null }[]>();
  for (const u of users) byFirst.set(u.firstName.toLowerCase(), [...(byFirst.get(u.firstName.toLowerCase()) ?? []), u]);
  for (const [first, people] of byFirst) {
    // two accounts with the very same name can't be told apart by name — nothing useful to ask
    if (new Set(people.map((p) => nameOf(p).toLowerCase())).size < 2) continue;
    // the full name was already said → nothing to ask
    if (people.some((p) => p.lastName && new RegExp(`\\b${first}\\s+${p.lastName.replace(/[^A-Za-z ]/g, "")}\\b`, "i").test(prompt))) continue;
    const re = new RegExp(`\\b${first}\\b`, "i");
    return {
      ...local("clarify", `There are ${people.length} people called ${people[0]!.firstName}. Which one do you mean?`),
      options: people.slice(0, 4).map((p) => prompt.replace(re, nameOf(p))),
    };
  }
  return null;
};

// ── the router ───────────────────────────────────────────────────────────────

/** "only Karnataka" keeps the filters already on the page; a fresh "show active clients" replaces them */
const mergeUrl = (url: string, page: PageContext, prompt: string) => {
  const target = new URL(url, "http://x");
  if (target.pathname !== page.path.replace(/\/+$/, "") || !ADD_RE.test(prompt)) return url;
  const merged = new URLSearchParams(page.query ?? "");
  merged.delete("page");
  for (const [k, v] of target.searchParams) merged.set(k, v);
  const qs = merged.toString();
  return `${target.pathname}${qs ? `?${qs}` : ""}`;
};

export const assist = async (
  user: AuthUser,
  perms: PermissionMap,
  body: { prompt: string; threadId?: string | undefined; page: PageContext; context?: { prompt: string; question: string } | undefined; learnFrom?: string | undefined },
): Promise<AssistReply> => {
  const startedAt = Date.now();
  const said = body.prompt.trim();
  // the answer to a question I asked continues that request ("…handled by Rahul" → "which one?" → "Rahul Sharma")
  const standalone = isNewThreadRequest(said) || isExplainRequest(said) || CLEAR_RE.test(said) || isStatsRequest(said) || isGenericReport(said);
  const prompt = body.context && !standalone ? `${body.context.prompt} — ${said}`.slice(0, 500) : said;
  const page = readPage(body.page.path);
  const filters = filtersOf(body.page.query);
  const toThread = () => askThread(user, perms, { prompt, ...(body.threadId && { threadId: body.threadId }), page: body.page.path, learnFrom: body.learnFrom ?? body.context?.prompt });
  const free = (action: string, reply: AssistReply) =>
    logAi({ user, mode: "COMMAND", usageMode: "COMMAND", input: prompt, tier: "local", outcome: "success", action, startedAt }).then(() => reply);

  if (isNewThreadRequest(prompt)) return toThread();

  // "go back / previous screen" is done by the browser; if it reaches here, say so instead of guessing
  if (/^(please )?(go |take me |get )?(back|to the previous|to previous|previous)( to)?( the| my)?( previous| last)?( page| screen| canvas| report| one)?( please)?$/i.test(said))
    return local("clarify", inCanvasOf(body) ? "Say “go back” or “previous canvas” and I'll open your earlier report." : "Say “go back” and I'll take you to the previous screen.");

  const inCanvas = !!body.page.inCanvas;

  // 0. "what is CSR obligation?" off the canvas — the meaning, free (the canvas adds its own figures)
  const term = !inCanvas && !body.page.canvasShown ? definitionAsked(said) : null;
  if (term) return free("glossary", local("explain", `**${term.term}** is ${term.text}`));

  // 0. a client by name: "open X" → its page, "X details / report" → a report on X alone (free)
  const named = await namedClient(said);
  if (named && perms["clients.read"]) {
    const url = `/clients/${named.id}`;
    if (named.open || (!named.report && !inCanvas))
      return free("open_client", local("canvas", `Opening ${named.label}.`, { type: "navigate", url, samePage: page.path === url }));
    const r = await startPresetThread(user, perms, {
      prompt,
      page: body.page.path,
      title: named.label,
      message: `${named.label}: its details, CSR by year and SPOCs. Say “open ${named.label}” to go to its page.`,
      blocks: clientReport(named.id),
    });
    if (r) return free("client_report", r);
  }

  // 1. clear filters — on the page, free (inside the canvas it means the report's filters)
  if (CLEAR_RE.test(prompt) && !inCanvas && (page.kind === "spocs" || page.kind === "clients")) {
    return free("page_clear", local("canvas", filterCount(filters) ? "Cleared the filters — showing everything you can see." : "There were no filters on. Showing everything you can see.", { type: "navigate", url: page.path, samePage: true }));
  }

  // 3. explain — the canvas if one is on screen, otherwise the page itself (free)
  if (isExplainRequest(prompt)) {
    if (body.page.canvasShown) return toThread();
    const text = await explainPage(user, perms, page, filters);
    if (text) return free("page_explain", local("explain", text));
    return local("clarify", "I can explain the Clients and SPOCs lists, a single client or a single SPOC — open one of those and ask again. Or ask me for a report and I'll explain that.");
  }

  // a question about the record on screen: answered from its own facts (free)
  if ((page.kind === "client" || page.kind === "spoc") && QUESTION_RE.test(said) && !body.page.canvasShown && !ANALYTIC_RE.test(said)) {
    const answer = await answerAboutRecord(user, perms, page, said);
    if (answer) return free("record_answer", local("explain", answer));
  }

  // 2. show stats — inside the canvas: a stats report there; on the page: the page's stats view (free)
  if (isStatsRequest(prompt) && inCanvas && !body.page.canvasShown) {
    const preset = presetFor(page, filters);
    if (preset) {
      const r = await startPresetThread(user, perms, { prompt, page: body.page.path, title: preset.title.replace("report", "stats"), message: `${preset.note.replace("report", "stats report")} Ask me to change anything.`, blocks: preset.blocks });
      if (r) return free("canvas_stats", r);
    }
  }
  if (isStatsRequest(prompt) && !body.page.canvasShown && !inCanvas) {
    if (page.kind === "spocs" || page.kind === "clients") {
      return free("page_stats", local("canvas", `Showing stats for the ${page.kind === "spocs" ? "SPOCs" : "clients"} on screen${scopeLine(filters)}. Click any bar to filter the table. Say “explain this” for a plain-words reading.`, { type: "stats" }));
    }
    // one record, or a page with no stats view of its own: the plain-words picture
    const text = await explainPage(user, perms, page, filters);
    if (text) return free("page_explain", local("explain", text));
  }

  // 4. "generate a (detailed) report" — the page's ready-made report, no guessing
  if ((isGenericReport(prompt) || (inCanvas && isStatsRequest(prompt))) && !body.page.canvasShown) {
    const preset = presetFor(page, filters);
    if (preset) {
      const r = await startPresetThread(user, perms, { prompt, page: body.page.path, title: preset.title, message: `${preset.note} Ask me to change anything — “only top 5”, “add CSR by year”, “make it a pie”.`, blocks: preset.blocks });
      if (r) return free("page_report", r);
    }
    if (page.kind === "spoc") {
      const text = await explainPage(user, perms, page, filters);
      if (text) return free("page_explain", local("explain", text));
    }
  }

  // 4a. clearly a report, or anything said while the canvas is open (it never sends you to another screen)
  if (ANALYTIC_RE.test(prompt) || inCanvas || body.page.canvasShown) return toThread();

  // deleting records is never the assistant's job — say where it's done (and that it can be restored)
  if (!inCanvas && /^(please )?(delete|remove|erase|wipe|purge|destroy)\b/i.test(said) && /\b(clients?|spocs?|contacts?|records?|users?|these|them|this|all)\b/i.test(said))
    return local("rejected", "I don't delete things. Delete it on the page — it goes to the Recycle bin and can be restored any time.");

  // an action ("assign these to Ravi", "mark them as In Discussion"): a proposal to confirm — never done here
  if (ACTION_RE.test(said) && !inCanvas) {
    const who0 = await whichPerson(prompt);
    if (who0) return free("which_person", who0);
    const kindOf = page.kind === "clients" || page.kind === "spocs" || page.kind === "client" || page.kind === "spoc" ? page.kind : "other";
    const plan = await planAction(user, perms, prompt, { kind: kindOf, ...("id" in page && { id: page.id }) }, filters);
    if (plan.kind === "action") return { ...local("action", plan.message), proposal: plan.proposal, free: false };
    if (plan.kind === "clarify") return { ...local("clarify", plan.message), ...(plan.options && { options: plan.options }), free: false };
    return local(plan.kind, plan.message);
  }

  // a shared first name: ask which person before filtering by the wrong one
  const who = await whichPerson(prompt);
  if (who) return free("which_person", who);

  // 1. a page command: open a page / filter it
  if (perms["ai_assistant.command_use"]) {
    const r = await resolveCommand(user, perms, prompt);
    if (r.type === "navigate") {
      // "open the canvas with this" is a report request — build it here, never bounce to the canvas page
      if (r.url.startsWith("/ai-canvas")) return toThread();
      const url = mergeUrl(r.url, body.page, prompt);
      const samePage = new URL(url, "http://x").pathname === page.path;
      const said = samePage ? `Done — ${r.spoken.replace(/^(opening|here (is|are)|showing)\s+/i, "showing ")}` : r.spoken;
      return { ...local("canvas", r.note ? `${said} ${r.note}` : said, { type: "navigate", url, samePage }), free: false };
    }
    if (r.type === "rejected") return local("rejected", r.message);
    if (r.type === "clarify") return { ...local("clarify", r.message), free: false };
    if (r.type === "error") return local("error", r.message);
    // "search" = no page matched → maybe it is a report after all
  }
  return toThread();
};

export const pageContextSchema = z
  .object({ path: z.string().max(200).regex(/^\/[A-Za-z0-9\-_/]*$/), query: z.string().max(2000).optional(), canvasShown: z.boolean().optional(), inCanvas: z.boolean().optional() })
  .strict();
