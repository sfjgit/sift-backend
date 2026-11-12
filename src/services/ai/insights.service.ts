// File: insights.service.ts
// Path: src/services/ai/insights.service.ts
//
// "What do you think about this page?" — FREE, rule-based insights. No LLM:
// the same scoped, read-only canvas queries run through aiDb, and fixed rules
// turn the numbers into short sentences (totals, shares, FY-over-FY change, a
// straight-line forecast, and what to do next). The model never sees the data
// (spec golden rule 3) and it costs ₹0 — AI-written narratives over data stay
// out of scope until management opts in (spec §13).

import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import { runSpec, validateSpec, type RenderedBlock } from "@/services/ai/canvas.service";
import type { QueryResult } from "@/config/queryRegistry";

export type InsightPage = "clients" | "spocs" | "pipeline" | "overview";

type Plan = { id: string; component: "kpi" | "bar"; query: string; params?: Record<string, unknown> };

const PLANS: Record<InsightPage, Plan[]> = {
  clients: [
    { id: "status", component: "bar", query: "clients_by", params: { by: "status" } },
    { id: "industry", component: "bar", query: "clients_by", params: { by: "industry", top: 3 } },
    { id: "noSpocs", component: "kpi", query: "clients_missing", params: { what: "spocs" } },
    { id: "noApproved", component: "kpi", query: "clients_missing", params: { what: "approved" } },
    { id: "csr", component: "bar", query: "csr_same_clients", params: { years: 2 } },
    { id: "csr3", component: "bar", query: "csr_same_clients", params: { years: 3 } },
    { id: "added", component: "bar", query: "clients_added_trend" },
  ],
  spocs: [
    { id: "approval", component: "bar", query: "spocs_by", params: { by: "approval_status" } },
    { id: "email", component: "bar", query: "spocs_by", params: { by: "email_status" } },
    { id: "sales", component: "bar", query: "spocs_by", params: { by: "sales_status", top: 3 } },
  ],
  pipeline: [
    { id: "runs", component: "bar", query: "runs_by", params: { by: "status" } },
    { id: "trend", component: "bar", query: "runs_trend" },
  ],
  overview: [
    { id: "status", component: "bar", query: "clients_by", params: { by: "status" } },
    { id: "approval", component: "bar", query: "spocs_by", params: { by: "approval_status" } },
    { id: "runs", component: "bar", query: "runs_by", params: { by: "status" } },
    { id: "csr", component: "bar", query: "csr_same_clients", params: { years: 2 } },
    { id: "csr3", component: "bar", query: "csr_same_clients", params: { years: 3 } },
    { id: "noSpocs", component: "kpi", query: "clients_missing", params: { what: "spocs" } },
  ],
};

const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
const num = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

type Series = Extract<QueryResult, { kind: "series" }>;
const series = (b: RenderedBlock | undefined) => (b?.result?.kind === "series" ? (b.result as Series) : null);
const single = (b: RenderedBlock | undefined) => (b?.result?.kind === "single" ? b.result.value : null);
const valueOf = (s: Series | null, label: string) => Number(s?.points.find((p) => p.label.toLowerCase() === label)?.value ?? 0);
const total = (s: Series | null) => (s ? s.points.reduce((n, p) => n + Number(p.value ?? 0), 0) : 0);

