// File: ticket.service.ts
// Path: src/services/ticket.service.ts
//
// Support tickets (16 Nov 2026). Two pipelines in one table:
//   BUG      NEW → NEEDS_REPRO → INVESTIGATING → FIXED → CLOSED   (or WONT_FIX)
//   FEATURE  NEW → UNDER_REVIEW → PLANNED → IN_PROGRESS → SHIPPED (or DECLINED)
//
// Auto-debug: when a bug arrives, the evidence the browser sent (failed API
// calls, JS errors, the clicks before them) is read here with no AI at all:
// failed calls are matched to the server's own error by X-Request-Id, the
// clicks become numbered "steps to reproduce", and the likely area is named.
// The AI diagnosis (support.diagnose) is a button on top of that, never
// automatic, and it only sees text: never the screenshot or the replay.

import type { TicketKind } from "@prisma/client";
import { errorsFor, errorsOfUser, type ServerError } from "@/utils/recentErrors";
import { llm, LlmError, type LlmTool } from "@/services/ai/llm.service";
import type { TokenUsage } from "@/services/ai/cost.service";

export const PIPELINE: Record<TicketKind, readonly string[]> = {
  BUG: ["NEW", "NEEDS_REPRO", "INVESTIGATING", "FIXED", "CLOSED", "WONT_FIX"],
  FEATURE: ["NEW", "UNDER_REVIEW", "PLANNED", "IN_PROGRESS", "SHIPPED", "DECLINED"],
};
export const CLOSED_STATES = new Set(["CLOSED", "WONT_FIX", "SHIPPED", "DECLINED"]);
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "BLOCKER"] as const;

export const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  NEEDS_REPRO: "Needs steps",
  INVESTIGATING: "Investigating",
  FIXED: "Fixed",
  CLOSED: "Closed",
  WONT_FIX: "Won't fix",
  UNDER_REVIEW: "Under review",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  SHIPPED: "Shipped",
  DECLINED: "Declined",
};

// ── what the browser sends (all optional, all capped) ─────────────────────────

export interface NetCall {
  method: string;
  url: string;
  status: number; // 0 = never answered (network / CORS / timeout)
  ms: number;
  at: string;
  requestId?: string;
  message?: string;
}
export interface ConsoleLine {
  level: "error" | "warn";
  msg: string;
  stack?: string;
  at: string;
}
export interface Crumb {
  at: string;
  type: "click" | "nav" | "input" | "key" | "submit";
  label: string;
  path?: string;
}
export interface TicketContext {
  env?: Record<string, unknown>;
  page?: { url?: string; title?: string };
  network?: NetCall[];
  console?: ConsoleLine[];
  crumbs?: Crumb[];
}

export interface Finding {
  level: "error" | "warn" | "info";
  title: string;
  detail?: string | undefined;
}
export interface Diagnosis {
  at: string;
  summary: string;
  area: string;
  findings: Finding[];
  steps: string[];
  serverErrors: ServerError[];
  ai?: AiDiagnosis;
}
export interface AiDiagnosis {
  at: string;
  summary: string;
  likelyCause: string;
  whereToLook: string[];
  suggestedFix: string;
  confidence: "low" | "medium" | "high";
}

const AREAS: [RegExp, string][] = [
  [/\/ai|canvas|assist/i, "AI assistant"],
  [/\/spocs?/i, "SPOCs"],
  [/\/clients?/i, "Clients"],
  [/\/org|org-tree/i, "Org chart"],
  [/\/map/i, "Map"],
  [/\/reports?/i, "Reports"],
  [/step-runs|pipeline/i, "Pipeline runs"],
  [/outreach/i, "Outreach"],
  [/approvals/i, "Approvals"],
  [/recycle/i, "Recycle bin"],
  [/\/admin|users|roles|lookups/i, "Admin"],
  [/auth|sign-?in|login/i, "Sign-in"],
];
const areaOf = (...texts: (string | undefined)[]) => {
  for (const t of texts) if (t) for (const [re, name] of AREAS) if (re.test(t)) return name;
  return "General";
};

const pathOnly = (url: string) => {
  try {
    return new URL(url, "http://x").pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
};
const statusMeaning = (s: number) =>
  s === 0
    ? "never answered (network, server down, or blocked)"
    : s === 401
      ? "the session had expired or was not sent"
      : s === 403
        ? "the user's role is missing a permission"
        : s === 404
          ? "the record or address does not exist"
          : s === 409
            ? "a duplicate / conflicting record"
            : s >= 500
              ? "the server crashed on this request"
              : s >= 400
                ? "the server refused the input"
                : "ok";

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 19);
};

