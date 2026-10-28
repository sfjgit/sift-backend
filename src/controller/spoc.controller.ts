// File: spoc.controller.ts
// Path: src/controller/spoc.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { isUserInScope, spocScopeWhere } from "@/services/scope.service";
import { assertLookups } from "@/services/lookup.service";
import { logClientActivity } from "@/services/clientActivity.service";
import { toNameKey } from "@/utils/names";
import { notifyUsers } from "@/services/notification.service";
import type { PermissionMap } from "@/services/permission.service";
import { definedOnly, pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError, notFound } from "@/utils/httpError";
import type {
  BulkAssignSpocsInput,
  CreateSpocInput,
  ListSpocsQuery,
  SpocApprovalInput,
  UpdateSpocInput,
} from "@/validators/client.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;
const LOOKUP = { id: true, code: true, label: true } as const;

const SPOC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  designation: true,
  department: true,
  linkedinUrl: true,
  seniority: true,
  totalExpYears: true,
  currentOrgExpYears: true,
  emailStatus: true,
  validationScore: true,
  validationBand: true,
  validatedAt: true,
  validationChecks: true,
  fieldSources: true,
  reviewFlag: true,
  reviewReason: true,
  approvalStatus: true,
  approvedAt: true,
  approvalNote: true,
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  isPrimary: true,
  isActive: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
  handler: { select: PERSON },
  addedBy: { select: PERSON },
  businessUnit: { select: { id: true, name: true } },
  serviceLine: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, city: true, state: true } },
  source: { select: LOOKUP },
  emailSource: { select: LOOKUP },
  salesStatus: { select: LOOKUP },
} as const satisfies Prisma.ClientSpocSelect;

// ── field mask ───────────────────────────────────────────────────────────────

export const toSpocResponse = <T extends { email: string | null; phone: string | null }>(
  spoc: T,
  map: PermissionMap,
): T => (map["spocs.view_contact"] ? spoc : { ...spoc, email: null, phone: null });

const spocLookups = (body: UpdateSpocInput) =>
  assertLookups({
    sourceId: [body.sourceId, "SPOC_SOURCE"],
    emailSourceId: [body.emailSourceId, "EMAIL_SOURCE"],
    salesStatusId: [body.salesStatusId, "SALES_STATUS"],
  });

// location must be an active address of the SPOC's own client
const assertLocation = async (clientId: string, locationId: string | null | undefined) => {
  if (!locationId) return;
  const found = await prisma.clientLocation.count({
    where: { id: locationId, clientId, isActive: true },
  });
  if (!found) throw ApiError(400, "Location does not belong to this client", "INVALID_LOCATION");
};

// SPOC by id within the caller's scope for this action — out of scope = 404
const findSpocInScope = async (req: Request, id: string) => {
  const spoc = await prisma.clientSpoc.findFirst({
    where: { id, ...(await spocScopeWhere(req.user, req.scope!)) },
    select: {
      id: true,
      clientId: true,
      firstName: true,
      lastName: true,
      handlerId: true,
      isActive: true,
      client: { select: { name: true } },
    },
  });
  if (!spoc) throw notFound("SPOC");
  return spoc;
};

// handler must be an active user inside the caller's scope
const assertAssignable = async (req: Request, userId: string) => {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  if (!target?.isActive) throw ApiError(400, "Handler not found or inactive", "INVALID_HANDLER");
  if (!(await isUserInScope(req.user, req.scope!, userId))) {
    throw ApiError(403, "Cannot assign to this user", "FORBIDDEN");
  }
};

