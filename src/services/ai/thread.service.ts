// File: thread.service.ts
// Path: src/services/ai/thread.service.ts
//
// AI threads — saved conversations (13 Nov 2026). One thread = one canvas that
// grows through follow-ups, like a chat in Claude / ChatGPT:
//
//   "clients by industry"            → new thread, canvas v1
//   "make it a pie, only top 5"      → follow-up, canvas v2 (same thread)
//   "explain this report"            → plain-words explanation, NO LLM
//   "show SPOCs by sales status"     → the model says "new topic" → new thread
//
// The golden rule is unchanged: the LLM only picks queries from the catalog.
// It never sees a row, a name or a number — request text is masked (T1), and the
// current canvas is sent with its filter values replaced by {keep_N} tokens.
// Every answer is validated against the registry (G4) and run read-only (G6).
//
// Memory: a masked request on a given canvas shape → the answer. Asking the
// same thing again (even for another industry / date) costs nothing.
// Threads / turns / memory are the assistant's own bookkeeping tables; business
// data is still only ever read.

import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { tenantIdOrThrow } from "@/utils/prisma/tenant";
import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { checkDestructiveIntent, READ_ONLY_MESSAGE } from "@/config/aiGuardrails";
import { queryDef, type QueryResult } from "@/config/queryRegistry";
import { catalogFor, COMPONENTS, runSpec, SpecInvalid, unmaskText, validateSpec, WIDTHS, type RenderedBlock, type ValidSpec } from "@/services/ai/canvas.service";
import { entityHints, extractEntities } from "@/services/ai/entities.service";
import { bindPlaceholders, checkSql, FreeSqlError, schemaForModel } from "@/services/ai/sql.service";
import { LlmError, llm, REJECT_TOOL, type LlmTool } from "@/services/ai/llm.service";
import { logAi, type AiOutcome, type AiTier } from "@/services/ai/audit.service";
import { BASIC_MODE_MESSAGE, budgetState, checkBudgetAlerts, type TokenUsage } from "@/services/ai/cost.service";
import { llmConfigured } from "@/services/ai/settings.service";

// ── free, local intents ──────────────────────────────────────────────────────

const NEW_RE = /^\s*(please\s+)?((start|open|create|make|begin)\s+)?(a\s+)?(new|fresh|another)\s+(chat|canvas|report|thread|one|topic|conversation)\b|^\s*(start over|new one|clear (the )?(chat|canvas|conversation))\s*[.!]*$/i;
/** "new chat", "start a new canvas", "start over" — the user ends the thread */
export const isNewThreadRequest = (text: string) => NEW_RE.test(text);

const EXPLAIN_VERB = /\b(explain|summari[sz]e|summary|walk me through|key (points|takeaways)|what (does|do) (this|it|these|that) (mean|show|say|tell)|what am i (looking at|seeing)|insights?|interpret|break (it|this) down)\b/i;
const ABOUT_THIS = /\b(this|it|these|that|the (report|canvas|chart|charts|numbers|page|table|above)|report|canvas)\b/i;
/** "explain this report", "give me a summary", "what does this show" — about the canvas on screen */
export const isExplainRequest = (text: string) => {
  const t = text.trim();
  if (!EXPLAIN_VERB.test(t)) return false;
  const words = t.split(/\s+/).length;
  return words <= 4 || (words <= 12 && ABOUT_THIS.test(t));
};

// ── {keep_N}: the current canvas without its filter values ───────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FY = /^\d{4}-\d{2}$/;
const KEEP = /^\{keep_\d+\}$/;
const isRange = (v: unknown): v is { from: string; to: string } =>
  !!v && typeof v === "object" && !Array.isArray(v) && "from" in (v as object) && "to" in (v as object);
/** a value that came from the user's data (an id, a date range, an FY) — never shown to the LLM */
const isValue = (v: unknown) => (typeof v === "string" && (UUID.test(v) || FY.test(v))) || isRange(v);

type Block = ValidSpec["blocks"][number];
interface Tokenised {
  template: { title: string; blocks: { component: Block["component"]; query: string; params: Record<string, unknown>; title: string; width: Block["width"] }[] };
  keep: Record<string, unknown>;
}

/** same shape + same order → same tokens, whatever the values are */
export const tokeniseSpec = (spec: ValidSpec): Tokenised => {
  const keep: Record<string, unknown> = {};
  let n = 0;
  const tok = (v: unknown) => {
    const t = `{keep_${++n}}`;
    keep[t] = v;
    return t;
  };
  const blocks = spec.blocks.map((b) => {
    const params: Record<string, unknown> = {};
    for (const k of Object.keys(b.params).sort()) {
      const v = b.params[k];
      params[k] = Array.isArray(v) ? v.map((x) => (isValue(x) ? tok(x) : x)) : isValue(v) ? tok(v) : v;
    }
    return { component: b.component, query: b.query, params, title: b.title, width: b.width };
  });
  return { template: { title: spec.title, blocks }, keep };
};

/** put the kept values back into what the LLM returned */
const restoreKeep = (raw: unknown, keep: Record<string, unknown>): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const spec = raw as { blocks?: unknown };
  if (!Array.isArray(spec.blocks)) return raw;
  const one = (v: unknown): unknown => {
    if (typeof v !== "string" || !KEEP.test(v.trim())) return v;
    if (!(v.trim() in keep)) throw new SpecInvalid(`unknown saved value ${v}`);
    return keep[v.trim()];
  };
  return {
    ...spec,
    blocks: spec.blocks.map((b) => {
      if (!b || typeof b !== "object") return b;
      const params = (b as { params?: unknown }).params;
      if (!params || typeof params !== "object") return b;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params as Record<string, unknown>)) out[k] = Array.isArray(v) ? v.map(one) : one(v);
      return { ...b, params: out };
    }),
  };
};

