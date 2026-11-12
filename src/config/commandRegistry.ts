// File: commandRegistry.ts
// Path: src/config/commandRegistry.ts
//
// COMMAND mode — the ONLY things the assistant can do (spec §4 L1, §6).
// Every entry is kind "read": it opens a page of the CRM with filters in the URL.
// There is no write kind in the type system, so a write action cannot be added
// here without changing the type — and the red-team test fails the build if one
// appears. The page the URL opens calls the normal, scoped API: the AI can never
// show more than the user already sees.
//
// Filter keys match the frontend list pages (features/*/columns.tsx), which read
// them from the URL.

import { $Enums } from "@prisma/client";
import type { PermissionKey } from "@/config/permissions.registry";
import type { EntityKind } from "@/services/ai/entities.service";

export type FilterSpec =
  | { type: "enum"; label: string; values: readonly string[]; multi?: boolean }
  /** value = placeholder(s) of this entity kind, e.g. "{industry_1}" or "{industry_1},{industry_2}" */
  | { type: "entity"; label: string; kind: EntityKind; multi?: boolean }
  /** value = user placeholder(s), or "me" */
  | { type: "user"; label: string; multi?: boolean }
  /** value = a {date_range_N} placeholder; written to the URL as from / to */
  | { type: "date_range"; label: string; from: string; to: string }
  | { type: "boolean"; label: string }
  | { type: "number"; label: string }
  /** free text typed by the user (a city…) — never learned into a template */
  | { type: "text"; label: string };

export interface CommandAction {
  /** the only kind there is */
  kind: "read";
  name: string;
  description: string;
  /** permission needed to use (and see) this action; null = every signed-in user */
  permission: PermissionKey | null;
  path: string;
  filters?: Record<string, FilterSpec>;
  /** accepts a free-text search (URL ?q=) */
  search?: boolean;
  /** opens one record: the param holds a {client_N} placeholder */
  record?: { param: "client"; kind: "client"; path: (id: string) => string };
  /** sortable columns: list sort key → how it is said ("CSR spent") */
  sorts?: Record<string, string>;
  /** spoken noun for replies ("clients") — or a full sentence for pages without filters */
  noun?: string;
  say?: string;
}

const e = (label: string, values: readonly string[], multi = false): FilterSpec => ({ type: "enum", label, values, multi });
const ent = (label: string, kind: EntityKind, multi = true): FilterSpec => ({ type: "entity", label, kind, multi });
const usr = (label: string): FilterSpec => ({ type: "user", label, multi: true });

