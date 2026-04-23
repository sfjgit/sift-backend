// constants/scopes.ts

export const PERMISSION_SCOPE = {
  OWN: "OWN", // only records you created or assigned to you
  TEAM: "TEAM", // your team's records
  MANAGER: "MANAGER", // all teams + recruiters under your assignment chain
  BU: "BU", // everything in your business unit
  ALL: "ALL", // superadmin
} as const;

export const MODULES = {
  USERS: "users",
  TEAMS: "teams",
  BUSINESS_UNITS: "business_units",
  CLIENTS: "clients",
  REQUIREMENTS: "requirements",
  REPORTS: "reports",
  SETTINGS: "settings",
} as const;

export const ASSIGNMENT_TYPE = {
  MANAGER: "MANAGER",
  TEAM: "TEAM",
  INDIVIDUAL: "INDIVIDUAL",
} as const;

export const TEAM_CATEGORY = {
  MANAGEMENT: "MANAGEMENT",
  SALES: "SALES",
  DELIVERY: "DELIVERY",
  SUPPORT: "SUPPORT",
} as const;

export const TEAM_ROLE = {
  LEAD: "LEAD",
  CO_LEAD: "CO_LEAD",
  MEMBER: "MEMBER",
} as const;