// ── LLM contract ─────────────────────────────────────────────────────────────

const SYSTEM = (catalog: string) => `You are the report assistant of a sales & marketing CRM. You build and refine read-only report pages ("canvases") in a conversation.
Call compose_canvas with the FULL canvas (title + 1-${AI_DEFAULTS.canvasMaxBlocks} blocks) every time — also for a follow-up: return the whole updated canvas, not just the change.
Each block = one query from the catalog + one component.
Components: kpi (for [returns single]), bar / line / pie (for [returns series]; line for trends over time, pie only for few slices), table (for [returns rows] or series), org (for [returns tree] — an org chart, only when structure / hierarchy is asked for; full width).
Widths: full | half | third (kpis usually third, charts half, tables full).

Follow-ups: when "Current canvas" is given, decide what the new request is.
- It asks about a different subject than the canvas shows (people / users / team instead of clients, SPOCs instead of CSR, "take this out and give me X") → relation "new_topic" and build the new canvas straight away. Never ask about this.
- It refines, extends, filters, restyles or corrects the current canvas ("make it a pie", "only top 5", "add SPOCs by status", "no, I meant last year", "remove the table") → relation "follow_up": start from the current canvas and change only what was asked. Keep every other block and every {keep_N} value exactly as it is.
- It is about something unrelated to the current canvas → relation "new_topic": build a fresh canvas and ignore the current one.
With no current canvas, relation is "new_topic".
"summary": one short sentence telling the user what you built or changed (no numbers — you cannot see data).

Values: names in the request are masked as {placeholders}; put them into params exactly as given (e.g. "industryId": "{industry_1}", "added": "{date_range_1}", "fy": "{fy_1}"). {keep_N} are filter values already on the canvas — reuse or drop them, never alter them. Never invent ids or values. Only use params listed for that query.

Unclear requests: if you are not sure what is meant, call ask_clarification with one short question that starts with "Do you mean" and 2-4 options; each option is a complete request the user could have typed. If the user then corrects you, apply the correction to the current canvas.
If the request asks to change, create, delete, assign, send, run or modify CRM records, call reject_request. If it can't be answered with these queries, call ask_clarification and say what you can show instead.

Catalog:
${catalog}`;

const COMPOSE_TOOL: LlmTool = {
  name: "compose_canvas",
  description: "Build the canvas, or return the full updated canvas for a follow-up.",
  input_schema: {
    type: "object",
    properties: {
      relation: { type: "string", enum: ["follow_up", "new_topic"] },
      summary: { type: "string", description: "One short sentence: what was built or changed." },
      title: { type: "string" },
      blocks: {
        type: "array",
        maxItems: AI_DEFAULTS.canvasMaxBlocks,
        items: {
          type: "object",
          properties: {
            component: { type: "string", enum: [...COMPONENTS] },
            query: { type: "string" },
            params: { type: "object" },
            title: { type: "string" },
            width: { type: "string", enum: [...WIDTHS] },
          },
          required: ["component", "query"],
          additionalProperties: false,
        },
      },
    },
    required: ["relation", "summary", "title", "blocks"],
    additionalProperties: false,
  },
};

const CLARIFY_TOOL: LlmTool = {
  name: "ask_clarification",
  description: 'Use when the request is unclear or cannot be answered. One short "Do you mean …?" question with 2-4 complete alternative requests.',
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array", items: { type: "string" }, maxItems: 4 },
    },
    required: ["question"],
    additionalProperties: false,
  },
};

/** FREE HAND — offered to a super admin only, for what the catalog can't answer */
const FREE_TOOL: LlmTool = {
  name: "free_query",
  description:
    "ONLY when no catalog query can answer: write ONE read-only PostgreSQL SELECT over the schema given. Quote table and column names (\"Client\".\"name\"). Names in the request are {placeholders}: write them as {user_1} etc. where a value goes — {user_N}/{client_N} are ids, pick-list ones are Lookup ids, {date_range_N} goes after BETWEEN. Skip soft-deleted rows (\"deletedAt\" IS NULL) and inactive ones where it matters. Give columns short, human names (AS \"Assigned to\").",
  input_schema: {
    type: "object",
    properties: {
      relation: { type: "string", enum: ["follow_up", "new_topic"] },
      summary: { type: "string" },
      title: { type: "string" },
      sql: { type: "string" },
      chart: { type: "string", enum: ["table", "bar", "line", "pie", "kpi"] },
      label_column: { type: "string", description: "for bar/line/pie: the category column" },
      value_columns: { type: "array", items: { type: "string" }, maxItems: 5, description: "for bar/line/pie: the number columns" },
      format: { type: "string", enum: ["number", "money", "percent"] },
    },
    required: ["relation", "summary", "title", "sql", "chart"],
    additionalProperties: false,
  },
};
const FREE_SYSTEM = () => `

FREE HAND (this user is a super admin): if — and only if — no catalog query can answer, call free_query with one read-only SELECT. Prefer the catalog whenever it fits. Schema (tables, columns, links; you never see data):
${schemaForModel()}`;

const composeMeta = z.object({ relation: z.enum(["follow_up", "new_topic"]).optional(), summary: z.string().max(300).optional() }).passthrough();
const clarifySchema = z.object({ question: z.string().min(1).max(300), options: z.array(z.string().min(1).max(160)).max(4).optional() }).strict();
/** the model sometimes writes "Do you mean Do you mean …" */
const tidyQuestion = (q: string) => q.replace(/^(\s*do you mean[:,]?\s+)+/i, "Do you mean ").replace(/\s+/g, " ").trim();