// "2025-26" → "2026-27", "2025-2026" → "2026-2027" (same style as the data)
const nextFy = (fy: string) => {
  const y = Number(fy.slice(0, 4)) + 1;
  return /^\d{4}-\d{4}$/.test(fy) ? `${y}-${y + 1}` : `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

/** least-squares straight line through the last few FY totals → next FY */
const forecast = (values: number[]) => {
  const n = values.length;
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let num_ = 0;
  let den = 0;
  values.forEach((y, x) => {
    num_ += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  const slope = den ? num_ / den : 0;
  return Math.max(0, ym + slope * (n - xm));
};

const sentences = (page: InsightPage, by: Map<string, RenderedBlock>) => {
  const say: string[] = [];
  const next: string[] = [];

  // clients
  const st = series(by.get("status"));
  if (st && total(st)) {
    const t = total(st);
    const active = valueOf(st, "active");
    const pending = valueOf(st, "pending");
    say.push(`You can see ${num(t)} clients: ${num(active)} active${pending ? `, ${num(pending)} waiting for approval` : ""}.`);
    if (pending) next.push(`approve the ${num(pending)} pending clients`);
  }
  const ind = series(by.get("industry"));
  if (ind && ind.points.length && total(ind)) {
    const [a, b] = ind.points.filter((p) => p.label !== "Not set" && p.label !== "Others");
    if (a) say.push(`Most are in ${a.label} (${pct(Number(a.value), total(ind))}%)${b ? `, then ${b.label}` : ""}.`);
  }
  const noSpocs = single(by.get("noSpocs"));
  if (noSpocs) next.push(`find SPOCs for the ${num(noSpocs)} clients that have none`);
  const noApproved = single(by.get("noApproved"));
  if (noApproved && noApproved !== noSpocs) say.push(`${num(noApproved)} clients have no approved SPOC yet, so they can't be contacted.`);

  // like-for-like: only clients that reported in every FY compared
  const csr = series(by.get("csr"));
  const fys = (csr?.points ?? []).filter((p) => Number(p.value) > 0);
  const compared = Number(fys[0]?.clients ?? 0);
  if (fys.length >= 2 && compared >= 3) {
    const prev = fys[fys.length - 2]!;
    const last = fys[fys.length - 1]!;
    const change = Math.round(((Number(last.value) - Number(prev.value)) / Number(prev.value)) * 100);
    say.push(
      `For the ${num(compared)} clients with CSR figures every year, spent went from ${inr(Number(prev.value))} in FY ${prev.label} to ${inr(Number(last.value))} in FY ${last.label} — ${change >= 0 ? "up" : "down"} ${Math.abs(change)}%.`,
    );
    const three = (series(by.get("csr3"))?.points ?? []).filter((p) => Number(p.value) > 0);
    if (three.length >= 3 && Number(three[0]!.clients) >= 3) {
      const f = forecast(three.map((p) => Number(p.value)));
      say.push(
        `For the ${num(Number(three[0]!.clients))} clients with three years of figures, the trend points to about ${inr(f)} in FY ${nextFy(last.label)} — a rough straight-line estimate.`,
      );
    }
  } else if (csr) {
    say.push("Too few clients have CSR figures for every year to show a fair trend yet.");
    next.push("add CSR figures for more clients (the Reports / CSR figures steps)");
  }
  const added = series(by.get("added"));
  if (added && added.points.length >= 2) {
    const [p, c] = added.points.slice(-2);
    say.push(`${num(Number(c!.value))} new clients this month, against ${num(Number(p!.value))} last month.`);
  }

  // SPOCs
  const ap = series(by.get("approval"));
  if (ap && total(ap)) {
    const t = total(ap);
    const approved = valueOf(ap, "approved");
    const pending = valueOf(ap, "pending");
    say.push(`${num(t)} active SPOCs: ${num(approved)} approved for outreach${pending ? `, ${num(pending)} pending approval` : ""}.`);
    if (pending) next.push(`clear the ${num(pending)} SPOC approvals so they can be contacted`);
  }
  const em = series(by.get("email"));
  if (em) {
    const bad = valueOf(em, "bad");
    const unverified = valueOf(em, "unverified");
    if (bad) say.push(`${num(bad)} SPOCs have bad emails.`);
    if (unverified) next.push(`verify the ${num(unverified)} unverified emails`);
  }
  const sales = series(by.get("sales"));
  if (sales) {
    const top = sales.points.find((p) => p.label !== "Not set" && p.label !== "Others");
    if (top) say.push(`The most common sales status is ${top.label} (${num(Number(top.value))}).`);
  }

  // pipeline
  const runs = series(by.get("runs"));
  if (runs && total(runs)) {
    const t = total(runs);
    const failed = valueOf(runs, "failed") + valueOf(runs, "timed out") + valueOf(runs, "dispatch failed");
    say.push(`${num(t)} pipeline runs in the last 30 days, ${num(failed)} failed (${pct(failed, t)}%).`);
    if (pct(failed, t) >= 20) next.push("look at System alerts — that failure rate is high");
  }
  const tr = series(by.get("trend"));
  if (tr && tr.points.length >= 14) {
    const v = tr.points.map((p) => Number(p.value));
    const thisWeek = v.slice(-7).reduce((a, b) => a + b, 0);
    const lastWeek = v.slice(-14, -7).reduce((a, b) => a + b, 0);
    if (thisWeek || lastWeek) say.push(`This week has ${num(thisWeek)} runs against ${num(lastWeek)} the week before.`);
  }

  if (!say.length) say.push(page === "overview" ? "There isn't enough data yet to say much." : "There isn't enough data on this page yet.");
  if (next.length) say.push(`My suggestion: ${next.slice(0, 2).join(", and ")}.`);
  return say;
};

export const pageInsights = async (user: AuthUser, perms: PermissionMap, page: InsightPage) => {
  // keep only the blocks this user may run
  const blocks = PLANS[page].flatMap((b) => {
    try {
      return validateSpec({ title: "insights", blocks: [{ ...b, params: b.params ?? {} }] }, perms).blocks.map((x) => ({ ...x, id: b.id }));
    } catch {
      return [];
    }
  });
  if (!blocks.length) return { page, lines: ["You don't have access to the numbers behind this page."] };
  const rendered = await runSpec(user, perms, { title: "insights", blocks }, 50);
  return { page, lines: sentences(page, new Map(rendered.map((b) => [b.id, b]))) };
};
