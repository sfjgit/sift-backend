// File: schemaNotes.ts
// Path: src/docs/schemaNotes.ts
//
// The plain-language layer of the schema page (Admin › Data map): which area each table belongs to,
// what it is, why it exists, and notes on the fields that matter. Keep it in step with schema.prisma —
// a table missing here shows under "Other" with no explanation (the page lists those).

export interface Domain {
  key: string;
  label: string;
  /** colour of the area on the map */
  color: string;
  /** where the area sits on the map (columns × rows of areas) */
  col: number;
  row: number;
  what: string;
  models: string[];
}

export const DOMAINS: Domain[] = [
  {
    key: "client", label: "Client (the core)", color: "#2563eb", col: 1, row: 0,
    what: "Every organisation we sell to — company, government body, institution. Only what EVERY client has lives here; each topic is an add-on.",
    models: ["Client", "ClientServiceLine", "ClientAssignment", "ClientKeyAccount", "ClientLocation"],
  },
  {
    key: "addons", label: "Client add-ons", color: "#7c3aed", col: 2, row: 0,
    what: "Optional topic tables any client can have (23 Nov 2026). A new topic = a new add-on table, never a table per business unit.",
    models: ["ClientRegistration", "ClientCsr", "ClientGovt", "ClientTechnology", "ClientCorporateFinancial"],
  },
  {
    key: "people", label: "People & SPOCs", color: "#0891b2", col: 0, row: 0,
    what: "A Person is a human, stored once. A SPOC row is that person's role at one client (designation, sales status, handler).",
    models: ["Person", "ClientSpoc", "ClientSpocAssignment"],
  },
  {
    key: "csr", label: "CSR data", color: "#e11d48", col: 2, row: 1,
    what: "What a company spends on CSR per financial year, its programmes and where they run, and the agencies that implement them.",
    models: ["ClientCsrFinancial", "ClientCsrProgram", "ClientCsrProgramSector", "ClientCsrProgramLocation", "CsrAgency", "ClientDocument"],
  },
  {
    key: "work", label: "Daily work", color: "#16a34a", col: 0, row: 1,
    what: "What the sales team does: notes, tasks, calls, meetings (with the full CASPA meeting form), and the client timeline.",
    models: ["ClientNote", "WorkTask", "MeetingDetail", "MeetingFile", "ClientActivity"],
  },
  {
    key: "pipeline", label: "Engines & outreach", color: "#d97706", col: 1, row: 1,
    what: "The AI engines (CSR reports, figures, SPOC finders, website check …): which steps exist, every run, and the email packs they draft.",
    models: ["PipelineStep", "StepRun", "StepRunEvent", "RunQuota", "ExternalService", "OutreachPack", "OutreachMessage"],
  },
  {
    key: "org", label: "Organisation & access", color: "#475569", col: 0, row: 2,
    what: "The company itself (tenant), its business units and service lines, people who log in, their roles and permissions, and pick-lists.",
    models: ["Tenant", "BusinessUnit", "ServiceLine", "Department", "Designation", "User", "UserBusinessUnit", "UserServiceLine", "Role", "RolePermission", "Lookup", "RefreshToken", "AuthLogs", "ImpersonationLog"],
  },
  {
    key: "ai", label: "AI assistant", color: "#9333ea", col: 1, row: 2,
    what: "The in-app assistant: conversations, what it may do, usage limits and costs, saved report / command templates.",
    models: ["AiThread", "AiTurn", "AiAnswerMemory", "AiModeSetting", "AiUserPreference", "AiQuotaPolicy", "AiUserQuotaOverride", "AiModelPricing", "AiAuditLog", "CommandTemplate", "ReportTemplate"],
  },
  {
    key: "system", label: "System & history", color: "#64748b", col: 2, row: 2,
    what: "Undo / recycle bin, audit, notifications, alerts, support tickets, saved table views, FAQs.",
    models: ["ChangeLog", "AuditLog", "Notification", "SystemAlert", "Ticket", "TicketAttachment", "TicketEvent", "SavedView", "Faq"],
  },
];