// ── explain (no LLM — the LLM may not see numbers, so the server reads them) ──

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const n = (v: number) => inr.format(v);
const fmt = (v: unknown, format: string) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (format === "money") return `₹${inr.format(n)}`;
  if (format === "percent") return `${Math.round(n * 10) / 10}%`;
  return inr.format(n);
};
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "0%");

const explainResult = (b: RenderedBlock, r: QueryResult): string[] => {
  if (r.kind === "tree") {
    const top = r.root.virtual ? r.root.children : [r.root];
    const heads = top.slice(0, 4).map((n) => `**${n.firstName} ${n.lastName ?? ""}`.trim() + `** (${n.teamSize} below)`);
    const flat: typeof r.root[] = [];
    const walk = (n: typeof r.root) => (flat.push(n), n.children.forEach(walk));
    top.forEach(walk);
    const busiest = [...flat].sort((a, z) => z.stats.clients + z.stats.spocs - (a.stats.clients + a.stats.spocs))[0];
    const managers = flat.filter((n) => n.children.length).length;
    return [
      `${n(r.total)} people; ${managers} of them have people reporting to them.`,
      `At the top: ${heads.join(", ")}.`,
      ...(busiest ? [`Carries the most: **${busiest.firstName} ${busiest.lastName ?? ""}**`.trim() + ` — ${busiest.stats.clients} clients, ${busiest.stats.spocs} SPOCs.`] : []),
    ];
  }
  if (r.kind === "single") return [`The figure is **${fmt(r.value, r.format)}**${r.hint ? ` (${r.hint})` : ""}.`];
  if (r.kind === "rows") {
    const lines = [r.total === 0 ? "No records match." : `**${inr.format(r.total)}** records match${r.rows.length < r.total ? `; the first ${inr.format(r.rows.length)} are listed` : ""}.`];
    const num = r.columns.find((c) => c.type === "money" || c.type === "number");
    const name = r.columns.find((c) => c.type === "text");
    if (num && name && r.rows.length > 1) {
      const sorted = [...r.rows].filter((x) => x[num.key] !== null).sort((a, z) => Number(z[num.key]) - Number(a[num.key]));
      const top = sorted[0];
      if (top) lines.push(`Highest ${num.label.toLowerCase()}: **${top[name.key] ?? "—"}** with ${fmt(top[num.key], num.type)}.`);
    }
    return lines;
  }
  // series
  if (!r.points.length) return ["There is nothing to chart for these filters."];
  const lines: string[] = [];
  for (const s of r.series) {
    const vals = r.points.map((p) => ({ label: String(p.label), v: Number(p[s.key] ?? 0) }));
    const total = vals.reduce((a, x) => a + x.v, 0);
    const who = r.series.length > 1 ? `${s.label}: ` : "";
    if (b.component === "line" && vals.length > 1) {
      const first = vals[0]!;
      const last = vals[vals.length - 1]!;
      const peak = vals.reduce((a, x) => (x.v > a.v ? x : a), first);
      const change = first.v ? `${last.v >= first.v ? "up" : "down"} ${pct(Math.abs(last.v - first.v), first.v)}` : last.v > 0 ? "up from zero" : "flat";
      lines.push(`${who}from ${fmt(first.v, r.format)} (${first.label}) to ${fmt(last.v, r.format)} (${last.label}) — **${change}**. Peak: ${peak.label} with ${fmt(peak.v, r.format)}. Total ${fmt(total, r.format)}.`);
    } else {
      const sorted = [...vals].sort((a, z) => z.v - a.v);
      const top = sorted[0]!;
      const top3 = sorted.slice(0, 3).reduce((a, x) => a + x.v, 0);
      lines.push(
        `${who}${vals.length} groups, ${fmt(total, r.format)} in total. Largest: **${top.label}** with ${fmt(top.v, r.format)}${r.format !== "percent" ? ` (${pct(top.v, total)} of the total)` : ""}.` +
          (sorted.length > 3 && r.format !== "percent" ? ` The top 3 make up ${pct(top3, total)}.` : "") +
          (sorted.length > 1 ? ` Smallest: ${sorted[sorted.length - 1]!.label} (${fmt(sorted[sorted.length - 1]!.v, r.format)}).` : ""),
      );
    }
  }
  return lines;
};

const FILTER_WORDS: Record<string, string> = { status: "status", entityType: "type", top: "top", groupBy: "grouped by", by: "by", approvalStatus: "approval", validationBand: "data quality", isActive: "active" };

