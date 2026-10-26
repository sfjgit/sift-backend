// File: permissions.registry.ts
// Path: src/config/permissions.registry.ts
//
// Source of truth for what modules + actions exist. The DB stores grants only
// (RolePermission.permissionKey = "spocs.assign"). One module per resource in
// schema.prisma; verbs follow read / create / update / delete, plus
// domain actions (approve, assign, export, ...).
//
// scoped: true   → works on records, OWN/TEAM/... applies
// scoped: false  → yes/no only (field visibility, global/admin actions)
// requires       → grants that must also be ticked; enforced when a role is saved
// reserved: true → defined so roles can be set up now, but no endpoint checks it yet
//
// Copy this file into the frontend at src/config/ for the PermissionKey type.

type Action = {
  label: string;
  scoped: boolean;
  requires?: readonly string[];
  reserved?: true;
};

type Module = {
  label: string;
  group: "CRM" | "Insights" | "Administration";
  order: number;
  description: string;
  actions: Record<string, Action>;
};

export const MODULES = {
  // ── CRM ────────────────────────────────────────────────────────────────────
  clients: {
    label: "Clients",
    group: "CRM",
    order: 1,
    description: "Company master. Visible if you created it or can see one of its SPOCs.",
    actions: {
      read: { label: "View", scoped: true },
      create: { label: "Add", scoped: false },
      update: { label: "Edit", scoped: true, requires: ["clients.read"] },
      delete: { label: "Delete", scoped: true, requires: ["clients.read"] },
      approve: { label: "Approve / change status", scoped: false, requires: ["clients.read"] },
      export: { label: "Export", scoped: true, requires: ["clients.read"], reserved: true },
    },
  },
  client_locations: {
    label: "Client locations",
    group: "CRM",
    order: 2,
    description: "Addresses, offices and plants of a client.",
    actions: {
      create: { label: "Add", scoped: true, requires: ["clients.read"] },
      update: { label: "Edit", scoped: true, requires: ["clients.read"] },
      delete: { label: "Remove", scoped: true, requires: ["clients.read"] },
    },
  },
  client_technologies: {
    label: "Client technologies",
    group: "CRM",
    order: 3,
    description: "Tech stack per category (cloud, ERP, CRM ...).",
    actions: {
      update: { label: "Add / edit", scoped: true, requires: ["clients.read"] },
      delete: { label: "Remove", scoped: true, requires: ["clients.read"] },
    },
  },
  client_notes: {
    label: "Client notes",
    group: "CRM",
    order: 4,
    description: "Notes are read with the client. Authors can always delete their own.",
    actions: {
      create: { label: "Add", scoped: true, requires: ["clients.read"] },
      delete_any: { label: "Delete others' notes", scoped: false, requires: ["clients.read"] },
    },
  },
  client_documents: {
    label: "Client documents",
    group: "CRM",
    order: 5,
    description: "CSR policies, annual reports and other filings.",
    actions: {
      read: { label: "View / download", scoped: true, requires: ["clients.read"] },
      upload: { label: "Upload", scoped: true, requires: ["client_documents.read"], reserved: true },
      delete: { label: "Delete", scoped: true, requires: ["client_documents.read"], reserved: true },
    },
  },
  client_financials: {
    label: "CSR financials",
    group: "CRM",
    order: 6,
    description: "Obligation, budget, spent and unspent figures per FY.",
    actions: {
      read: { label: "View", scoped: false, requires: ["clients.read"] },
      update: { label: "Edit / lock", scoped: true, requires: ["client_financials.read"], reserved: true },
    },
  },
  client_programs: {
    label: "CSR programs",
    group: "CRM",
    order: 7,
    description: "Programs a client funds, per FY and sector.",
    actions: {
      read: { label: "View", scoped: false, requires: ["clients.read"] },
    },
  },
  spocs: {
    label: "Client SPOCs",
    group: "CRM",
    order: 8,
    description: "Contacts at clients. Ownership follows the handler.",
    actions: {
      read: { label: "View", scoped: true },
      create: { label: "Add", scoped: true, requires: ["spocs.read"] },
      update: { label: "Edit", scoped: true, requires: ["spocs.read"] },
      delete: { label: "Deactivate", scoped: true, requires: ["spocs.read"] },
      assign: { label: "Assign / reassign", scoped: true, requires: ["spocs.read"] },
      export: { label: "Export", scoped: true, requires: ["spocs.read"], reserved: true },
      view_contact: { label: "See email / phone", scoped: false, requires: ["spocs.read"] },
    },
  },
  outreach: {
    label: "Outreach",
    group: "CRM",
    order: 9,
    description: "Generated outreach packs and mail sequences.",
    actions: {
      read: { label: "View", scoped: true, requires: ["clients.read"] },
      generate: { label: "Generate", scoped: true, requires: ["outreach.read"], reserved: true },
    },
  },
  step_runs: {
    label: "Pipeline steps",
    group: "CRM",
    order: 10,
    description: "Enrichment runs sent to the CSR pipeline.",
    actions: {
      read: { label: "View runs", scoped: true },
      run: { label: "Run steps", scoped: false, requires: ["step_runs.read"], reserved: true },
      cancel: { label: "Stop runs", scoped: true, requires: ["step_runs.read"], reserved: true },
    },
  },

  // ── Insights ───────────────────────────────────────────────────────────────
  reports: {
    label: "Reports",
    group: "Insights",
    order: 20,
    description: "Dashboards and activity feed. Figures stay limited to your client / SPOC scope.",
    actions: {
      read: { label: "View", scoped: false },
      export: { label: "Export", scoped: false, requires: ["reports.read"], reserved: true },
    },
  },
  views: {
    label: "Saved views",
    group: "Insights",
    order: 21,
    description: "Everyone can save personal views; sharing makes them visible to all.",
    actions: {
      share: { label: "Share with everyone", scoped: false },
    },
  },

  // ── Administration ─────────────────────────────────────────────────────────
  users: {
    label: "Users",
    group: "Administration",
    order: 30,
    description: "Accounts, reporting lines, BU / service line membership.",
    actions: {
      read: { label: "View", scoped: true },
      create: { label: "Add", scoped: false, requires: ["users.read"] },
      update: { label: "Edit", scoped: false, requires: ["users.read"] },
      deactivate: { label: "Activate / deactivate", scoped: false, requires: ["users.read"] },
      reset_password: { label: "Reset password", scoped: false, requires: ["users.read"] },
    },
  },
  roles: {
    label: "Roles & permissions",
    group: "Administration",
    order: 31,
    description: "Super admin always has every permission.",
    actions: {
      read: { label: "View", scoped: false },
      create: { label: "Add", scoped: false, requires: ["roles.read"] },
      update: { label: "Edit", scoped: false, requires: ["roles.read"] },
      delete: { label: "Delete", scoped: false, requires: ["roles.read"] },
      assign_permissions: { label: "Change permissions", scoped: false, requires: ["roles.read"] },
    },
  },
  org: {
    label: "Org structure",
    group: "Administration",
    order: 32,
    description: "Business units, service lines, departments, designations.",
    actions: {
      manage: { label: "Add / edit / deactivate", scoped: false },
    },
  },
  lookups: {
    label: "Lookups",
    group: "Administration",
    order: 33,
    description: "Pick-lists: industries, categories, sources, sales statuses ...",
    actions: {
      manage: { label: "Add / edit / deactivate", scoped: false },
    },
  },
  integrations: {
    label: "Integrations",
    group: "Administration",
    order: 34,
    description: "External services and pipeline step configuration.",
    actions: {
      manage: { label: "Configure", scoped: false, reserved: true },
    },
  },
  audit: {
    label: "Audit",
    group: "Administration",
    order: 35,
    description: "Who did what, and login history.",
    actions: {
      view_login_history: { label: "View login history", scoped: false },
      view_audit_log: { label: "View audit log", scoped: false },
    },
  },
  help: {
    label: "Help & FAQs",
    group: "Administration",
    order: 36,
    description: "Reading help is open to everyone.",
    actions: {
      manage: { label: "Write / publish", scoped: false },
    },
  },
} as const satisfies Record<string, Module>;

