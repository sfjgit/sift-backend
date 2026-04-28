// types/role.types.ts

export type PermissionScope = "OWN" | "TEAM" | "MANAGER" | "BU" | "ALL";

// ── Permission row ────────────────────────────────────────────────────────────

export interface RolePermission {
  id?: string;
  module: string;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  scope: PermissionScope;
}

// ── Role — list item ──────────────────────────────────────────────────────────

export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: RolePermission[];
  _count: {
    users: number;
    permissions: number;
  };
}

// ── Role — full detail ────────────────────────────────────────────────────────

export interface RoleDetail {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: RolePermission[];
  users: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    employeeId: string | null;
    businessUnit: { id: string; name: string } | null;
  }[];
  _count: {
    users: number;
    permissions: number;
  };
}

// ── API responses ─────────────────────────────────────────────────────────────

export interface RolesListResponse {
  success: boolean;
  data: RoleListItem[];
}

export interface RoleDetailResponse {
  success: boolean;
  data: RoleDetail;
}

export interface ModulesResponse {
  success: boolean;
  data: string[]; // distinct module names from DB
}

export interface RoleMutationResponse {
  success: boolean;
  data?: Partial<RoleListItem>;
  message: string;
}

// ── Form payloads ─────────────────────────────────────────────────────────────

export interface PermissionRowPayload {
  module: string;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  scope: PermissionScope;
}

export interface CreateRolePayload {
  name: string;
  description: string | null;
  permissions: PermissionRowPayload[];
}

export interface UpdateRolePayload {
  name?: string;
  description?: string | null;
  permissions?: PermissionRowPayload[];
}

// ── Scope options for select ──────────────────────────────────────────────────

export const SCOPE_OPTIONS: { value: PermissionScope; label: string }[] = [
  { value: "OWN", label: "Own" },
  { value: "TEAM", label: "Team" },
  { value: "MANAGER", label: "Manager" },
  { value: "BU", label: "BU" },
  { value: "ALL", label: "All" },
];

// ── Format module name for display ───────────────────────────────────────────

export function formatModule(module: string): string {
  return module.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