/** plain-words reading of the canvas on screen — markdown, built from the live numbers */
export const explainCanvas = (spec: ValidSpec, blocks: RenderedBlock[]): string => {
  const out: string[] = [`**${spec.title}** — ${blocks.length} part${blocks.length === 1 ? "" : "s"}. Numbers are live and limited to what you are allowed to see.`, ""];
  for (const b of blocks) {
    const def = queryDef(b.query);
    out.push(`**${b.title}**`);
    if (def) out.push(`- What it is: ${def.description.replace(/\s+/g, " ").trim()}`);
    const filters = Object.entries(b.params)
      .filter(([k, v]) => k in FILTER_WORDS && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
      .map(([k, v]) => `${FILTER_WORDS[k]} ${String(v).toLowerCase().replace(/_/g, " ")}`);
    const ranges = Object.values(b.params).filter(isRange).map((r) => `${r.from} to ${r.to}`);
    if (filters.length || ranges.length) out.push(`- Narrowed to: ${[...filters, ...ranges].join(", ")}`);
    if (b.error || !b.result) out.push(`- ${b.error ?? "No data."}`);
    else for (const l of explainResult(b, b.result)) out.push(`- ${l}`);
    out.push("");
  }
  return out.join("\n").trim();
};

// ── a detail table under the charts (the CEO checks the numbers row by row) ───

const CLIENT_QUERIES = new Set(["clients_count", "clients_missing", "clients_by", "clients_added_trend", "csr_by_fy", "csr_same_clients", "csr_total", "top_clients_by_csr", "outreach_by_status"]);
const SPOC_QUERIES = new Set(["spocs_count", "spocs_by"]);
const USER_QUERIES = new Set(["users_count", "users_by", "users_load_by", "org_tree"]);

/**
 * When a canvas has charts but no table of records, add one at the bottom with
 * the same filters as its first chart. Works on the raw spec (before validation).
 */
export const withDetailTable = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const spec = raw as { blocks?: { component?: string; query?: string; params?: Record<string, unknown> }[] };
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  if (!blocks.length || blocks.length >= AI_DEFAULTS.canvasMaxBlocks) return raw;
  if (blocks.some((b) => b.query === "clients_list" || b.query === "spocs_list" || b.query === "users_workload")) return raw;
  const first = blocks.find((b) => b.query && (CLIENT_QUERIES.has(b.query) || SPOC_QUERIES.has(b.query) || USER_QUERIES.has(b.query)));
  if (!first?.query) return raw;
  const list = CLIENT_QUERIES.has(first.query) ? "clients_list" : SPOC_QUERIES.has(first.query) ? "spocs_list" : "users_workload";
  const def = queryDef(list);
  if (!def) return raw;
  // only the filters the list understands
  const params: Record<string, unknown> = { limit: 200 };
  for (const [k, v] of Object.entries(first.params ?? {})) {
    if (["by", "top", "metric", "what", "years", "fy", "limit", "sort"].includes(k)) continue;
    const probe = def.params.safeParse({ [k]: v });
    if (probe.success || (typeof v === "string" && /^\{[a-z_]+_\d+\}$/.test(v))) params[k] = v;
  }
  return { ...spec, blocks: [...blocks, { component: "table", query: list, params, title: list === "clients_list" ? "Clients in this report" : list === "spocs_list" ? "SPOCs in this report" : "People in this report", width: "full" }] };
};

// ── storage ──────────────────────────────────────────────────────────────────

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}{}_ ]/gu, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const TURN_SELECT = { id: true, seq: true, input: true, kind: true, message: true, options: true, tier: true, createdAt: true } as const;
const THREAD_SELECT = { id: true, title: true, page: true, pinned: true, createdAt: true, updatedAt: true } as const;

const ownThread = (user: AuthUser, id: string) => prisma.aiThread.findFirst({ where: { id, userId: user.id, archivedAt: null } });

