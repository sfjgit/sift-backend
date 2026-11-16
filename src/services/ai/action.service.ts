// File: action.service.ts
// Path: src/services/ai/action.service.ts
//
// AI actions, phase 2 (14 Nov 2026 — the user lifted read-only for safe jobs).
// The assistant PROPOSES; the person confirms on screen; the app then calls the
// normal endpoints with the person's own permissions, and the change lands in
// the recycle bin with an Undo. So the AI itself still writes nothing:
//
//   "assign these to Ravi"           → assign the clients on screen (page filters)
//   "give this client to me"         → assign the open client
//   "move her SPOCs to Priya"        → reassign SPOCs (page / open record / client's SPOCs)
//   "mark these as In Discussion"    → set the sales status of SPOCs
//
// Never: delete, send, run the pipeline. At most MAX_RECORDS per action.

import { z } from "zod";
import type { AuthUser } from "@/types/express";
import type { PermissionMap } from "@/services/permission.service";
import prisma from "@/utils/prisma/client";
import { listClientsQuery, listSpocsQuery } from "@/validators/client.validators";
import { clientIdsFor } from "@/controller/client.controller";
import { spocIdsFor } from "@/controller/spoc.controller";
import { entityHints, extractEntities, type Entity } from "@/services/ai/entities.service";
import { LlmError, llm, type LlmTool } from "@/services/ai/llm.service";
import { llmConfigured } from "@/services/ai/settings.service";
import { logAi } from "@/services/ai/audit.service";

export const MAX_RECORDS = 100;

export const ACTION_RE =
  /\b(assign|re-?assign|allot|allocate|transfer|hand ?over|give (these|them|this|it|her|his|their|all)|move (these|them|this|it|her|his|their|all)|set (the |their |its )?(sales )?status|mark (these|them|this|it|all)|change (the |their |its )?(sales )?status|make (me|him|her) the (owner|handler))\b/i;
export const DELETE_RE = /\b(delete|remove|erase|wipe|purge|destroy|drop)\b/i;
const SEND_RE = /\b(send|email|mail|whatsapp|message|run the pipeline|run pipeline|approve|reject)\b/i;

export interface ActionProposal {
  type: "assign_clients" | "reassign_spocs" | "set_sales_status";
  title: string;
  detail: string;
  count: number;
  sample: string[];
  /** the body for the app's own endpoint (it is re-checked there) */
  body: Record<string, unknown>;
}

type Page = { kind: "clients" | "spocs" | "client" | "spoc" | "other"; id?: string };

