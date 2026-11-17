// File: canvas.service.ts
// Path: src/services/ai/canvas.service.ts
//
// CANVAS mode (spec §7). prompt → (T1 mask, G3 guard) → LLM composes a page spec
// from the catalog → validate (G4) → put entity values back → run the queries
// in parallel through aiDb (G6) → blocks with data.
//
// The LLM sees catalog names + param docs only, never a row. Every number comes
// from the DB. A saved template stores the RESOLVED spec, so a rerun needs no
// LLM and costs nothing.

import { z } from "zod";
import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import { aiDb, makeReadOnly } from "@/config/aiDb";
import { AI_DEFAULTS } from "@/config/aiDefaults";
import { checkDestructiveIntent, READ_ONLY_MESSAGE } from "@/config/aiGuardrails";
import { COMPONENT_ACCEPTS, QUERIES, queryDef, type QueryCtx, type QueryResult } from "@/config/queryRegistry";
import { entityHints, extractEntities, type Entity, type Extraction } from "@/services/ai/entities.service";
import { CLARIFY_TOOL, LlmError, llm, REJECT_TOOL, type LlmTool } from "@/services/ai/llm.service";
import { logAi, type AiOutcome, type AiTier } from "@/services/ai/audit.service";
import { BASIC_MODE_MESSAGE, budgetState, checkBudgetAlerts, type TokenUsage } from "@/services/ai/cost.service";
import { llmConfigured } from "@/services/ai/settings.service";
import { PrismaClient } from "@prisma/client";

// ── the spec ─────────────────────────────────────────────────────────────────

export const COMPONENTS = ["kpi", "bar", "line", "pie", "table", "org"] as const;
export const WIDTHS = ["full", "half", "third"] as const;

const blockSchema = z
  .object({
    id: z.string().max(40).optional(),
    component: z.enum(COMPONENTS),
    query: z.string().max(60),
    params: z.record(z.string(), z.unknown()).optional(),
    title: z.string().max(120).optional(),
    width: z.enum(WIDTHS).optional(),
  })
  .strict();

export const canvasSpecSchema = z
  .object({
    title: z.string().min(1).max(120),
    blocks: z.array(blockSchema).min(1).max(AI_DEFAULTS.canvasMaxBlocks),
  })
  .strict();

export type CanvasSpec = z.infer<typeof canvasSpecSchema>;
export type CanvasBlock = CanvasSpec["blocks"][number];

export interface RenderedBlock {
  id: string;
  component: CanvasBlock["component"];
  query: string;
  params: Record<string, unknown>;
  title: string;
  width: CanvasBlock["width"];
  result?: QueryResult;
  error?: string;
}

export class SpecInvalid extends Error {}

// param name → entity kind it must hold (G4: a {business_unit_1} can't land in industryId)
const PARAM_KINDS: Record<string, string> = {
  industryId: "lookup:INDUSTRY",
  categoryId: "lookup:CLIENT_CATEGORY",
  businessUnitId: "business_unit",
  salesStatusId: "lookup:SALES_STATUS",
  clientId: "client",
  added: "date_range",
  period: "date_range",
  fy: "fy",
  assignedToId: "user",
  handlerId: "user",
};
const PH = /^\{[a-z_]+_\d+\}$/;

/** "{user_1}" → "Rakhi Sen" in any text the model wrote (titles, summaries, questions) */
export const unmaskText = (text: string, ex: Extraction | null | undefined) =>
  text.replace(/\{[a-z_]+_\d+\}/g, (ph) => ex?.entities.find((e) => e.ph === ph)?.label ?? "that");

/** put entity values back in place of placeholders, checking each kind */
const substitute = (params: Record<string, unknown>, ex: Extraction | null) => {
  const out: Record<string, unknown> = {};
  const one = (key: string, v: unknown): unknown => {
    if (typeof v !== "string" || !PH.test(v.trim())) return v;
    const e: Entity | undefined = ex?.entities.find((x) => x.ph === v.trim());
    if (!e) throw new SpecInvalid(`unknown placeholder ${v}`);
    const want = PARAM_KINDS[key];
    if (want && e.kind !== want) throw new SpecInvalid(`${v} can't be used for ${key}`);
    if (e.kind === "date_range") return { from: e.from, to: e.to };
    return e.value;
  };
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) out[k] = v.map((x) => one(k, x));
    else if (typeof v === "string" && v.includes(",") && v.split(",").every((s) => PH.test(s.trim()))) out[k] = v.split(",").map((s) => one(k, s.trim()));
    else out[k] = one(k, v);
  }
  return out;
};