/** what / why per table (ⓘ on each box) */
export const MODEL_NOTES: Record<string, { what: string; why: string }> = {
  Client: { what: "One organisation we sell to. Type (Company / Government / Institution) is only a label.", why: "One table for every kind of client keeps lists, reports and AI simple; differences live in add-ons." },
  ClientServiceLine: { what: "Old link client ↔ service line. No longer used for display.", why: "Since 23 Nov a client's service lines come from its active SPOCs automatically — kept until the old builds are gone." },
  ClientAssignment: { what: "Who works this client (history kept: endedAt).", why: "Scope: what each salesperson sees follows their assignments." },
  ClientKeyAccount: { what: "A personal ★ key-account mark per user.", why: "Each salesperson flags their own important accounts." },
  ClientLocation: { what: "Offices: head office, branches, plants (with GPS).", why: "Branch finder, map, distance and regional filters." },
  ClientRegistration: { what: "Company registration (MCA): CIN, ownership (from the CIN: GOI = central, SGC = state), year, listing, market cap.", why: "Only companies have a CIN — so it is an add-on, not a Client column. Also how PSUs are recognised." },
  ClientCsr: { what: "CSR profile: role (donor / implementing agency / foundation), CSR eligible, foundation.", why: "Not every client does CSR; the CSR years and programmes hang off the client." },
  ClientGovt: { what: "Government body: tier, body type, parent body, nodal ministry, ministry / department, state skill body, tender portal, priority.", why: "B2G bodies need these; companies don't. Parent lives here (ministry → department), not on Client." },
  ClientTechnology: { what: "Tech stack per area (cloud, ERP, CRM, LMS, cyber …).", why: "KaaS sales: what they run decides what training fits." },
  ClientCorporateFinancial: { what: "Company figures per financial year (revenue, profit, net worth, capital).", why: "Sizing and CSR obligation (2% of profit)." },
  Person: { what: "A human, stored once — name, email, phone, LinkedIn.", why: "One person can be a SPOC at several clients (Infosys + Infosys Foundation). Before 23 Nov they were duplicated." },
  ClientSpoc: { what: "A person's role at one client: designation, sales status, handler, service line, approval.", why: "Sales state is per client; the contact details are kept in step with the Person." },
  ClientSpocAssignment: { what: "History of who handled a SPOC.", why: "Handover trail when a SPOC moves between salespeople." },
  ClientCsrFinancial: { what: "CSR per financial year: obligation (2%), fund, spent, unspent.", why: "The heart of CSR selling; locked rows are confirmed by a person and never overwritten by engines." },
  ClientCsrProgram: { what: "One CSR programme from the annual report: FY, name, budget, spent, agency.", why: "Shows what a company funds and where — the pitch." },
  ClientCsrProgramSector: { what: "Sectors a programme covers.", why: "Filter: 'spends on education'." },
  ClientCsrProgramLocation: { what: "States / districts a programme runs in.", why: "Filter: 'spends in Karnataka'." },
  CsrAgency: { what: "Implementing agencies (NGOs) that run programmes.", why: "Who executes a company's CSR." },
  ClientDocument: { what: "Reports and files per FY (BRSR, CSR report, annual report …) in S3.", why: "Source of figures and programmes; the engines read them." },
  ClientNote: { what: "Comments on a client or one SPOC.", why: "Team memory, shown on the timeline." },
  WorkTask: { what: "Tasks, calls, follow-ups and meetings with due dates.", why: "My work lists, reminders on the phone, reports." },
  MeetingDetail: { what: "The full meeting form behind a meeting task (CASPA add_meeting).", why: "Minutes, proposal, MOU, visit check-in, lead approval." },
  MeetingFile: { what: "Files of a meeting (MOM, proposal, MOU …).", why: "Kept with the meeting." },
  ClientActivity: { what: "The client timeline: who did what, when.", why: "History everyone sees on the client page." },
  PipelineStep: { what: "The engine steps that exist (reports, figures, SPOC finders, website check …).", why: "Run buttons and permissions are built from this list." },
  StepRun: { what: "One run of a step on a client, its status and results.", why: "What ran, what it found, what it changed." },
  StepRunEvent: { what: "Progress events of a run.", why: "Live progress and debugging." },
  RunQuota: { what: "How many runs a user may start per period.", why: "Engine cost control." },
  ExternalService: { what: "Registered engines and their keys.", why: "Engines call back into the CRM securely." },
  OutreachPack: { what: "A set of drafted emails for a client.", why: "Engines draft; people review; n8n sends." },
  OutreachMessage: { what: "One drafted email to a SPOC.", why: "Review and track sending." },
  Tenant: { what: "The company using the CRM (SFJBS).", why: "Every row belongs to a tenant — the CRM can serve more than one company." },
  BusinessUnit: { what: "B2B, B2G, B2I.", why: "Who sells; drives the list views and scopes." },
  ServiceLine: { what: "KaaS, TaaS, CSR.", why: "What we sell; on SPOCs, so clients get theirs automatically." },
  User: { what: "Someone who logs in.", why: "Roles, scopes, reporting line (org chart)." },
  Role: { what: "A set of permissions with scopes.", why: "Who may do what, and over whose records." },
  RolePermission: { what: "One permission of a role.", why: "Fine-grained access." },
  Lookup: { what: "Every pick-list (industry, category, sales status, body type …).", why: "Admins add values without code." },
  ChangeLog: { what: "Every write's before-image.", why: "Recycle bin and undo." },
  AuditLog: { what: "Security / admin actions.", why: "Who changed access, exported, impersonated." },
};