const addTurn = async (threadId: string, data: { input: string; kind: string; message?: string | null | undefined; options?: string[] | undefined; spec?: ValidSpec | undefined; tier: string }) => {
  const last = await prisma.aiTurn.findFirst({ where: { threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
  return prisma.aiTurn.create({
    data: {
      threadId,
      seq: (last?.seq ?? 0) + 1,
      input: data.input,
      kind: data.kind,
      message: data.message ?? null,
      tier: data.tier,
      ...(data.options?.length && { options: data.options }),
      ...(data.spec && { spec: data.spec as unknown as Prisma.InputJsonValue }),
    },
    select: TURN_SELECT,
  });
};

export type TurnKind = "canvas" | "clarify" | "rejected" | "error" | "explain" | "edit" | "new" | "action";

export interface ThreadReply {
  kind: TurnKind;
  /** null when nothing was saved (a rejected / failed first message, or "new chat") */
  thread: { id: string; title: string; page: string | null; pinned: boolean; createdAt: Date; updatedAt: Date } | null;
  turn: { id: string; seq: number; input: string; kind: string; message: string | null; options: unknown; tier: string; createdAt: Date } | null;
  message: string | null;
  options?: string[];
  canvas?: { spec: ValidSpec; blocks: RenderedBlock[] };
  matched?: { label: string; kind: string }[];
  /** the request was a new topic, so it went to a new thread (the old one is kept) */
  startedNew?: boolean;
  /** answered from memory / locally — no AI call, no cost */
  free: boolean;
}

/** the stored spec, re-checked against today's registry and permissions */
const storedSpec = (raw: unknown, perms: PermissionMap): ValidSpec | null => {
  if (!raw) return null;
  try {
    return validateSpec(raw, perms);
  } catch {
    return null;
  }
};

// ── ask ──────────────────────────────────────────────────────────────────────

export const askThread = async (
  user: AuthUser,
  perms: PermissionMap,
  body: { threadId?: string; prompt: string; page?: string; learnFrom?: string | undefined },
): Promise<ThreadReply> => {
  const startedAt = Date.now();
  const prompt = body.prompt.trim();
  let tier: AiTier = "none";
  let outcome: AiOutcome = "error";
  let usage: TokenUsage | null = null;
  let model: string | null = null;
  let params: unknown = null;
  let counts = false;
  let action = "thread_ask";

  let thread = body.threadId ? await ownThread(user, body.threadId) : null;
  const ensureThread = async () =>
    (thread ??= await prisma.aiThread.create({ data: { tenantId: tenantIdOrThrow(), userId: user.id, title: clip(prompt, 70), page: body.page?.slice(0, 200) ?? null } }));
  const pub = () => (thread ? { id: thread.id, title: thread.title, page: thread.page, pinned: thread.pinned, createdAt: thread.createdAt, updatedAt: thread.updatedAt } : null);

  const done = async (r: Omit<ThreadReply, "thread" | "free"> & { save?: boolean; turnTier: string; spec?: ValidSpec }): Promise<ThreadReply> => {
    const { save = true, turnTier, spec, ...reply } = r;
    let turn: ThreadReply["turn"] = null;
    if (save && r.kind !== "new") {
      const t = await ensureThread();
      turn = await addTurn(t.id, { input: prompt, kind: r.kind, message: r.message, options: r.options, spec, tier: turnTier });
      thread = await prisma.aiThread.update({
        where: { id: t.id },
        data: spec ? { spec: spec as unknown as Prisma.InputJsonValue, ...(t.spec ? {} : { title: clip(spec.title, 70) }) } : { updatedAt: new Date() },
      });
    }
    await logAi({ user, mode: "CANVAS", usageMode: "CANVAS", input: prompt, tier, outcome, action, params, countsToQuota: counts, model, usage, startedAt });
    if (usage) void checkBudgetAlerts();
    return { ...reply, thread: pub(), turn, free: turnTier !== "llm" };
  };

  try {
    // 1. "new chat" — free
    if (isNewThreadRequest(prompt)) {
      tier = "local";
      outcome = "success";
      action = "thread_new";
      thread = null;
      return done({ kind: "new", message: "New canvas — the previous one is saved in your history. What would you like to see?", turn: null, turnTier: "local", save: false });
    }

    const current = storedSpec(thread?.spec, perms);

    // 2. "explain this" — free: the server reads the live numbers, no LLM
    if (isExplainRequest(prompt)) {
      tier = "local";
      action = "thread_explain";
      if (!current) {
        outcome = "invalid";
        return done({ kind: "clarify", message: "There is no report open yet. Ask for one first — for example “clients by industry” — then I can explain it.", turn: null, turnTier: "local", save: !!thread });
      }
      const blocks = await runSpec(user, perms, current, AI_DEFAULTS.canvasTableRows);
      outcome = "success";
      return done({ kind: "explain", message: explainCanvas(current, blocks), canvas: { spec: current, blocks }, turn: null, turnTier: "local" });
    }

    // 3. mask + guard
    const ex = await extractEntities(prompt);
    // a conversation about a report: "remove the chart", "replace it with users" edit the report, never data
    const guard = checkDestructiveIntent(ex.masked, { canvas: true });
    if (!guard.ok) {
      tier = "guard";
      outcome = "rejected_destructive";
      return done({ kind: "rejected", message: `${READ_ONLY_MESSAGE} I can build and explain reports and open pages for you.`, turn: null, turnTier: "local", save: !!thread });
    }

    const catalog = catalogFor(perms);
    if (!catalog) {
      outcome = "rejected_permission";
      return done({ kind: "error", message: "You don't have access to any report data.", turn: null, turnTier: "local", save: false });
    }

    // 4. memory: same masked request on the same canvas shape → same answer, free
    const base = current ? tokeniseSpec(current) : null;
    const free = !!user.isSuperAdmin;
    // a super admin's answers (they may be free queries) are remembered apart from everyone else's
    const key = sha([norm(ex.masked), base ? JSON.stringify(base.template) : "", sha(catalog), free ? "sa" : ""].join("|"));
    const tenantId = tenantIdOrThrow();
    const remembered = await prisma.aiAnswerMemory.findUnique({ where: { tenantId_key: { tenantId, key } } });

    let answer: { tool: string; input: unknown };
    let fromMemory = false;
    let llmUser = "";
    if (remembered) {
      answer = { tool: remembered.tool, input: remembered.answer };
      fromMemory = true;
      tier = "template";
    } else {
      if ((await budgetState()).exhausted) {
        outcome = "budget_exhausted";
        return done({ kind: "error", message: `${BASIC_MODE_MESSAGE} Your saved canvases and anything I have answered before still work.`, turn: null, turnTier: "local", save: false });
      }
      if (!llmConfigured()) return done({ kind: "error", message: "The AI isn't set up yet (no API key).", turn: null, turnTier: "local", save: false });

      // last few exchanges, masked, numbering removed (old placeholders are not valid any more)
      const history = thread
        ? await prisma.aiTurn.findMany({ where: { threadId: thread.id }, orderBy: { seq: "desc" }, take: 5, select: { input: true, kind: true, message: true } })
        : [];
      const lines: string[] = [];
      for (const h of history.reverse()) {
        const m = (await extractEntities(h.input)).masked.replace(/\{([a-z_:A-Z]+)_\d+\}/g, "<$1>");
        const said = h.kind === "explain" ? "(explained the canvas)" : h.kind === "edit" ? "(the user edited the layout by hand)" : clip(h.message ?? h.kind, 200);
        lines.push(`- user: ${clip(m, 200)}\n  assistant [${h.kind}]: ${said}`);
      }
      tier = "llm";
      try {
        llmUser = [
            base ? `Current canvas:\n${JSON.stringify(base.template)}` : "Current canvas: none",
            lines.length ? `Conversation so far:\n${lines.join("\n")}` : "",
            body.page && /^\/[a-z0-9\-/]*$/i.test(body.page) ? `The user is on the CRM page: ${body.page.split("/").slice(0, 2).join("/")}` : "",
            `New request: ${ex.masked}`,
            `Placeholders: ${JSON.stringify(entityHints(ex.entities))}`,
            `Today: ${new Date().toISOString().slice(0, 10)}`,
          ]
            .filter(Boolean)
            .join("\n\n");
        const res = await llm().call({ system: SYSTEM(catalog) + (free ? FREE_SYSTEM() : ""), user: llmUser, tools: [COMPOSE_TOOL, CLARIFY_TOOL, REJECT_TOOL, ...(free ? [FREE_TOOL] : [])] });
        usage = res.usage;
        model = res.model;
        answer = { tool: res.tool, input: res.input };
      } catch (e) {
        if (e instanceof LlmError) {
          usage = e.usage ?? null;
          model = e.model ?? null;
          if (e.code === "refused") {
            outcome = "rejected_destructive";
            return done({ kind: "rejected", message: READ_ONLY_MESSAGE, turn: null, turnTier: "llm", save: !!thread });
          }
          return done({ kind: "error", message: "The AI didn't answer in time. Please try again.", turn: null, turnTier: "llm", save: false });
        }
        throw e;
      }
    }
    params = answer.input;
    const turnTier = fromMemory ? "memory" : "llm";
    const remember = async () => {
      if (fromMemory) {
        await prisma.aiAnswerMemory.update({ where: { id: remembered!.id }, data: { hits: { increment: 1 }, lastUsedAt: new Date() } });
      } else {
        await prisma.aiAnswerMemory
          .create({ data: { tenantId, key, masked: clip(ex.masked, 500), tool: answer.tool, answer: answer.input as Prisma.InputJsonValue } })
          .catch(() => undefined); // two identical requests at once
      }
    };

    if (answer.tool === "reject_request") {
      outcome = "rejected_destructive";
      return done({ kind: "rejected", message: `${READ_ONLY_MESSAGE} I can build and explain reports and open pages for you.`, turn: null, turnTier, save: !!thread });
    }

    if (answer.tool === "ask_clarification") {
      const q = clarifySchema.safeParse(answer.input);
      if (!q.success) {
        outcome = "invalid";
        return done({ kind: "error", message: "Try describing the report differently.", turn: null, turnTier, save: false });
      }
      outcome = "success";
      counts = !fromMemory;
      await remember();
      return done({ kind: "clarify", message: unmaskText(tidyQuestion(q.data.question), ex), options: (q.data.options ?? []).map((o) => unmaskText(o, ex)), turn: null, turnTier });
    }

    // free hand: the super admin's own query, as one block (added to the canvas, or a new one)
    if (answer.tool === "free_query" && free) {
      const f = (answer.input ?? {}) as { relation?: string; summary?: string; title?: string; sql?: string; chart?: string; label_column?: string; value_columns?: string[]; format?: string };
      let bound;
      try {
        bound = bindPlaceholders(checkSql(String(f.sql ?? "")), ex);
      } catch (e) {
        outcome = "invalid";
        return done({ kind: "error", message: `I couldn't write a safe query for that (${(e as Error).message}). Try saying it another way.`, turn: null, turnTier, save: !!thread });
      }
      const chart = (["table", "bar", "line", "pie", "kpi"].includes(String(f.chart)) ? f.chart : "table") as "table" | "bar" | "line" | "pie" | "kpi";
      const block = {
        component: chart,
        query: "free_sql",
        title: unmaskText(String(f.title ?? "Custom query").slice(0, 120), ex),
        width: chart === "kpi" ? "third" : "full",
        params: {
          sql: bound.sql,
          args: bound.args,
          shape: chart === "table" ? "rows" : chart === "kpi" ? "single" : "series",
          ...(f.label_column && { label: f.label_column }),
          ...(f.value_columns?.length && { values: f.value_columns }),
          ...(f.format && { format: f.format }),
        },
      };
      const keepCanvas = current && f.relation === "follow_up";
      let spec: ValidSpec;
      try {
        spec = validateSpec(
          { title: keepCanvas ? current!.title : unmaskText(String(f.title ?? "Custom query"), ex), blocks: [...(keepCanvas ? current!.blocks : []), block] },
          perms,
          { allow: ["free_sql"] },
        );
      } catch (e) {
        outcome = "invalid";
        return done({ kind: "error", message: `I couldn't build that (${(e as Error).message}).`, turn: null, turnTier, save: !!thread });
      }
      const blocks = await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows);
      const failed = blocks.find((b) => b.query === "free_sql" && b.error);
      if (failed) {
        outcome = "error";
        if (fromMemory) await prisma.aiAnswerMemory.delete({ where: { id: remembered!.id } }).catch(() => undefined);
        return done({ kind: "error", message: `The query didn't run: ${failed.error} Try saying it another way.`, turn: null, turnTier, save: !!thread });
      }
      outcome = "success";
      counts = !fromMemory;
      params = spec;
      await remember();
      const startedNewFree = !!current && !keepCanvas;
      if (startedNewFree) thread = null;
      return done({
        kind: "canvas",
        message: `${unmaskText(String(f.summary ?? "Here is your custom query."), ex)} (custom query — super admin)`,
        canvas: { spec, blocks },
        matched: ex.entities.map((e) => ({ label: e.label, kind: e.kind })),
        startedNew: startedNewFree,
        turn: null,
        turnTier,
        spec,
      });
    }

    if (answer.tool !== "compose_canvas") {
      outcome = "invalid";
      return done({ kind: "error", message: "Try describing the report differently.", turn: null, turnTier, save: false });
    }

    const meta = composeMeta.safeParse(answer.input);
    const relation = meta.success ? meta.data.relation : undefined;
    const summary = meta.success && meta.data.summary ? unmaskText(meta.data.summary, ex) : undefined;
    let spec: ValidSpec;
    const build = (input: unknown) => {
      const { relation: _r, summary: _s, ...rest } = (input ?? {}) as Record<string, unknown>;
      return validateSpec(withDetailTable(restoreKeep(rest, base?.keep ?? {})), perms, { ex, llmOnly: true, ...(free && { allow: ["free_sql"] }) });
    };
    try {
      try {
        spec = build(answer.input);
      } catch (first) {
        // the model slipped (wrong shape / unknown query): ask once more, telling it what was wrong
        if (fromMemory || !llmUser) throw first;
        const again = await llm().call({
          system: SYSTEM(catalog),
          user: `${llmUser}\n\nYour previous answer was invalid: ${(first as Error).message}. Call compose_canvas again with "blocks" as an ARRAY of block objects, using only catalog queries and params.`,
          tools: [COMPOSE_TOOL, CLARIFY_TOOL, REJECT_TOOL],
        });
        if (again.tool !== "compose_canvas") throw first;
        answer = { tool: again.tool, input: again.input };
        params = again.input;
        spec = build(again.input);
      }
    } catch (e) {
      outcome = "invalid";
      // a remembered answer that no longer fits (catalog changed) is forgotten
      if (fromMemory) await prisma.aiAnswerMemory.delete({ where: { id: remembered!.id } }).catch(() => undefined);
      return done({ kind: "error", message: `I couldn't build that (${(e as Error).message}). Try saying it another way.`, turn: null, turnTier, save: !!thread });
    }

    // a follow-up that says it changed something but left the canvas exactly as it was
    const sameAsBefore = !!current && relation !== "new_topic" && JSON.stringify(tokeniseSpec(spec).template) === JSON.stringify(base!.template);
    if (sameAsBefore) {
      // asked for something the canvas already shows ("add a column of who it's assigned to")?
      const shown = await runSpec(user, perms, spec, 1);
      const words = norm(prompt).split(" ").filter((w) => w.length >= 4);
      const cols = shown.flatMap((b) => (b.result?.kind === "rows" ? b.result.columns.map((c) => ({ col: c.label, block: b.title })) : []));
      const there = cols.find((c) => norm(c.col).split(" ").some((w) => w.length >= 4 && words.some((x) => x.startsWith(w.slice(0, 5)))));
      if (there) {
        outcome = "success";
        return done({ kind: "clarify", message: `That's already on the canvas — the “${there.col}” column in “${there.block}”.`, turn: null, turnTier });
      }
      outcome = "invalid";
      if (fromMemory) await prisma.aiAnswerMemory.delete({ where: { id: remembered!.id } }).catch(() => undefined);
      return done({
        kind: "clarify",
        message: "I couldn't make that change with the reports I have — nothing on the canvas changed. Do you mean one of these?",
        options: ["Add clients assigned per person", "Add SPOCs handled per person", "Show it as a table", "Start a new canvas"],
        turn: null,
        turnTier,
      });
    }

    const blocks = await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows);
    outcome = "success";
    counts = !fromMemory;
    params = spec;
    await remember();
    // learned: the words that made me ask a question now lead straight here next time
    if (body.learnFrom && body.learnFrom.trim() && body.learnFrom.trim() !== prompt) {
      const original = await extractEntities(body.learnFrom.trim());
      const learnKey = sha([norm(original.masked), base ? JSON.stringify(base.template) : "", sha(catalog)].join("|"));
      await prisma.aiAnswerMemory
        .upsert({
          where: { tenantId_key: { tenantId, key: learnKey } },
          create: { tenantId, key: learnKey, masked: clip(original.masked, 500), tool: answer.tool, answer: answer.input as Prisma.InputJsonValue },
          update: { tool: answer.tool, answer: answer.input as Prisma.InputJsonValue, lastUsedAt: new Date() },
        })
        .catch(() => undefined);
    }

    // a new topic gets its own thread; the old one stays saved
    let startedNew = false;
    if (current && relation === "new_topic") {
      thread = null;
      startedNew = true;
    }
    // say it plainly when nothing matches, instead of empty boxes
    const empty = blocks.every((b) => !b.result || (b.result.kind === "rows" && b.result.total === 0) || (b.result.kind === "series" && !b.result.points.length) || (b.result.kind === "single" && !b.result.value));
    const who = ex.entities.filter((e) => e.kind === "user").map((e) => e.label);
    const emptyNote = empty ? ` Nothing matches right now${who.length ? ` — ${who.join(" and ")} ${who.length > 1 ? "have" : "has"} none of these personally (their team may; try “… of ${who[0]}'s team”)` : " — try fewer filters"}.` : "";
    return done({
      kind: "canvas",
      message: (summary ?? (current && !startedNew ? "Updated the canvas." : "Here is your report.")) + emptyNote,
      canvas: { spec, blocks },
      matched: ex.entities.map((e) => ({ label: e.label, kind: e.kind })),
      startedNew,
      turn: null,
      turnTier,
      spec,
    });
  } catch (e) {
    outcome = "error";
    return done({ kind: "error", message: "Something went wrong. Please try again.", turn: null, turnTier: "local", save: false });
  }
};

// ── list / open / edit ───────────────────────────────────────────────────────

export const listThreads = async (user: AuthUser, search?: string) =>
  prisma.aiThread.findMany({
    where: { userId: user.id, archivedAt: null, spec: { not: Prisma.DbNull }, ...(search && { title: { contains: search, mode: "insensitive" } }) },
    select: { ...THREAD_SELECT, _count: { select: { turns: true } } },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });

/** a thread with its conversation and its canvas re-read live */
export const openThread = async (user: AuthUser, perms: PermissionMap, id: string) => {
  const thread = await prisma.aiThread.findFirst({
    where: { id, userId: user.id, archivedAt: null },
    select: { ...THREAD_SELECT, spec: true, turns: { select: TURN_SELECT, orderBy: { seq: "asc" } } },
  });
  if (!thread) return null;
  const spec = storedSpec(thread.spec, perms);
  const blocks = spec ? await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows) : null;
  const { spec: _raw, ...rest } = thread;
  return { ...rest, canvas: spec && blocks ? { spec, blocks } : null, stale: !!thread.spec && !spec };
};

/** the user changed the design by hand (chart type, size, order, title, removed a block) — no LLM */
export const editThreadSpec = async (user: AuthUser, perms: PermissionMap, id: string, raw: unknown, note: string) => {
  const thread = await ownThread(user, id);
  if (!thread) return null;
  const spec = validateSpec(raw, perms);
  const blocks = await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows);
  const turn = await addTurn(id, { input: clip(note, 300), kind: "edit", message: null, spec, tier: "local" });
  await prisma.aiThread.update({ where: { id }, data: { spec: spec as unknown as Prisma.InputJsonValue } });
  return { turn, canvas: { spec, blocks } };
};