// ── GET /spocs
export const listSpocs = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListSpocsQuery;

  const where: Prisma.ClientSpocWhereInput = {
    AND: [
      await spocScopeWhere(req.user, req.scope!),
      {
        isActive: q.isActive,
        client: { deletedAt: null },
        ...(q.clientId && { clientId: q.clientId }),
        ...(q.handlerId?.length && { handlerId: { in: q.handlerId } }),
        ...(q.businessUnitId?.length && { businessUnitId: { in: q.businessUnitId } }),
        ...(q.serviceLineId?.length && { serviceLineId: { in: q.serviceLineId } }),
        ...(q.salesStatusId?.length && { salesStatusId: { in: q.salesStatusId } }),
        ...(q.emailStatus?.length && { emailStatus: { in: q.emailStatus } }),
        ...(q.validationBand?.length && { validationBand: { in: q.validationBand } }),
        ...(q.approvalStatus?.length && { approvalStatus: { in: q.approvalStatus } }),
        ...(q.reviewFlag !== undefined && { reviewFlag: q.reviewFlag }),
        ...(q.search && {
          OR: (["firstName", "lastName", "email", "designation"] as const).map((field) => ({
            [field]: { contains: q.search, mode: "insensitive" },
          })),
        }),
      },
    ],
  };

  const [total, spocs] = await Promise.all([
    prisma.clientSpoc.count({ where }),
    prisma.clientSpoc.findMany({
      where,
      select: SPOC_SELECT,
      orderBy: { [q.sortBy]: q.sortDir },
      ...toSkipTake(q),
    }),
  ]);

  res.json({
    success: true,
    data: spocs.map((s) => toSpocResponse(s, req.permissions!)),
    meta: pageMeta(total, q.page, q.limit),
  });
};

// ── GET /spocs/:id — includes handler history
export const getSpocById = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const spoc = await prisma.clientSpoc.findFirst({
    where: { id, ...(await spocScopeWhere(req.user, req.scope!)) },
    select: {
      ...SPOC_SELECT,
      validationChecks: true,
      assignments: {
        select: {
          id: true,
          reason: true,
          assignedAt: true,
          endedAt: true,
          assignedTo: { select: PERSON },
          assignedBy: { select: PERSON },
        },
        orderBy: { assignedAt: "desc" },
      },
    },
  });
  if (!spoc) throw notFound("SPOC");

  res.json({ success: true, data: toSpocResponse(spoc, req.permissions!) });
};

// ── POST /spocs — handler must be in the caller's spocs.create scope
export const createSpoc = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateSpocInput;

  const client = await prisma.client.findFirst({
    where: { id: body.clientId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!client) throw notFound("Client");

  await assertAssignable(req, body.handlerId);
  await spocLookups(body);
  await assertLocation(client.id, body.locationId);

  const spoc = await prisma.$transaction(async (tx) => {
    const s = await tx.clientSpoc.create({
      data: {
        ...definedOnly(body),
        nameKey: toNameKey(body.firstName, body.lastName),
        addedById: req.user.id,
        // added by a person = already vetted; pipeline SPOCs start PENDING
        approvalStatus: "APPROVED",
        approvedById: req.user.id,
        approvedAt: new Date(),
        assignments: {
          create: { assignedToId: body.handlerId, assignedById: req.user.id },
        },
      },
      select: SPOC_SELECT,
    });

    const name = `${s.firstName} ${s.lastName ?? ""}`.trim();

    await logClientActivity(tx, {
      clientId: client.id,
      spocId: s.id,
      actorId: req.user.id,
      type: "SPOC_ADDED",
      summary: `SPOC ${name} added`,
    });

    await notifyUsers(tx, [body.handlerId], req.user.id, {
      type: "SPOC_ASSIGNED",
      title: `New SPOC assigned: ${name}`,
      body: `${client.name}`,
      referenceId: s.id,
      referenceType: "SPOC",
    });

    return s;
  });

  res.status(201).json({
    success: true,
    message: "SPOC added",
    data: toSpocResponse(spoc, req.permissions!),
  });
};

// ── PATCH /spocs/:id
export const updateSpoc = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateSpocInput;

  const existing = await findSpocInScope(req, id);
  await spocLookups(body);
  await assertLocation(existing.clientId, body.locationId);

  const data: Prisma.ClientSpocUncheckedUpdateInput = definedOnly(body);

  if (body.firstName !== undefined || body.lastName !== undefined) {
    data.nameKey = toNameKey(
      body.firstName ?? existing.firstName,
      body.lastName !== undefined ? body.lastName : existing.lastName,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.clientSpoc.update({ where: { id }, data, select: SPOC_SELECT });

    await logClientActivity(tx, {
      clientId: existing.clientId,
      spocId: id,
      actorId: req.user.id,
      type: "SPOC_UPDATED",
      summary: `Updated ${Object.keys(data).filter((k) => k !== "nameKey").join(", ")}`,
    });

    return s;
  });

  res.json({
    success: true,
    message: "SPOC updated",
    data: toSpocResponse(updated, req.permissions!),
  });
};