/** notes on single fields (ⓘ in the field list) — "Model.field" */
export const FIELD_NOTES: Record<string, string> = {
  "Client.entityType": "Organisation type — a label (Company / Government / Institution). Finer kinds live in add-ons (government body type, ownership).",
  "Client.csrFy": "Cache: newest FY with CSR spent — kept by the snapshot job so lists sort without a join.",
  "Client.csrSpentRs": "Cache: that FY's CSR spent (₹).",
  "Client.cin": "OLD — moved to ClientRegistration.cin; mirrored until the next deploy, then dropped.",
  "Client.csrEligible": "OLD — moved to ClientCsr; mirrored until the next deploy.",
  "Client.groupName": "Company group (Adani Group …) — CSR is often decided at group level.",
  "Client.businessUnitId": "The client's business unit (B2B / B2G / B2I) — the list's view switch filters on it.",
  "Client.email": "The organisation's own office email (people's emails are on SPOCs).",
  "ClientSpoc.personId": "The human behind this role. Same person at another client = another SPOC row, same Person.",
  "ClientSpoc.email": "Copy of the Person's email; unique per client.",
  "ClientSpoc.serviceLineId": "KaaS / TaaS / CSR — the client's service lines are the set of these.",
  "ClientSpoc.handlerId": "The salesperson who owns this contact.",
  "ClientSpoc.approvalStatus": "Engine-found SPOCs start PENDING until a lead approves.",
  "Person.email": "Unique per tenant; only personal mailboxes (not csr@ / info@).",
  "ClientRegistration.ownership": "Read from the CIN: GOI = central govt, SGC = state govt (PSUs).",
  "ClientGovt.parentClientId": "Administrative parent (ministry → department → mission).",
  "ClientGovt.nodalMinistryId": "Functional mapping — not the ownership chain.",
  "ClientCsrFinancial.isLocked": "Confirmed by a person — engines never overwrite it.",
  "ClientCsrFinancial.fy": "Always '2025-2026'.",
  "WorkTask.kind": "TASK / CALL / MEETING …",
};