type M = typeof MODULES;
export type ModuleKey = keyof M;
export type PermissionKey = {
  [K in ModuleKey]: `${K}.${keyof M[K]["actions"] & string}`;
}[ModuleKey];

const actionOf = (key: PermissionKey): Action => {
  const [mod, action] = key.split(".") as [ModuleKey, string];
  return (MODULES[mod].actions as Record<string, Action>)[action]!;
};

export const ALL_PERMISSION_KEYS = (Object.keys(MODULES) as ModuleKey[]).flatMap((mod) =>
  Object.keys(MODULES[mod].actions).map((a) => `${mod}.${a}` as PermissionKey),
);

export const isPermissionKey = (k: string): k is PermissionKey =>
  (ALL_PERMISSION_KEYS as string[]).includes(k);

export const isScopedAction = (key: PermissionKey): boolean => actionOf(key).scoped;

export const requiredBy = (key: PermissionKey): PermissionKey[] =>
  (actionOf(key).requires ?? []) as PermissionKey[];

// grants whose prerequisites aren't in the same set → [{ key, missing[] }]
export const findMissingRequirements = (keys: PermissionKey[]) => {
  const set = new Set(keys);
  return keys
    .map((key) => ({ key, missing: requiredBy(key).filter((r) => !set.has(r)) }))
    .filter((x) => x.missing.length);
};

export const SCOPE_DESCRIPTIONS = {
  OWN: "Only records I own",
  TEAM: "Me + users whose team lead is me",
  REPORTING: "Me + my direct reports",
  REPORTING_LINE: "Me + my entire reporting hierarchy",
  DEPARTMENT: "Everyone in my department",
  BU: "Everyone in my business units",
  ALL: "All records",
} as const;

// Keys renamed or split from the previous registry — used by
// scripts/permissions.migrate.ts to carry existing grants over.
export const LEGACY_KEY_MAP: Record<string, PermissionKey[]> = {
  "clients.view_financials": ["client_financials.read"],
  "admin.manage_users": ["users.create", "users.update", "users.deactivate", "users.reset_password"],
  "admin.manage_roles": ["roles.read", "roles.create", "roles.update", "roles.delete", "roles.assign_permissions"],
  "admin.manage_lookups": ["lookups.manage", "org.manage"],
  "admin.view_auth_logs": ["audit.view_login_history"],
  "admin.manage_help": ["help.manage"],
};

// What used to be covered implicitly by a broader key. A role holding the
// left key also gets the right keys, at the same scope.
export const IMPLIED_BY_LEGACY: Partial<Record<PermissionKey, PermissionKey[]>> = {
  "clients.read": [
    "client_notes.create",
    "client_documents.read",
    "client_programs.read",
    "outreach.read",
    "reports.read",
  ],
  "clients.update": [
    "client_locations.create",
    "client_locations.update",
    "client_locations.delete",
    "client_technologies.update",
    "client_technologies.delete",
  ],
};
