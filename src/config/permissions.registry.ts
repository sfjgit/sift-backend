// File: permissions.registry.ts
// Path: src/config/permissions.registry.ts
//
// Source of truth for what modules + actions exist. The DB stores grants only
// (RolePermission.permissionKey = "spocs.assign").
//
// scoped: true  → works on records, OWN/TEAM/... applies
// scoped: false → yes/no only (field visibility, global actions)
//
// Copy this file into the frontend at src/config/ for the PermissionKey type.

export const MODULES = {
  clients: {
    label: "Clients",
    order: 1,
    actions: {
      read: { label: "View", scoped: true },
      create: { label: "Add", scoped: false },
      update: { label: "Edit", scoped: true },
      delete: { label: "Delete", scoped: true },
      approve: { label: "Approve / change status", scoped: false },
      view_financials: { label: "See CSR figures", scoped: false },
    },
  },
  spocs: {
    label: "Client SPOCs",
    order: 2,
    actions: {
      read: { label: "View", scoped: true },
      create: { label: "Add", scoped: true },
      update: { label: "Edit", scoped: true },
      delete: { label: "Delete", scoped: true },
      assign: { label: "Assign", scoped: true },
      view_contact: { label: "See email / phone", scoped: false },
    },
  },
  step_runs: {
    label: "Pipeline steps",
    order: 3,
    actions: {
      read: { label: "View runs", scoped: true },
      run: { label: "Run steps", scoped: false },
    },
  },
  users: {
    label: "Users",
    order: 4,
    actions: {
      read: { label: "View", scoped: true },
    },
  },
  admin: {
    label: "Administration",
    order: 9,
    actions: {
      manage_users: { label: "Manage users", scoped: false },
      manage_roles: { label: "Manage roles", scoped: false },
      manage_lookups: { label: "Manage lookups & org masters", scoped: false },
      view_auth_logs: { label: "View login history", scoped: false },
    },
  },
} as const;

type M = typeof MODULES;
export type ModuleKey = keyof M;
export type PermissionKey = {
  [K in ModuleKey]: `${K}.${keyof M[K]["actions"] & string}`;
}[ModuleKey];

export const ALL_PERMISSION_KEYS = (Object.keys(MODULES) as ModuleKey[]).flatMap(
  (mod) =>
    Object.keys(MODULES[mod].actions).map((a) => `${mod}.${a}` as PermissionKey),
);

export const isPermissionKey = (k: string): k is PermissionKey =>
  (ALL_PERMISSION_KEYS as string[]).includes(k);

export const isScopedAction = (key: PermissionKey): boolean => {
  const [mod, action] = key.split(".") as [ModuleKey, string];
  const actions = MODULES[mod].actions as Record<string, { scoped: boolean }>;
  return actions[action]?.scoped ?? false;
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