// ── PATCH /spocs/:id/assign — record in scope AND target in scope
export const assignSpoc = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { assignToId, reason } = req.validatedBody;

  const spoc = await findSpocInScope(req, id);
  if (!spoc.isActive) throw ApiError(400, "SPOC is inactive", "SPOC_INACTIVE");
  if (spoc.handlerId === assignToId) {
    throw ApiError(400, "SPOC is already assigned to this user", "SAME_HANDLER");
  }
  await assertAssignable(req, assignToId);

  const now = new Date();
  const name = `${spoc.firstName} ${spoc.lastName ?? ""}`.trim();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.clientSpocAssignment.updateMany({
      where: { spocId: id, endedAt: null },
      data: { endedAt: now },
    });
    await tx.clientSpocAssignment.create({
      data: {
        spocId: id,
        assignedToId: assignToId,
        assignedById: req.user.id,
        reason: reason ?? null,
        assignedAt: now,
      },
    });

    const s = await tx.clientSpoc.update({
      where: { id },
      data: { handlerId: assignToId },
      select: SPOC_SELECT,
    });

    await logClientActivity(tx, {
      clientId: spoc.clientId,
      spocId: id,
      actorId: req.user.id,
      type: "SPOC_REASSIGNED",
      summary: `SPOC ${name} reassigned`,
      meta: { fromUserId: spoc.handlerId, toUserId: assignToId, reason: reason ?? null },
    });

    await notifyUsers(tx, [assignToId], req.user.id, {
      type: "SPOC_ASSIGNED",
      title: `SPOC assigned to you: ${name}`,
      body: spoc.client.name,
      referenceId: id,
      referenceType: "SPOC",
    });

    return s;
  });

  res.json({
    success: true,
    message: "SPOC reassigned",
    data: toSpocResponse(updated, req.permissions!),
  });
};

// ── DELETE /spocs/:id — soft: deactivate, history stays
export const deleteSpoc = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const spoc = await findSpocInScope(req, id);
  if (!spoc.isActive) throw ApiError(400, "SPOC is already inactive", "SPOC_INACTIVE");

  await prisma.$transaction(async (tx) => {
    await tx.clientSpoc.update({ where: { id }, data: { isActive: false } });
    await logClientActivity(tx, {
      clientId: spoc.clientId,
      spocId: id,
      actorId: req.user.id,
      type: "SPOC_UPDATED",
      summary: `SPOC ${`${spoc.firstName} ${spoc.lastName ?? ""}`.trim()} deactivated`,
    });
  });

  res.json({ success: true, message: "SPOC removed" });
};

