// File: requirement.constants.ts
// Path: src/constants/requirement.constants.ts

import { RequirementStatus } from "@prisma/client";

export const STATUS_FLOW: Record<RequirementStatus, RequirementStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "CLOSED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CLOSED", "CANCELLED"],
  CLOSED: ["ACTIVE", "ON_HOLD"],
  CANCELLED: ["DRAFT", "ACTIVE"],
};

// statuses that represent a terminated requirement
export const TERMINAL_STATUSES: RequirementStatus[] = ["CLOSED", "CANCELLED"];

// statuses where the requirement is live and should accept pipeline movement
export const LIVE_STATUSES: RequirementStatus[] = [
  "ACTIVE",
  "ON_HOLD",
  "PENDING_APPROVAL",
];

export const REASON_REQUIRED_FROM: RequirementStatus[] = [
  "CLOSED",
  "CANCELLED",
];