/** read the evidence — no AI, no cost, runs on every new bug and on every new recording */
export const autoDiagnose = (
  t: { title: string; description?: string | null; pageUrl?: string | null; reporterId: string; createdAt?: Date },
  ctx: TicketContext,
): Diagnosis => {
  const net = ctx.network ?? [];
  const failed = net.filter((n) => n.status === 0 || n.status >= 400);
  const slow = net.filter((n) => n.status > 0 && n.status < 400 && n.ms > 3000);
  const jsErrors = (ctx.console ?? []).filter((c) => c.level === "error");
  const findings: Finding[] = [];

  // the server's side of the calls that failed (same request id), plus any
  // error of this user in the last 15 minutes the browser didn't log
  const since = new Date((t.createdAt ?? new Date()).getTime() - 15 * 60_000);
  const byId = errorsFor(failed.map((f) => f.requestId ?? ""));
  const extra = errorsOfUser(t.reporterId, since).filter((e) => !byId.some((b) => b.requestId === e.requestId) && e.status >= 500);
  const serverErrors = [...byId, ...extra].slice(-10);

  const groups = new Map<string, NetCall[]>();
  for (const f of failed) {
    const k = `${f.method} ${pathOnly(f.url).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")} → ${f.status || "no answer"}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const [k, calls] of groups) {
    const last = calls[calls.length - 1]!;
    const srv = serverErrors.find((e) => e.requestId && e.requestId === last.requestId);
    findings.push({
      level: last.status === 0 || last.status >= 500 ? "error" : "warn",
      title: `${k}${calls.length > 1 ? ` (×${calls.length})` : ""}`,
      detail: [statusMeaning(last.status), last.message, srv && `server: ${srv.message}`].filter(Boolean).join(" — "),
    });
  }
  const seen = new Set<string>();
  for (const e of jsErrors) {
    const key = e.msg.slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    const frame = e.stack?.split("\n").find((l) => /\.(t|j)sx?/.test(l) && !/node_modules/.test(l))?.trim();
    findings.push({ level: "error", title: `Browser error: ${key}`, detail: frame });
    if (seen.size >= 5) break;
  }
  for (const s of slow.slice(0, 3))
    findings.push({ level: "info", title: `Slow: ${s.method} ${pathOnly(s.url)} took ${(s.ms / 1000).toFixed(1)} s` });
  if (!findings.length)
    findings.push({
      level: "info",
      title: "No errors were recorded",
      detail: "Nothing failed in the browser or on the server — likely a wrong result or a layout problem. The replay and screenshot show what the user saw.",
    });

  // steps to reproduce, from the clicks / page changes before the problem
  const crumbs = (ctx.crumbs ?? []).slice(-15);
  const steps: string[] = [];
  for (const c of crumbs) {
    const line =
      c.type === "nav"
        ? `Opened ${c.path ?? c.label}`
        : c.type === "click"
          ? `Clicked “${c.label}”`
          : c.type === "input"
            ? `Typed in “${c.label}”`
            : c.type === "submit"
              ? `Submitted “${c.label}”`
              : `Pressed ${c.label}`;
    if (steps[steps.length - 1] !== line) steps.push(`${clock(c.at)}  ${line}`);
  }
  const firstErr = findings.find((f) => f.level === "error");
  if (firstErr) steps.push(`→ ${firstErr.title}`);

  const area = areaOf(t.pageUrl ?? undefined, failed[0]?.url, t.title, ctx.page?.url);
  const summary = firstErr
    ? `${area}: ${firstErr.title}${firstErr.detail ? ` — ${firstErr.detail}` : ""}`
    : `${area}: no error was recorded; see the replay for what the user saw.`;

  return { at: new Date().toISOString(), summary: summary.slice(0, 400), area, findings, steps, serverErrors };
};

// ── AI diagnosis (on request) ─────────────────────────────────────────────────

const DIAGNOSE_TOOL: LlmTool = {
  name: "diagnosis",
  description: "Your diagnosis of the reported bug.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One sentence: what is going wrong, in plain words." },
      likelyCause: { type: "string", description: "The most likely technical cause." },
      whereToLook: { type: "array", items: { type: "string" }, description: "Files, endpoints or components to check first (max 5)." },
      suggestedFix: { type: "string", description: "What a developer should try." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["summary", "likelyCause", "whereToLook", "suggestedFix", "confidence"],
  },
};

const SYSTEM = `You are a senior engineer triaging a bug report in a CRM web app.
Stack: Next.js 16 + React 19 frontend (src/app, src/features, src/components), Express + Prisma backend (src/controller, src/services, src/routes) on Postgres.
You get the user's words, the automatic findings (failed API calls with the server's own error and stack, browser errors), and the user's last steps.
Be concrete and short. If the evidence is thin, say so and set confidence low. Answer only with the diagnosis tool.`;

export const aiDiagnose = async (
  t: { title: string; description?: string | null; expected?: string | null; pageUrl?: string | null },
  d: Diagnosis,
): Promise<{ ai: AiDiagnosis; usage: TokenUsage; model: string }> => {
  const text = [
    `Title: ${t.title}`,
    t.description && `What happened: ${t.description}`,
    t.expected && `Expected: ${t.expected}`,
    t.pageUrl && `Page: ${pathOnly(t.pageUrl)}`,
    `Area: ${d.area}`,
    `Findings:\n${d.findings.map((f) => `- [${f.level}] ${f.title}${f.detail ? ` — ${f.detail}` : ""}`).join("\n")}`,
    d.serverErrors.length && `Server errors:\n${d.serverErrors.map((e) => `- ${e.method} ${e.path} ${e.status}: ${e.message}\n${e.stack ?? ""}`).join("\n")}`,
    d.steps.length && `Steps:\n${d.steps.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12_000);
  const res = await llm().call({ system: SYSTEM, user: text, tools: [DIAGNOSE_TOOL] });
  if (res.tool !== "diagnosis") throw new LlmError("The AI gave no diagnosis", "no_tool", res.usage, res.model);
  const i = res.input as Omit<AiDiagnosis, "at">;
  return {
    ai: {
      at: new Date().toISOString(),
      summary: String(i.summary ?? "").slice(0, 500),
      likelyCause: String(i.likelyCause ?? "").slice(0, 1000),
      whereToLook: (Array.isArray(i.whereToLook) ? i.whereToLook : []).slice(0, 5).map((x) => String(x).slice(0, 200)),
      suggestedFix: String(i.suggestedFix ?? "").slice(0, 1000),
      confidence: ["low", "medium", "high"].includes(i.confidence) ? i.confidence : "low",
    },
    usage: res.usage,
    model: res.model,
  };
};