/**
 * G4 — every block: registered query, user has its permission, component fits the
 * return type, params pass the query's strict schema. `llmOnly` rejects queries
 * that are never offered to the LLM (usage dashboard) when the spec came from it.
 */
export const validateSpec = (raw: unknown, perms: PermissionMap, opts: { ex?: Extraction | null; llmOnly?: boolean; allow?: string[] } = {}) => {
  const parsed = canvasSpecSchema.safeParse(raw);
  if (!parsed.success) throw new SpecInvalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const blocks = parsed.data.blocks.map((b, i) => {
    const def = queryDef(b.query);
    if (!def || (opts.llmOnly && !def.llm && !opts.allow?.includes(def.name))) throw new SpecInvalid(`unknown query ${b.query}`);
    if (!perms[def.permission]) throw new SpecInvalid(`no access to ${def.label}`);
    if (def.name !== "free_sql" && !COMPONENT_ACCEPTS[b.component].includes(def.returns)) throw new SpecInvalid(`${b.component} can't show ${def.label}`);
    const params = substitute(b.params ?? {}, opts.ex ?? null);
    const ok = def.params.safeParse(params);
    if (!ok.success) throw new SpecInvalid(`${def.name}: ${ok.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return {
      id: b.id ?? `b${i + 1}`,
      component: b.component,
      query: b.query,
      params: params,
      title: unmaskText(b.title ?? def.label, opts.ex),
      width: b.width ?? (b.component === "kpi" ? "third" : b.component === "table" || b.component === "org" ? "full" : "half"),
    };
  });
  return { title: unmaskText(parsed.data.title, opts.ex), blocks };
};

export type ValidSpec = ReturnType<typeof validateSpec>;

// ── run ──────────────────────────────────────────────────────────────────────

let aiTables: ReturnType<typeof makeReadOnly> | null = null;
/** AI-owned tables (usage dashboard), read-only, via the main connection */
const aiTablesDb = () => (aiTables ??= makeReadOnly(new PrismaClient()));

export const runSpec = async (user: AuthUser, perms: PermissionMap, spec: ValidSpec, rowCap: number): Promise<RenderedBlock[]> => {
  const ctx: QueryCtx = { user, perms, db: aiDb(), aiTables: aiTablesDb(), rowCap };
  return Promise.all(
    spec.blocks.map(async (b) => {
      const def = queryDef(b.query)!;
      try {
        const result = await def.run(ctx, def.params.parse(b.params));
        return { ...b, result };
      } catch (e) {
        return { ...b, error: e instanceof Error && /statement timeout|canceling statement/i.test(e.message) ? "This block took too long." : "Couldn't load this block." };
      }
    }),
  );
};

// ── generate (LLM) ───────────────────────────────────────────────────────────

export const catalogFor = (perms: PermissionMap) =>
  QUERIES.filter((q) => q.llm && perms[q.permission])
    .map((q) => `- ${q.name} [returns ${q.returns}] — ${q.description} Params: ${q.paramDoc}`)
    .join("\n");

const SYSTEM = (catalog: string) => `You compose read-only report pages ("canvases") for a sales & marketing CRM.
Call compose_canvas with a title and 1-${AI_DEFAULTS.canvasMaxBlocks} blocks. Each block = one query from the catalog + one component.
Components: kpi (for [returns single]), bar / line / pie (for [returns series]; line for trends over time, pie only for few slices), table (for [returns rows] or series), org (for [returns tree] — the org chart, full width).
Widths: full | half | third (kpis usually third, charts half, tables full).
Names in the request are masked as {placeholders}: put them into params exactly as given (e.g. "industryId": "{industry_1}", "added": "{date_range_1}", "fy": "{fy_1}").
Never invent ids or values. Only use params listed for that query.
If the request asks to change, create, delete, send or modify anything, call reject_request. If it can't be answered with these queries, call ask_clarification.

Catalog:
${catalog}`;

const COMPOSE_TOOL: LlmTool = {
  name: "compose_canvas",
  description: "Compose the report page.",
  input_schema: {
    type: "object",
    properties: {
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
    required: ["title", "blocks"],
    additionalProperties: false,
  },
};

export type CanvasResult =
  | { type: "canvas"; spec: ValidSpec; blocks: RenderedBlock[]; matched: { label: string; kind: string }[] }
  | { type: "clarify"; message: string }
  | { type: "rejected"; message: string }
  | { type: "error"; message: string };

export const generateCanvas = async (user: AuthUser, perms: PermissionMap, prompt: string): Promise<CanvasResult> => {
  const startedAt = Date.now();
  let tier: AiTier = "none";
  let outcome: AiOutcome = "error";
  let usage: TokenUsage | null = null;
  let model: string | null = null;
  let params: unknown = null;
  let counts = false;
  const done = async (r: CanvasResult) => {
    await logAi({ user, mode: "CANVAS", usageMode: "CANVAS", input: prompt, tier, outcome, action: "compose_canvas", params, countsToQuota: counts, model, usage, startedAt });
    if (usage) void checkBudgetAlerts();
    return r;
  };

  try {
    const ex = await extractEntities(prompt, new Date(), { places: true });
    const guard = checkDestructiveIntent(ex.masked);
    if (!guard.ok) {
      tier = "guard";
      outcome = "rejected_destructive";
      return done({ type: "rejected", message: `${READ_ONLY_MESSAGE} Canvas only builds read-only reports.` });
    }
    if ((await budgetState()).exhausted) {
      outcome = "budget_exhausted";
      return done({ type: "error", message: `${BASIC_MODE_MESSAGE} Saved canvas templates still work.` });
    }
    if (!llmConfigured()) return done({ type: "error", message: "The AI isn't set up yet (no API key)." });

    const catalog = catalogFor(perms);
    if (!catalog) {
      outcome = "rejected_permission";
      return done({ type: "error", message: "You don't have access to any report data." });
    }
    tier = "llm";
    let answer;
    try {
      answer = await llm().call({
        system: SYSTEM(catalog),
        user: `Request: ${ex.masked}\nPlaceholders: ${JSON.stringify(entityHints(ex.entities))}\nToday: ${new Date().toISOString().slice(0, 10)}`,
        tools: [COMPOSE_TOOL, CLARIFY_TOOL, REJECT_TOOL],
      });
    } catch (e) {
      if (e instanceof LlmError) {
        usage = e.usage ?? null;
        model = e.model ?? null;
        if (e.code === "refused") {
          outcome = "rejected_destructive";
          return done({ type: "rejected", message: READ_ONLY_MESSAGE });
        }
        return done({ type: "error", message: "The AI didn't answer in time. Please try again." });
      }
      throw e;
    }
    usage = answer.usage;
    model = answer.model;
    params = answer.input;

    if (answer.tool === "reject_request") {
      outcome = "rejected_destructive";
      return done({ type: "rejected", message: `${READ_ONLY_MESSAGE} Canvas only builds read-only reports.` });
    }
    if (answer.tool === "ask_clarification") {
      const q = z.object({ question: z.string().min(1).max(300) }).strict().safeParse(answer.input);
      outcome = q.success ? "success" : "invalid";
      counts = q.success;
      return done(q.success ? { type: "clarify", message: q.data.question } : { type: "error", message: "Try describing the report differently." });
    }
    if (answer.tool !== "compose_canvas") {
      outcome = "invalid";
      return done({ type: "error", message: "Try describing the report differently." });
    }

    let spec: ValidSpec;
    try {
      spec = validateSpec(answer.input, perms, { ex, llmOnly: true });
    } catch (e) {
      outcome = "invalid";
      return done({ type: "error", message: `I couldn't build that report (${(e as Error).message}). Try rephrasing.` });
    }
    const blocks = await runSpec(user, perms, spec, AI_DEFAULTS.canvasTableRows);
    outcome = "success";
    counts = true;
    params = spec;
    return done({ type: "canvas", spec, blocks, matched: ex.entities.map((e) => ({ label: e.label, kind: e.kind })) });
  } catch {
    outcome = "error";
    return done({ type: "error", message: "Something went wrong. Please try again." });
  }
};