/** open a saved template (or any valid spec) as a thread, so follow-ups work on it */
export const threadFromSpec = async (user: AuthUser, perms: PermissionMap, raw: unknown, title?: string) => {
  const spec = validateSpec(raw, perms);
  const blocks = await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows);
  const thread = await prisma.aiThread.create({
    data: { tenantId: tenantIdOrThrow(), userId: user.id, title: clip(title ?? spec.title, 70), spec: spec as unknown as Prisma.InputJsonValue },
    select: THREAD_SELECT,
  });
  await addTurn(thread.id, { input: `Opened “${clip(title ?? spec.title, 100)}”`, kind: "edit", spec, tier: "local" });
  return { thread, canvas: { spec, blocks } };
};

export const patchThread = async (user: AuthUser, id: string, data: { title?: string; pinned?: boolean }) => {
  const { count } = await prisma.aiThread.updateMany({ where: { id, userId: user.id, archivedAt: null }, data });
  return count > 0;
};

export const archiveThread = async (user: AuthUser, id: string) => {
  const { count } = await prisma.aiThread.updateMany({ where: { id, userId: user.id, archivedAt: null }, data: { archivedAt: new Date() } });
  return count > 0;
};

/**
 * A ready-made report (no LLM): "generate report" on a page. Starts a new
 * thread whose first step is this canvas, so follow-ups work on it as usual.
 */
