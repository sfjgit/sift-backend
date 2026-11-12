// File: command.service.ts
// Path: src/services/ai/command.service.ts
//
// COMMAND mode resolver (spec §3, §6). Called after G1 (mode + permission),
// G2 (input limits, rate) and G2.5 (quota) in the route middleware.
//
//   T1  entity extraction + masking        entities.service
//   G3  destructive intent guard           aiGuardrails (masked text, no LLM, ₹0)
//   T2  template lookup                    CommandTemplate (hit → no LLM, ₹0)
//   T3  LLM (read tools + controls only)   llm.service — skipped at 100% budget
//   G4  output validation                  zod, action in the READ registry, role-filtered
//   G5  scope enforcement                  server forces / rejects people, BUs, records
//   →   URL the frontend opens             (pages call the normal scoped APIs)
//   G7  audit + cost                       audit.service
//
// Nothing here writes business data. The only writes are CommandTemplate
// (learning) and AiAuditLog — AI-owned tables.

import { z } from "zod";
import prisma from "@/utils/prisma/client";
import type { PermissionScope } from "@prisma/client";
import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import { aiDb } from "@/config/aiDb";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { checkDestructiveIntent, normaliseInput, READ_ONLY_MESSAGE } from "@/config/aiGuardrails";
import { COMMAND_ACTIONS, commandAction, type CommandAction, type FilterSpec } from "@/config/commandRegistry";
import { entityHints, extractEntities, type Entity, type Extraction } from "@/services/ai/entities.service";
import { CLARIFY_TOOL, LlmError, llm, REJECT_TOOL, type LlmTool } from "@/services/ai/llm.service";
import { logAi, type AiOutcome, type AiTier } from "@/services/ai/audit.service";
import { BASIC_MODE_MESSAGE, budgetState, checkBudgetAlerts, type TokenUsage } from "@/services/ai/cost.service";
import { llmConfigured } from "@/services/ai/settings.service";
import { clientScopeWhere, resolveScopeUserIds } from "@/services/scope.service";

export type CommandResult =
  | { type: "navigate"; url: string; summary: string; spoken: string; matched: { label: string; kind: string }[]; note?: string | undefined }
  | { type: "search"; q: string; message?: string | undefined }
  | { type: "clarify"; message: string }
  | { type: "rejected"; message: string; suggestion?: { label: string; url: string } | undefined }
  | { type: "error"; message: string };

interface Ctx {
  user: AuthUser;
  perms: PermissionMap;
  input: string;
  startedAt: number;
}

/** actions this user may use (role-filtered catalog) */
export const allowedActions = (perms: PermissionMap) =>
  COMMAND_ACTIONS.filter((a) => a.permission === null || Boolean(perms[a.permission]));

// ── template key: masked text, normalised, politeness removed ────────────────