// ── PATCH /spocs/bulk-assign — assignSpoc's rules per SPOC; one notification
export const bulkAssignSpocs = async (req: Request, res: Response) => {
  const { spocIds, assignToId, reason } = req.validatedBody as BulkAssignSpocsInput;

  // target is the same for every row — a bad target fails the whole request
  await assertAssignable(req, assignToId);

  const found = await prisma.clientSpoc.findMany({
    where: { id: { in: spocIds }, ...(await spocScopeWhere(req.user, req.scope!)) },
    select: {
      id: true,
      clientId: true,
      firstName: true,
      lastName: true,
      handlerId: true,
      isActive: true,
    },
  });
  const byId = new Map(found.map((s) => [s.id, s]));

  const skipped: { id: string; reason: string }[] = [];
  const eligible: typeof found = [];
  for (const id of spocIds) {
    const s = byId.get(id);
    // out of scope looks the same as missing
    if (!s) skipped.push({ id, reason: "SPOC not found" });
    else if (!s.isActive) skipped.push({ id, reason: "SPOC is inactive" });
    else if (s.handlerId === assignToId) {
      skipped.push({ id, reason: "SPOC is already assigned to this user" });
    } else eligible.push(s);
  }

  if (eligible.length) {
    const now = new Date();
    const ids = eligible.map((s) => s.id);

    await prisma.$transaction(
      async (tx) => {
        await tx.clientSpocAssignment.updateMany({
          where: { spocId: { in: ids }, endedAt: null },
          data: { endedAt: now },
        });
        await tx.clientSpocAssignment.createMany({
          data: ids.map((spocId) => ({
            spocId,
            assignedToId: assignToId,
            assignedById: req.user.id,
            reason: reason ?? null,
            assignedAt: now,
          })),
        });
        await tx.clientSpoc.updateMany({
          where: { id: { in: ids } },
          data: { handlerId: assignToId },
        });

        for (const s of eligible) {
          await logClientActivity(tx, {
            clientId: s.clientId,
            spocId: s.id,
            actorId: req.user.id,
            type: "SPOC_REASSIGNED",
            summary: `SPOC ${`${s.firstName} ${s.lastName ?? ""}`.trim()} reassigned`,
            meta: {
              fromUserId: s.handlerId,
              toUserId: assignToId,
              reason: reason ?? null,
              bulk: true,
            },
          });
        }

        const first = eligible[0]!;
        await notifyUsers(tx, [assignToId], req.user.id, {
          type: "SPOC_ASSIGNED",
          title:
            eligible.length === 1
              ? `SPOC assigned to you: ${`${first.firstName} ${first.lastName ?? ""}`.trim()}`
              : `${eligible.length} SPOCs assigned to you`,
          body: reason ?? null,
          referenceId: first.id,
          referenceType: "SPOC",
        });
      },
      { timeout: 30_000 }, // up to 200 activity rows
    );
  }

  res.json({
    success: true,
    message: `${eligible.length} SPOC${eligible.length === 1 ? "" : "s"} reassigned`,
    data: { updated: eligible.length, skipped },
  });
};

// ── POST /spocs/approval — a person decides who gets outreach
export const decideSpocApproval = async (req: Request, res: Response) => {
  const body = req.validatedBody as SpocApprovalInput;

  const spocs = await prisma.clientSpoc.findMany({
    where: {
      id: { in: body.spocIds },
      isActive: true,
      ...(await spocScopeWhere(req.user, req.scope!)),
    },
    select: { id: true, clientId: true, firstName: true, lastName: true, approvalStatus: true },
  });

  const changed = spocs.filter((s) => s.approvalStatus !== body.decision);
  const decided = body.decision !== "PENDING";

  await prisma.$transaction(async (tx) => {
    await tx.clientSpoc.updateMany({
      where: { id: { in: changed.map((s) => s.id) } },
      data: {
        approvalStatus: body.decision,
        approvedById: decided ? req.user.id : null,
        approvedAt: decided ? new Date() : null,
        approvalNote: body.note ?? null,
      },
    });

    for (const s of changed) {
      if (!decided) continue;
      await logClientActivity(tx, {
        clientId: s.clientId,
        spocId: s.id,
        actorId: req.user.id,
        type: body.decision === "APPROVED" ? "SPOC_APPROVED" : "SPOC_REJECTED",
        summary: `${`${s.firstName} ${s.lastName ?? ""}`.trim()} ${body.decision === "APPROVED" ? "approved" : "rejected"} for outreach`,
        ...(body.note && { meta: { note: body.note } }),
      });
    }
  });

  res.json({
    success: true,
    message: `${changed.length} SPOC(s) set to ${body.decision.toLowerCase()}`,
    data: {
      updated: changed.length,
      unchanged: spocs.length - changed.length,
      notFound: body.spocIds.length - spocs.length, // out of scope or inactive
    },
  });
};
