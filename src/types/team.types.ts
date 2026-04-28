// ─────────────────────────────────────────────────────────────────────────────
// team.types.ts — mirrors team.controller.ts response shapes exactly
// ─────────────────────────────────────────────────────────────────────────────

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TeamRole = "LEAD" | "CO_LEAD" | "MEMBER";
export type NodeType = "MANAGEMENT" | "GROUP" | "INDIVIDUAL";
export type TeamCategory = "DELIVERY" | "SALES" | "SUPPORT" | "MANAGEMENT";
export type EdgeType = "ASSIGNS_TO" | "REPORTS_TO" | "VISIBILITY";
export type TeamMemberEvent = "JOINED" | "LEFT" | "REPLACED" | "DEACTIVATED";
export type RequirementStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "ON_HOLD"
  | "CLOSED"
  | "CANCELLED";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type SalaryType = "MONTHLY" | "ANNUAL" | "HOURLY" | "DAILY";
export type AssignmentType = "MANAGER" | "TEAM" | "INDIVIDUAL";
export type AssignmentStatus = "ACTIVE" | "REMOVED" | "REPLACED";
export type ClientStatus = "PENDING" | "ACTIVE" | "INACTIVE";
export type ClientCategory =
  | "PRODUCT"
  | "SERVICE"
  | "CONSULTING"
  | "STAFFING"
  | "GOVERNMENT"
  | "NGO"
  | "OTHER";

// ─── Shared ──────────────────────────────────────────────────────────────────

export interface UserMinimal {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  employeeId?: string | null;
}

// ─── GET /teams — list ────────────────────────────────────────────────────────

export interface TeamListItem {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  nodeType: NodeType;
  category: TeamCategory | null;
  parentTeamId: string | null;
  businessUnitId: string | null;
  createdAt: string;
  businessUnit: { id: string; name: string } | null;
  _count: { members: number };
  members: {
    id: string;
    teamRole: TeamRole;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      employeeId: string | null;
    };
  }[];
  // client-side only — populated when building tree
  children?: TeamListItem[];
}

export interface TeamListResponse {
  success: boolean;
  /** Tree (roots with children nested) */
  data: TeamListItem[];
  /** Every team flat — for dropdowns, search */
  flat: TeamListItem[];
}

// ─── GET /teams/:id — detail ─────────────────────────────────────────────────

export interface TeamEdge {
  id: string;
  edgeType: EdgeType;
  isActive: boolean;
  parentId: string;
  parent?: { id: string; name: string; nodeType: NodeType };
  childId: string;
  child?: { id: string; name: string; nodeType: NodeType };
}

export interface TeamMemberFull {
  id: string;
  teamRole: TeamRole;
  joinedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    employeeId: string | null;
    phone: string | null;
    role: { id: string; name: string };
  };
}

export interface TeamChildItem {
  id: string;
  name: string;
  nodeType: NodeType;
  category: TeamCategory | null;
  _count: { members: number };
  members: {
    teamRole: TeamRole;
    user: { id: string; firstName: string; lastName: string };
  }[];
}

export interface TeamClientAssignment {
  assignedAt: string;
  client: {
    id: string;
    name: string;
    category: ClientCategory | null;
    industry: string | null;
    status: ClientStatus;
    _count: { requirements: number };
  };
}

export interface TeamRequirementAssignment {
  id: string;
  assignmentType: AssignmentType;
  allocatedOpenings: number | null;
  filledOpenings: number;
  submissionsCount: number;
  interviewsCount: number;
  assignedAt: string;
  deadline: string | null;
  breachedAt: string | null;
  requirement: {
    id: string;
    reqCode: string;
    title: string;
    status: RequirementStatus;
    priority: Priority;
    totalOpenings: number;
    filledOpenings: number;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryType: SalaryType | null;
    respondBy: string | null;
    isRespondByBreached: boolean;
    client: { id: string; name: string };
  };
}

export interface TeamMemberHistoryEntry {
  id: string;
  event: TeamMemberEvent;
  eventAt: string;
  reason: string | null;
  userId: string;
  user: { id: string; firstName: string; lastName: string };
  performedById: string | null;
  performedBy: { id: string; firstName: string; lastName: string } | null;
}

export interface TeamVisibilityConfig {
  id: string;
  teamId: string;
  membersCanSeePeerReqs: boolean;
  leadCanSeeChildReqs: boolean;
  canSeeInboundReqs: boolean;
  canSeeOutboundReqs: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  nodeType: NodeType;
  category: TeamCategory | null;
  parentTeamId: string | null;
  createdAt: string;
  updatedAt: string;

  businessUnit: { id: string; name: string; isActive: boolean } | null;

  parentTeam: {
    id: string;
    name: string;
    nodeType: NodeType;
    category: TeamCategory | null;
    parentTeamId: string | null;
    parentTeam: { id: string; name: string; nodeType: NodeType } | null;
  } | null;

  childTeams: TeamChildItem[];
  members: TeamMemberFull[];

  /** Edges where this team is the child (relationships coming in from parent) */
  parentEdges: TeamEdge[];
  /** Edges where this team is the parent (relationships going out to children) */
  childEdges: TeamEdge[];

  visibilityConfig: TeamVisibilityConfig | null;

  clientAssignments: TeamClientAssignment[];
  requirementAssignments: TeamRequirementAssignment[];
  memberHistories: TeamMemberHistoryEntry[];

  _count: {
    members: number;
    childTeams: number;
    clientAssignments: number;
    requirementAssignments: number;
  };
}

export interface TeamDetailResponse {
  success: boolean;
  data: TeamDetail;
}

// ─── GET /teams/:id/members ───────────────────────────────────────────────────

export interface TeamMembersResponse {
  success: boolean;
  data: TeamMemberFull[];
}

// ─── GET /teams/:id/available-users ──────────────────────────────────────────

export interface AvailableUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string | null;
  role: { id: string; name: string };
}

export interface AvailableUsersResponse {
  success: boolean;
  data: AvailableUser[];
}

// ─── Mutation payloads ────────────────────────────────────────────────────────

export interface CreateTeamPayload {
  name: string;
  description?: string | null;
  nodeType?: NodeType;
  category?: TeamCategory | null;
  businessUnitId?: string | null;
  parentTeamId?: string | null;
}

export interface UpdateTeamPayload {
  name?: string;
  description?: string | null;
  nodeType?: NodeType;
  category?: TeamCategory | null;
  isActive?: boolean;
  parentTeamId?: string | null;
}

export interface AddTeamMembersPayload {
  members: Array<{ userId: string; teamRole?: TeamRole }>;
}

export interface UpdateMemberRolePayload {
  teamRole: TeamRole;
}

export interface RemoveMemberPayload {
  reason?: string;
}

export interface UpdateEdgePayload {
  isActive: boolean;
}

// ─── Mutation responses ───────────────────────────────────────────────────────

export interface TeamMutationResponse {
  success: boolean;
  message: string;
  data?: Partial<TeamDetail>;
}