const TARGET = { type: "string", enum: ["page", "this", "client_spocs", "named"], description: "page = everything listed on the current page (its filters); this = the record that is open; client_spocs = all SPOCs of the open client; named = the {client_N} placeholders given" };
const TOOLS: LlmTool[] = [
  {
    name: "propose_assign_clients",
    description: "Assign clients to people (owners).",
    input_schema: {
      type: "object",
      properties: {
        target: TARGET,
        clients: { type: "string", description: "{client_N} placeholders, comma-separated (target named)" },
        to: { type: "string", description: '"me" or {user_N} placeholders, comma-separated' },
        mode: { type: "string", enum: ["add", "replace"], description: "add = keep current owners too (default); replace = only these people" },
      },
      required: ["target", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_reassign_spocs",
    description: "Give SPOCs (client contacts) a new handler.",
    input_schema: {
      type: "object",
      properties: { target: TARGET, to: { type: "string", description: '"me" or one {user_N} placeholder' } },
      required: ["target", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_set_sales_status",
    description: "Set the sales status of SPOCs.",
    input_schema: {
      type: "object",
      properties: { target: TARGET, status: { type: "string", description: "one {sales_status_N} placeholder" } },
      required: ["target", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_clarification",
    description: 'Unclear who / what / to whom. One short "Do you mean …?" question, 2-4 options that are complete requests.',
    input_schema: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" }, maxItems: 4 } }, required: ["question"], additionalProperties: false },
  },
  {
    name: "reject_request",
    description: "Anything that is not one of these three actions (deleting, sending, approving, running the pipeline…).",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
  },
];

const SYSTEM = (page: Page) => `You turn a request into ONE proposed CRM action. A person will see your proposal and confirm it — you never act yourself.
Actions: propose_assign_clients, propose_reassign_spocs, propose_set_sales_status. Anything else → reject_request.
The user is on: ${page.kind === "clients" ? "the Clients list" : page.kind === "spocs" ? "the SPOCs list" : page.kind === "client" ? "one client's page" : page.kind === "spoc" ? "one SPOC's page" : "a page with no records"}.
"these / them / all" = target page. "this / it / him / her" on a record page = target this. On a client's page, its SPOCs = target client_spocs.
Names are masked as {placeholders}; use them exactly. "me" / "myself" = "me". Never invent a placeholder.
If the person or the records are unclear, call ask_clarification.`;

const ids = (s: unknown) => (typeof s === "string" ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

export type PlanResult =
  | { kind: "action"; proposal: ActionProposal; message: string }
  | { kind: "clarify"; message: string; options?: string[] }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

export const planAction = async (
  user: AuthUser,
  perms: PermissionMap,
  prompt: string,
  page: Page,
  filters: Record<string, string>,
): Promise<PlanResult> => {
  const startedAt = Date.now();
  if (DELETE_RE.test(prompt))
    return { kind: "rejected", message: "I don't delete things. Delete it on the page — it goes to the Recycle bin and can be restored." };
  if (SEND_RE.test(prompt)) return { kind: "rejected", message: "I can assign records and set sales status. Sending, approving or running the pipeline you do on the page." };
  if (!llmConfigured()) return { kind: "error", message: "The AI isn't set up yet (no API key)." };

  const ex = await extractEntities(prompt);
  let answer;
  try {
    answer = await llm().call({
      system: SYSTEM(page),
      user: `Request: ${ex.masked}\nPlaceholders: ${JSON.stringify(entityHints(ex.entities))}`,
      tools: TOOLS,
    });
  } catch (e) {
    return { kind: "error", message: e instanceof LlmError && e.code === "timeout" ? "The AI didn't answer in time. Please try again." : "I couldn't work that out. Try saying it another way." };
  }
  await logAi({ user, mode: "COMMAND", usageMode: "COMMAND", input: prompt, tier: "llm", outcome: "success", action: `plan_${answer.tool}`, params: answer.input, countsToQuota: true, model: answer.model, usage: answer.usage, startedAt });

  const input = (answer.input ?? {}) as Record<string, unknown>;
  if (answer.tool === "reject_request") return { kind: "rejected", message: "That's not something I can do. I can assign clients, give SPOCs a new handler, or set their sales status." };
  if (answer.tool === "ask_clarification") {
    const q = z.object({ question: z.string().min(1).max(300), options: z.array(z.string().max(160)).max(4).optional() }).safeParse(input);
    return q.success ? { kind: "clarify", message: q.data.question.replace(/^(\s*do you mean[:,]?\s+)+/i, "Do you mean "), ...(q.data.options && { options: q.data.options }) } : { kind: "error", message: "Try saying it another way." };
  }

  const byPh = (ph: string): Entity | undefined => ex.entities.find((e) => e.ph === ph.trim());
  const people = async (raw: unknown) => {
    const out: { id: string; name: string }[] = [];
    for (const p of ids(raw)) {
      if (/^me$/i.test(p)) out.push({ id: user.id, name: "you" });
      else {
        const e = byPh(p);
        if (e?.kind === "user" && e.value) out.push({ id: e.value, name: e.label });
      }
    }
    return out;
  };

  // the records the action is about
  const target = String(input.target ?? "");
  const clients = async () => {
    if (target === "this" && page.kind === "client" && page.id) {
      const c = await prisma.client.findFirst({ where: { id: page.id }, select: { id: true, name: true } });
      return c ? { total: 1, rows: [c] } : { total: 0, rows: [] };
    }
    if (target === "named") {
      const rows = ids(input.clients).map(byPh).filter((e): e is Entity => e?.kind === "client" && !!e.value).map((e) => ({ id: e.value!, name: e.label }));
      return { total: rows.length, rows };
    }
    if (page.kind !== "clients") return null;
    const q = listClientsQuery.safeParse(filters);
    return clientIdsFor({ user, scope: perms["clients.read"], figures: !!perms["client_financials.read"] }, q.success ? q.data : listClientsQuery.parse({}), MAX_RECORDS);
  };
  const spocs = async () => {
    if (target === "this" && page.kind === "spoc" && page.id) {
      const s = await prisma.clientSpoc.findFirst({ where: { id: page.id }, select: { id: true, firstName: true, lastName: true } });
      return s ? { total: 1, rows: [{ id: s.id, name: `${s.firstName} ${s.lastName ?? ""}`.trim() }] } : { total: 0, rows: [] };
    }
    if ((target === "client_spocs" || target === "this") && page.kind === "client" && page.id) {
      const q = listSpocsQuery.parse({ clientId: page.id });
      return spocIdsFor({ user, scope: perms["spocs.read"] }, q, MAX_RECORDS);
    }
    if (page.kind !== "spocs") return null;
    const q = listSpocsQuery.safeParse(filters);
    return spocIdsFor({ user, scope: perms["spocs.read"] }, q.success ? q.data : listSpocsQuery.parse({}), MAX_RECORDS);
  };
  const tooMany = (n: number, what: string) => ({ kind: "clarify" as const, message: `That's ${n} ${what} — I do at most ${MAX_RECORDS} at a time. Filter the page down first, then ask again.` });
  const nothing = (what: string) => ({ kind: "clarify" as const, message: `I can't tell which ${what} you mean. Open the list (or the record) and say “these” or “this”, or name the client.` });

  if (answer.tool === "propose_assign_clients") {
    if (!perms["clients.assign"]) return { kind: "rejected", message: "Your role can't assign clients." };
    const to = await people(input.to);
    if (!to.length) return { kind: "clarify", message: "Who should they be assigned to? Say a name, or “me”." };
    const list = await clients();
    if (!list || !list.rows.length) return nothing("clients");
    if (list.total > MAX_RECORDS) return tooMany(list.total, "clients");
    const replace = input.mode === "replace";
    const names = to.map((p) => p.name).join(" and ");
    return {
      kind: "action",
      message: `Ready to assign ${list.total} client${list.total === 1 ? "" : "s"} to ${names}. Check and confirm.`,
      proposal: {
        type: "assign_clients",
        title: `Assign ${list.total} client${list.total === 1 ? "" : "s"} to ${names}`,
        detail: replace ? "Current owners are replaced." : "Current owners stay; these people are added.",
        count: list.total,
        sample: list.rows.slice(0, 8).map((r) => r.name),
        body: { clientIds: list.rows.map((r) => r.id), userIds: to.map((p) => p.id), mode: replace ? "replace" : "add", note: "Assigned with the AI assistant" },
      },
    };
  }

  if (answer.tool === "propose_reassign_spocs") {
    if (!perms["spocs.assign"]) return { kind: "rejected", message: "Your role can't reassign SPOCs." };
    const to = (await people(input.to))[0];
    if (!to) return { kind: "clarify", message: "Who should handle them? Say a name, or “me”." };
    const list = await spocs();
    if (!list || !list.rows.length) return nothing("SPOCs");
    if (list.total > MAX_RECORDS) return tooMany(list.total, "SPOCs");
    return {
      kind: "action",
      message: `Ready to give ${list.total} SPOC${list.total === 1 ? "" : "s"} to ${to.name}. Check and confirm.`,
      proposal: {
        type: "reassign_spocs",
        title: `Give ${list.total} SPOC${list.total === 1 ? "" : "s"} to ${to.name}`,
        detail: "The new handler owns them from now; the old one is kept in their history.",
        count: list.total,
        sample: list.rows.slice(0, 8).map((r) => r.name),
        body: { spocIds: list.rows.map((r) => r.id), assignToId: to.id, reason: "Reassigned with the AI assistant" },
      },
    };
  }

  if (answer.tool === "propose_set_sales_status") {
    if (!perms["spocs.update"]) return { kind: "rejected", message: "Your role can't change SPOCs." };
    const st = byPh(String(input.status ?? ""));
    if (!st || st.kind !== "lookup:SALES_STATUS" || !st.value) return { kind: "clarify", message: "Which sales status? Say it as it appears, e.g. “In Discussion”." };
    const list = await spocs();
    if (!list || !list.rows.length) return nothing("SPOCs");
    if (list.total > MAX_RECORDS) return tooMany(list.total, "SPOCs");
    return {
      kind: "action",
      message: `Ready to set ${list.total} SPOC${list.total === 1 ? "" : "s"} to “${st.label}”. Check and confirm.`,
      proposal: {
        type: "set_sales_status",
        title: `Set ${list.total} SPOC${list.total === 1 ? "" : "s"} to “${st.label}”`,
        detail: "Each SPOC's history records the old and the new status.",
        count: list.total,
        sample: list.rows.slice(0, 8).map((r) => r.name),
        body: { spocIds: list.rows.map((r) => r.id), salesStatusId: st.value },
      },
    };
  }
  return { kind: "error", message: "I couldn't work that out. Try saying it another way." };
};