const FILLER = /\b(please|pls|plz|kindly|can you|could you|would you|for me|quickly|now|just|the|a|an)\b/g;
export const templateKey = (masked: string) =>
  normaliseInput(masked)
    .replace(/[.,!?;:"']/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();

// ── tools for the LLM (one per allowed action) ───────────────────────────────

const filterSchema = (f: FilterSpec): Record<string, unknown> => {
  switch (f.type) {
    case "enum":
      return { type: "string", description: `${f.label}. One of: ${f.values.join(", ")}${f.multi ? " (several: comma-separated)" : ""}` };
    case "entity":
      return { type: "string", description: `${f.label}: a {placeholder} of kind ${f.kind.replace("lookup:", "pick-list ")}${f.multi ? " (several: comma-separated)" : ""}` };
    case "user":
      return { type: "string", description: `${f.label}: "me", or {user_N} placeholder(s), comma-separated` };
    case "date_range":
      return { type: "string", description: `${f.label}: a {date_range_N} placeholder` };
    case "boolean":
      return { type: "boolean", description: f.label };
    case "number":
      return { type: "number", description: f.label };
    case "text":
      return { type: "string", description: `${f.label} (as the user wrote it)` };
  }
};

const toolFor = (a: CommandAction): LlmTool => {
  const properties: Record<string, unknown> = {};
  if (a.filters) {
    properties.filters = {
      type: "object",
      properties: Object.fromEntries(Object.entries(a.filters).map(([k, f]) => [k, filterSchema(f)])),
      additionalProperties: false,
    };
  }
  if (a.sorts) {
    properties.sort = {
      type: "string",
      description: `Sort the list. One of: ${Object.keys(a.sorts).map((k) => `${k} / -${k}`).join(", ")} ("-" = highest / newest first)`,
    };
  }
  if (a.search) properties.q = { type: "string", description: "Free-text search, only words the user wants searched (not filters)" };
  if (a.record) properties[a.record.param] = { type: "string", description: `The {${a.record.kind}_N} placeholder` };
  return {
    name: a.name,
    description: a.description,
    input_schema: { type: "object", properties, required: a.record ? [a.record.param] : [], additionalProperties: false },
  };
};

const SEARCH_TOOL: LlmTool = {
  name: "search",
  description: "Fallback: search clients, SPOCs and people by name when no page/filter fits.",
  input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false },
};

const SYSTEM = `You are the navigation assistant of a sales & marketing CRM. You are READ-ONLY.
You turn a user's request into exactly ONE tool call that opens a page of the CRM with filters.
Rules:
- You can only open pages and apply filters. If the request asks to create, change, delete, assign, send, approve, import, run or otherwise modify anything, call reject_request.
- The request has its names masked as {placeholders} (e.g. {industry_1}, {user_1}, {client_1}, {date_range_1}). Use the placeholders exactly as given as filter values; never invent ids or names.
- "my" / "mine" / "assigned to me" means the user themself: use "me" where a filter accepts it.
- Use filters for anything the filters can express; use q only for remaining words to search.
- Questions about numbers, counts, totals, "top N", rankings, trends, comparisons or figures by FY go to open_canvas when it is offered; otherwise open the closest list, sorted when a sort fits.
- If nothing fits, call search with the main words; if it is unclear, call ask_clarification.`;

// ── G4 + G5: validate an action call, put entities back, check scope, build URL ──

class Invalid extends Error {}
class OutOfScope extends Error {}

const PH = /^\{([a-z_]+)_(\d+)\}$/;
const splitList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

const findEntity = (ex: Extraction, ph: string) => {
  const e = ex.entities.find((x) => x.ph === ph);
  if (!e) throw new Invalid(`unknown placeholder ${ph}`);
  return e;
};

interface Built {
  url: string;
  summary: string;
  spoken: string;
  matched: Entity[];
  note?: string | undefined;
  learnable: boolean;
}

const callSchema = (a: CommandAction) =>
  z
    .object({
      filters: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
      q: z.string().max(120).optional(),
      client: z.string().max(40).optional(),
      sort: z.string().max(40).optional(),
    })
    .strict()
    .superRefine((v, c) => {
      for (const k of Object.keys(v.filters ?? {})) if (!a.filters?.[k]) c.addIssue({ code: "custom", message: `unknown filter ${k}` });
      if (v.q !== undefined && !a.search) c.addIssue({ code: "custom", message: "q not allowed" });
      if (v.client !== undefined && !a.record) c.addIssue({ code: "custom", message: "client not allowed" });
      if (a.record && !v.client) c.addIssue({ code: "custom", message: "client required" });
      if (v.sort !== undefined && !a.sorts?.[v.sort.replace(/^-/, "")]) c.addIssue({ code: "custom", message: "bad sort" });
    });

const scopeOf = (perms: PermissionMap, a: CommandAction): PermissionScope | null => {
  if (!a.permission) return null;
  const g = perms[a.permission];
  return g && g !== true ? g : null; // null = unscoped or ALL
};

const clientVisible = async (user: AuthUser, perms: PermissionMap, clientId: string) => {
  const g = perms["clients.read"];
  if (!g) return false;
  const where = g === true ? {} : await clientScopeWhere(user, g);
  return (await aiDb().client.count({ where: { AND: [{ id: clientId, deletedAt: null }, where] } })) > 0;
};

const buildCall = async (ctx: Ctx, a: CommandAction, rawParams: unknown, ex: Extraction): Promise<Built> => {
  const parsed = callSchema(a).safeParse(rawParams ?? {});
  if (!parsed.success) throw new Invalid(parsed.error.issues.map((i) => i.message).join("; "));
  const p = parsed.data;
  const sp = new URLSearchParams();
  const matched: Entity[] = [];
  let learnable = !p.q;
  let note: string | undefined;
  const scope = scopeOf(ctx.perms, a);
  const scopeIds = scope && scope !== "ALL" ? await resolveScopeUserIds(ctx.user, scope) : null;

  // one record (open_client)
  if (a.record) {
    const e = findEntity(ex, p.client!);
    if (e.kind !== a.record.kind || !e.value) throw new Invalid("not a client");
    if (!(await clientVisible(ctx.user, ctx.perms, e.value))) throw new OutOfScope("client");
    return { url: a.record.path(e.value), summary: `Opening ${e.label}`, spoken: `Here is ${e.label}. Please check it out.`, matched: [e], learnable: true };
  }

  const said: string[] = [];
  const human = (v: string) => (v === "me" ? "you" : v === "none" ? "nobody" : v.toLowerCase().replace(/_/g, " "));
  for (const [key, raw] of Object.entries(p.filters ?? {})) {
    const f = a.filters![key]!;
    const str = String(raw);
    const label = f.label.split(/[:(]/)[0]!.trim().toLowerCase();
    switch (f.type) {
      case "enum": {
        const vals = (f.multi ? splitList(str) : [str]).map((v) => f.values.find((x) => x.toLowerCase() === v.toLowerCase()));
        if (!vals.length || vals.some((v) => !v)) throw new Invalid(`bad value for ${key}`);
        sp.set(key, vals.join(","));
        said.push(`${label} ${vals.map((v) => human(v!)).join(" or ")}`);
        break;
      }
      case "entity": {
        const list = f.multi ? splitList(str) : [str];
        const ents = list.map((ph) => {
          if (!PH.test(ph)) throw new Invalid(`${key} must be a placeholder`);
          const e = findEntity(ex, ph);
          if (e.kind !== f.kind || !e.value) throw new Invalid(`${ph} is not a ${f.kind}`);
          return e;
        });
        if (f.kind === "client") for (const e of ents) if (!(await clientVisible(ctx.user, ctx.perms, e.value!))) throw new OutOfScope("client");
        // BU outside the user's BUs under a BU-scoped grant (spec §4 L5)
        if (f.kind === "business_unit" && scope === "BU") {
          const mine = new Set((await prisma.userBusinessUnit.findMany({ where: { userId: ctx.user.id }, select: { businessUnitId: true } })).map((b) => b.businessUnitId));
          if (ents.some((e) => !mine.has(e.value!))) throw new OutOfScope("business unit");
        }
        matched.push(...ents);
        sp.set(key, ents.map((e) => e.value).join(","));
        said.push(`${label} ${ents.map((e) => e.label).join(" or ")}`);
        break;
      }
      case "user": {
        const list = splitList(str);
        let ids = list.map((v) => {
          if (v.toLowerCase() === "me") return ctx.user.id;
          if (!PH.test(v)) throw new Invalid(`${key} must be "me" or a placeholder`);
          const e = findEntity(ex, v);
          if (e.kind !== "user" || !e.value) throw new Invalid(`${v} is not a person`);
          matched.push(e);
          return e.value;
        });
        // G5: the server decides whose records — OWN is forced back to the user
        if (scope === "OWN" && ids.some((id) => id !== ctx.user.id)) {
          ids = [ctx.user.id];
          note = "You can only see your own records, so this shows yours.";
        } else if (scopeIds && ids.some((id) => !scopeIds.includes(id))) {
          throw new OutOfScope("person");
        }
        sp.set(key, [...new Set(ids)].join(","));
        said.push(`${label} ${ids.every((id) => id === ctx.user.id) ? "you" : matched.filter((m) => m.kind === "user").map((m) => m.label).join(" or ")}`);
        break;
      }
      case "date_range": {
        const e = findEntity(ex, str.trim());
        if (e.kind !== "date_range" || !e.from || !e.to) throw new Invalid(`${key} needs a date range`);
        matched.push(e);
        sp.set(f.from, e.from);
        sp.set(f.to, e.to);
        said.push(`${label} ${e.label}`);
        break;
      }
      case "boolean": {
        const b = typeof raw === "boolean" ? raw : str === "true" ? true : str === "false" ? false : null;
        if (b === null) throw new Invalid(`${key} must be true/false`);
        sp.set(key, String(b));
        said.push(b ? label : `not ${label}`);
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(str);
        if (!Number.isFinite(n) || n < 0) throw new Invalid(`${key} must be a number`);
        sp.set(key, String(n));
        said.push(`${label} ${n}`);
        break;
      }
      case "text": {
        if (str.length > 80 || PH.test(str)) throw new Invalid(`bad text for ${key}`);
        sp.set(key, str);
        said.push(`${label} ${str}`);
        learnable = false; // free text can't be reused for another request
        break;
      }
    }
  }
  if (p.q) sp.set("q", p.q);
  if (p.sort) sp.set("sort", p.sort);
  if (a.name === "open_canvas") {
    sp.set("prompt", ctx.input);
    learnable = true;
  }
  const qs = sp.toString();
  const filterCount = Object.keys(p.filters ?? {}).length;
  const sortSaid = p.sort ? `sorted by ${a.sorts![p.sort.replace(/^-/, "")]}${p.sort.startsWith("-") ? ", highest first" : ""}` : "";
  const parts = [said.length ? said.join(", ") : "", p.q ? `matching "${p.q}"` : "", sortSaid].filter(Boolean);
  const spoken =
    a.say && !parts.length
      ? a.say
      : `Here are the ${a.noun ?? "results"}${parts.length ? ` — ${parts.join(", ")}` : ""}. Please check them out.`;
  return {
    url: `${a.path}${qs ? `?${qs}` : ""}`,
    spoken: a.name === "open_canvas" ? (a.say ?? "Opening AI Canvas.") : spoken,
    summary: `${a.description.split(",")[0]!.replace(/\.$/, "")}${filterCount ? ` · ${filterCount} filter${filterCount > 1 ? "s" : ""}` : ""}${p.q ? ` · search "${p.q}"` : ""}`,
    matched,
    note,
    learnable,
  };
};

// ── read alternative for a rejected change request ───────────────────────────

const suggestFor = (input: string, perms: PermissionMap) => {
  const t = input.toLowerCase();
  const pick =
    /spoc|contact/.test(t) ? "open_spocs" : /client|compan|lead|account/.test(t) ? "open_clients" : /run|pipeline/.test(t) ? "open_pipeline_runs" : /user|people|employee/.test(t) ? "open_users" : null;
  const a = pick ? allowedActions(perms).find((x) => x.name === pick) : null;
  if (!a) return undefined;
  const mine = a.name === "open_clients" ? "?assignedTo=me" : "";
  const label = { open_spocs: "your SPOC list", open_clients: "your clients", open_pipeline_runs: "pipeline runs", open_users: "the users list" }[a.name]!;
  return { label: `Here's ${label} if you want to review it`, url: `${a.path}${mine}` };
};

// ── main ─────────────────────────────────────────────────────────────────────

export const resolveCommand = async (user: AuthUser, perms: PermissionMap, input: string): Promise<CommandResult> => {
  const ctx: Ctx = { user, perms, input, startedAt: Date.now() };
  let tier: AiTier = "none";
  let outcome: AiOutcome = "error";
  let action: string | null = null;
  let params: unknown = null;
  let template: string | null = null;
  let usage: TokenUsage | null = null;
  let model: string | null = null;
  let counts = false;

  const done = async (r: CommandResult) => {
    await logAi({ user, mode: "COMMAND", usageMode: "COMMAND", input, tier, outcome, template, action, params, countsToQuota: counts, model, usage, startedAt: ctx.startedAt });
    if (usage) void checkBudgetAlerts();
    return r;
  };

  try {
    // T1
    const ex = await extractEntities(input);
    template = templateKey(ex.masked);

    // G3 — on masked text, before anything costs money
    const guard = checkDestructiveIntent(ex.masked);
    if (!guard.ok) {
      tier = "guard";
      outcome = "rejected_destructive";
      return done({ type: "rejected", message: READ_ONLY_MESSAGE, suggestion: suggestFor(input, perms) });
    }

    const allowed = allowedActions(perms);
    let built: Built | null = null;
    const finish = async (a: CommandAction, raw: unknown): Promise<CommandResult> => {
      action = a.name;
      params = raw;
      const b = await buildCall(ctx, a, raw, ex);
      built = b;
      outcome = "success";
      counts = true;
      return done({ type: "navigate", url: b.url, summary: b.summary, spoken: b.spoken, matched: b.matched.map((e) => ({ label: e.label, kind: e.kind })), note: b.note });
    };

    // T2 — learned / seeded template
    const hit = await prisma.commandTemplate.findFirst({ where: { template, isActive: true } });
    if (hit) {
      const a = allowed.find((x) => x.name === hit.action);
      if (a) {
        try {
          tier = "template";
          const r = await finish(a, hit.paramMap);
          void prisma.commandTemplate.update({ where: { id: hit.id }, data: { hitCount: { increment: 1 } } }).catch(() => undefined);
          return r;
        } catch (e) {
          if (e instanceof OutOfScope) throw e;
          tier = "none"; // template didn't fit this time — fall through to the LLM
        }
      }
    }

    // budget / configuration: degrade, don't die
    const fallback = async (why: "budget" | "not_configured" | "llm_error", message?: string): Promise<CommandResult> => {
      tier = "fallback";
      outcome = why === "budget" ? "budget_exhausted" : why === "llm_error" ? "error" : "success";
      const client = ex.entities.find((e) => e.kind === "client");
      const open = allowed.find((a) => a.name === "open_client");
      if (client && open && ex.entities.length === 1) {
        try {
          action = "open_client";
          const b = await buildCall(ctx, open, { client: client.ph }, ex);
          return done({ type: "navigate", url: b.url, summary: b.summary, spoken: b.spoken, matched: [{ label: client.label, kind: "client" }], note: message });
        } catch {
          /* fall through to search */
        }
      }
      action = "search";
      return done({ type: "search", q: input, message });
    };

    if ((await budgetState()).exhausted) return fallback("budget", BASIC_MODE_MESSAGE);
    if (!llmConfigured()) return fallback("not_configured", "The AI isn't set up yet — searching instead.");

    // T3
    tier = "llm";
    const tools = [...allowed.map(toolFor), SEARCH_TOOL, CLARIFY_TOOL, REJECT_TOOL];
    const userMsg = `Request: ${ex.masked}\nPlaceholders: ${JSON.stringify(entityHints(ex.entities))}\nToday: ${new Date().toISOString().slice(0, 10)}`;
    let answer;
    try {
      answer = await llm().call({ system: SYSTEM, user: userMsg, tools });
    } catch (e) {
      if (e instanceof LlmError) {
        usage = e.usage ?? null;
        model = e.model ?? null;
        if (e.code === "refused") {
          outcome = "rejected_destructive";
          return done({ type: "rejected", message: READ_ONLY_MESSAGE, suggestion: suggestFor(input, perms) });
        }
        return fallback("llm_error", "The AI didn't answer in time — searching instead.");
      }
      throw e;
    }
    usage = answer.usage;
    model = answer.model;

    // G4 — the answer must be a known tool, allowed for this user
    if (answer.tool === "reject_request") {
      action = "reject_request";
      outcome = "rejected_destructive";
      return done({ type: "rejected", message: READ_ONLY_MESSAGE, suggestion: suggestFor(input, perms) });
    }
    if (answer.tool === "ask_clarification") {
      const qn = z.object({ question: z.string().min(1).max(300) }).strict().safeParse(answer.input);
      action = "ask_clarification";
      outcome = qn.success ? "success" : "invalid";
      counts = qn.success;
      return done(qn.success ? { type: "clarify", message: qn.data.question } : { type: "error", message: "Sorry, I didn't get that. Try rephrasing." });
    }
    if (answer.tool === "search") {
      const s = z.object({ q: z.string().min(1).max(120) }).strict().safeParse(answer.input);
      action = "search";
      outcome = s.success ? "success" : "invalid";
      counts = s.success;
      return done(s.success ? { type: "search", q: s.data.q } : { type: "error", message: "Sorry, I didn't get that. Try rephrasing." });
    }
    const a = allowed.find((x) => x.name === answer.tool);
    if (!a) {
      // not in the registry at all, or not for this role
      action = answer.tool;
      outcome = commandAction(answer.tool) ? "rejected_permission" : "invalid";
      return done({ type: "error", message: commandAction(answer.tool) ? "You don't have access to that page." : "Sorry, I couldn't do that." });
    }
    const result = await finish(a, answer.input);

    // T4 — learn: same masked phrasing next time = no LLM
    if (AI_DEFAULTS.learnTemplates && result.type === "navigate") {
      const b = built as Built | null;
      const usesOnlyKnownPlaceholders = JSON.stringify(answer.input ?? {})
        .match(/\{[a-z_]+_\d+\}/g)
        ?.every((ph) => ex.entities.some((e) => e.ph === ph)) ?? true;
      if (b?.learnable && usesOnlyKnownPlaceholders && template) {
        void prisma.commandTemplate
          .upsert({
            where: { template },
            create: { template, action: a.name, paramMap: (answer.input ?? {}) as object, source: "llm" },
            update: {},
          })
          .catch(() => undefined);
      }
    }
    return result;
  } catch (e) {
    if (e instanceof OutOfScope) {
      outcome = "rejected_scope";
      counts = false;
      return done({ type: "rejected", message: `That ${e.message} is outside what you can see.` });
    }
    if (e instanceof Invalid) {
      outcome = "invalid";
      counts = false;
      return done({ type: "error", message: "Sorry, I couldn't turn that into a page. Try rephrasing." });
    }
    outcome = "error";
    counts = false;
    return done({ type: "error", message: "Something went wrong. Please try again." });
  }
};