export const startPresetThread = async (
  user: AuthUser,
  perms: PermissionMap,
  input: { prompt: string; page: string; title: string; message: string; blocks: { component: string; query: string; params?: Record<string, unknown>; title: string; width?: string }[] },
): Promise<ThreadReply | null> => {
  // only the parts this user may see
  const blocks = input.blocks.filter((b) => {
    const def = queryDef(b.query);
    return !!def && !!perms[def.permission];
  });
  if (!blocks.length) return null;
  const spec = validateSpec(withDetailTable({ title: input.title, blocks }), perms);
  const rendered = await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows);
  const thread = await prisma.aiThread.create({
    data: { tenantId: tenantIdOrThrow(), userId: user.id, title: clip(spec.title, 70), page: input.page.slice(0, 200), spec: spec as unknown as Prisma.InputJsonValue },
  });
  const turn = await addTurn(thread.id, { input: input.prompt, kind: "canvas", message: input.message, spec, tier: "local" });
  return {
    kind: "canvas",
    thread: { id: thread.id, title: thread.title, page: thread.page, pinned: thread.pinned, createdAt: thread.createdAt, updatedAt: thread.updatedAt },
    turn,
    message: input.message,
    canvas: { spec, blocks: rendered },
    free: true,
  };
};

// ── one-click questions ──────────────────────────────────────────────────────

