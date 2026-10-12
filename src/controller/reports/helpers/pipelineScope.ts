// File: pipelineScope.ts
// Path: src/controller/reports/helpers/pipelineScope.ts

import { Request } from "express";
import { resolveOrgTreeDown } from "../reports.controller";
// import { resolveOrgTreeDown } from "@/utils/orgTree"; // ← use your existing import path

type Q = Record<string, string | string[] | undefined>;

const str = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Single source of truth for "whose candidates count" in reports.
 * pipelineUserIds === null → no restriction (super admin, no filters).
 * pipelineUserIds === []   → scoped user picked someone outside their tree → nothing.
 */
export async function resolvePipelineScope(req: Request, q: Q) {
  const creatorIds = await resolveOrgTreeDown(
    req.user!.id,
    req.user!.isSuperAdmin
  );

  const requestedCreatorId = str(q.createdById)?.trim() || null;
  const effectiveCreatorIds: string[] | null =
    creatorIds === null
      ? requestedCreatorId
        ? [requestedCreatorId]
        : null
      : requestedCreatorId
      ? creatorIds.includes(requestedCreatorId)
        ? [requestedCreatorId]
        : []
      : creatorIds;

  let teamUserIds: string[] | null = null;
  const teamIds = (str(q.userIds) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (teamIds.length > 0) {
    teamUserIds =
      effectiveCreatorIds === null
        ? teamIds
        : teamIds.filter((id) => effectiveCreatorIds.includes(id));
  }

  const pipelineUserIds: string[] | null = teamUserIds ?? effectiveCreatorIds;
  const pipelineOwnerWhere: Record<string, any> =
    pipelineUserIds === null ? {} : { recruiterId: { in: pipelineUserIds } };

  return {
    effectiveCreatorIds,
    teamUserIds,
    pipelineUserIds,
    pipelineOwnerWhere,
  };
}