// ── the browser's context, cleaned before it is stored ────────────────────────

const SECRETISH = /(password|token|secret|authorization|cookie|otp)=?[^&\s]*/gi;
const clean = (s: unknown, max: number) => String(s ?? "").replace(SECRETISH, "$1=***").slice(0, max);

export const sanitizeContext = (raw: unknown): TicketContext => {
  const c = (raw && typeof raw === "object" ? raw : {}) as TicketContext;
  const arr = <T>(v: T[] | undefined, n: number) => (Array.isArray(v) ? v.slice(-n) : []);
  return {
    env: c.env && typeof c.env === "object" ? Object.fromEntries(Object.entries(c.env).slice(0, 30).map(([k, v]) => [k.slice(0, 40), typeof v === "object" ? v : clean(v, 300)])) : {},
    page: { url: clean(c.page?.url, 500), title: clean(c.page?.title, 200) },
    network: arr(c.network, 60).map((n) => ({
      method: clean(n.method, 10),
      url: clean(n.url, 400),
      status: Number(n.status) || 0,
      ms: Math.round(Number(n.ms) || 0),
      at: clean(n.at, 40),
      ...(n.requestId && { requestId: clean(n.requestId, 60) }),
      ...(n.message && { message: clean(n.message, 400) }),
    })),
    console: arr(c.console, 60).map((l) => ({
      level: l.level === "warn" ? ("warn" as const) : ("error" as const),
      msg: clean(l.msg, 1000),
      ...(l.stack && { stack: clean(l.stack, 2000) }),
      at: clean(l.at, 40),
    })),
    crumbs: arr(c.crumbs, 60).map((b) => ({
      at: clean(b.at, 40),
      type: (["click", "nav", "input", "key", "submit"].includes(b.type) ? b.type : "click") as Crumb["type"],
      label: clean(b.label, 120),
      ...(b.path && { path: clean(b.path, 300) }),
    })),
  };
};