const STARTERS: Record<string, string[]> = {
  "/clients": ["Explain this", "Generate a detailed report", "Clients by industry", "Clients assigned to me", "Clients with no SPOC", "Top 10 clients by CSR spent", "Clients added per month"],
  "/spocs": ["Explain this", "Generate a detailed report", "SPOCs by sales status", "SPOCs handled by my team", "SPOCs per handler", "SPOCs waiting for approval"],
  "/dashboard": ["Explain this", "Generate a detailed report", "Workload of my team", "Clients assigned to me", "CSR spent by financial year", "People by role"],
  "/admin": ["People by role", "Workload of everyone", "Clients assigned per person", "People in my team"],
  "/pipeline-runs": ["Pipeline runs per day last 30 days", "Pipeline runs by status", "Pipeline runs by step"],
  "": ["Explain this", "Generate a detailed report", "Workload of my team", "Clients by industry", "SPOCs by sales status", "CSR spent by financial year"],
};

/** your most-used and latest requests (top 5) + good ones for this page */
export const suggestionsFor = async (user: AuthUser, page: string) => {
  const area = `/${page.split("/")[1] ?? ""}`;
  const rows = await prisma.aiTurn.findMany({
    where: { thread: { userId: user.id }, kind: { in: ["canvas", "explain"] }, tier: { not: "local" } },
    select: { input: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const local = await prisma.aiTurn.findMany({
    where: { thread: { userId: user.id }, kind: { in: ["canvas", "explain"] }, tier: "local", NOT: { input: { startsWith: "Opened" } } },
    select: { input: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const tally = new Map<string, { text: string; uses: number; last: number }>();
  for (const r of [...rows, ...local]) {
    const k = norm(r.input);
    if (!k || k.length < 4) continue;
    const t = tally.get(k) ?? { text: r.input.trim(), uses: 0, last: 0 };
    t.uses++;
    t.last = Math.max(t.last, r.createdAt.getTime());
    tally.set(k, t);
  }
  // most used first, recent breaks ties; then the latest ones not already in
  const byUse = [...tally.values()].sort((a, b) => b.uses - a.uses || b.last - a.last);
  const mine = byUse.slice(0, 5).map((t) => ({ text: t.text, uses: t.uses }));
  const starters = (STARTERS[area] ?? STARTERS[""]!).filter((t) => !tally.has(norm(t)));
  return { mine, starters };
};