export const COMMAND_ACTIONS: readonly CommandAction[] = [
  {
    kind: "read",
    name: "open_dashboard",
    say: "Here is your dashboard.",
    description: "Open the dashboard (overview, my numbers).",
    permission: null,
    path: "/dashboard",
  },
  {
    kind: "read",
    name: "open_clients",
    noun: "clients",
    sorts: { name: "name", createdAt: "date added", updatedAt: "last update", csrSpentRs: "CSR spent", employeeCount: "employee count", status: "status" },
    description: "Open the clients (companies) list, optionally filtered or searched.",
    permission: "clients.read",
    path: "/clients",
    search: true,
    filters: {
      status: e("Client status", Object.values($Enums.ClientStatus)),
      assignedTo: e("Assignment: me = assigned to me, none = nobody assigned", ["me", "none"]),
      assignedToId: usr("Assigned to these people"),
      handlerId: usr("Has SPOCs handled by these people"),
      createdById: usr("Added by these people"),
      businessUnitId: ent("Business unit", "business_unit"),
      serviceLineId: ent("Service line", "service_line"),
      entityType: e("Organisation type", Object.values($Enums.ClientEntityType), true),
      industryId: ent("Industry", "lookup:INDUSTRY"),
      categoryId: ent("Client category", "lookup:CLIENT_CATEGORY"),
      employeeSizeId: ent("Employee size", "lookup:EMPLOYEE_SIZE"),
      programSectorId: ent("CSR programme sector", "lookup:PROGRAM_SECTOR"),
      hasBranches: { type: "boolean", label: "Has branch offices" },
      missing: e("Missing data", ["website", "reports", "spocs", "approved", "figures", "outreach"]),
      pipeline: e("Pipeline: never = never run, run = run at least once, failed = has a failed run", ["never", "run", "failed"]),
      outreachStatus: e("Outreach status", Object.values($Enums.OutreachStatus)),
      csrSpentMinCr: { type: "number", label: "CSR spent at least (₹ crore)" },
      csrSpentMaxCr: { type: "number", label: "CSR spent at most (₹ crore)" },
      state: { type: "text", label: "State (office location)" },
      city: { type: "text", label: "City (office location)" },
      added: { type: "date_range", label: "Added between", from: "createdFrom", to: "createdTo" },
      lastRun: { type: "date_range", label: "Pipeline last run between", from: "lastRunFrom", to: "lastRunTo" },
    },
  },
  {
    kind: "read",
    name: "open_client",
    description: "Open one client's page. Use when the request names a single client ({client_N}).",
    permission: "clients.read",
    path: "/clients",
    record: { param: "client", kind: "client", path: (id) => `/clients/${id}` },
  },
  {
    kind: "read",
    name: "open_spocs",
    noun: "SPOCs",
    sorts: { firstName: "name", createdAt: "date added", validationScore: "validation score" },
    description: "Open the SPOCs (client contacts) list, optionally filtered or searched.",
    permission: "spocs.read",
    path: "/spocs",
    search: true,
    filters: {
      clientId: ent("At this client", "client", false),
      handlerId: usr("Handled by these people"),
      businessUnitId: ent("Business unit", "business_unit"),
      serviceLineId: ent("Service line", "service_line"),
      salesStatusId: ent("Sales status", "lookup:SALES_STATUS"),
      emailStatus: e("Email status", Object.values($Enums.EmailStatus)),
      validationBand: e("Validation", Object.values($Enums.ValidationBand)),
      approvalStatus: e("Approval for outreach", Object.values($Enums.SpocApprovalStatus)),
      isActive: { type: "boolean", label: "Active SPOCs (false = deactivated)" },
    },
  },
  {
    kind: "read",
    name: "open_approvals",
    say: "Here is the approvals queue.",
    description: "Open the approvals queue (clients and SPOCs waiting for approval).",
    permission: "spocs.read",
    path: "/approvals",
  },
  {
    kind: "read",
    name: "open_pipeline_runs",
    noun: "pipeline runs",
    description: "Open pipeline runs (enrichment steps sent to the CSR pipeline).",
    permission: "step_runs.read",
    path: "/pipeline-runs",
    filters: {
      status: e("Run status", Object.values($Enums.StepRunStatus)),
      clientId: ent("For this client", "client", false),
      requestedById: usr("Started by these people"),
    },
  },
  { kind: "read", name: "open_map", say: "Here is the office map.", description: "Open the office map of clients.", permission: "clients.read", path: "/map" },
  { kind: "read", name: "open_reports", say: "Here are the reports.", description: "Open reports and charts.", permission: "reports.read", path: "/reports" },
  { kind: "read", name: "open_outreach", say: "Here is outreach.", description: "Open outreach packs and mails.", permission: "outreach.read", path: "/outreach" },
  { kind: "read", name: "open_users", noun: "users", description: "Open the users (people) list.", permission: "users.read", path: "/admin/users", search: true },
  { kind: "read", name: "open_notifications", say: "Here are your notifications.", description: "Open my notifications.", permission: null, path: "/notifications" },
  { kind: "read", name: "open_help", say: "Here is the help centre.", description: "Open the help centre, optionally searched.", permission: null, path: "/help", search: true },
  { kind: "read", name: "open_settings", say: "Here are your settings.", description: "Open my settings (profile, theme).", permission: null, path: "/settings" },
  {
    kind: "read",
    name: "open_canvas",
    say: "Building your report in AI Canvas.",
    description:
      "Open AI Canvas to build a report (charts, KPIs, tables) — use for questions asking for numbers, counts, totals, top-N rankings, trends, comparisons or anything grouped / by FY.",
    permission: "ai_assistant.canvas_use",
    path: "/ai-canvas",
  },
] as const;

export const commandAction = (name: string) => COMMAND_ACTIONS.find((a) => a.name === name);

/** control tools every request gets (no navigation) */
export const CONTROL_TOOLS = ["search", "ask_clarification", "reject_request"] as const;
