// File: spoc.controller.ts
// Path: src/controller/spoc.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { assertFillOnly, assertSuperAdmin } from "@/services/editLock.service";
import { getReportingLineIds, isUserInScope, spocScopeWhere } from "@/services/scope.service";
import { assertLookupIds, assertLookups } from "@/services/lookup.service";
import { logClientActivity } from "@/services/clientActivity.service";
import { toNameKey } from "@/utils/names";
import { notifyUsers } from "@/services/notification.service";
import type { PermissionMap } from "@/services/permission.service";
import { definedOnly, pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError, notFound } from "@/utils/httpError";
import { linkSpocPersons, otherRoles, syncPersonFromSpoc } from "@/services/person.service";
import type {
  BulkAssignSpocsInput,
  BulkUpdateSpocsInput,
  CreateSpocInput,
  ListSpocsQuery,
  SpocApprovalInput,
  UpdateSpocInput,
} from "@/validators/client.validators";

const PERSON = { id: true, firstName: true, lastName: true } as const;
const LOOKUP = { id: true, code: true, label: true } as const;

const SPOC_SELECT = {
  id: true,
  // the human behind this role — one person can be a SPOC at several clients (send to a person once)
  personId: true,
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
  // sales marks
  erp: true,
  dataFlag: true,
  dataFlagAt: true,
  dataFlagBy: { select: PERSON },
  keyAccountUser: { select: PERSON },
  projectIds: true,
  projectSetAt: true,
  projectSetBy: { select: PERSON },
  // CASPA SPOC profile
  phone2: true,
  phone3: true,
  state: true,
  district: true,
  city: true,
  pincode: true,
  address: true,
  callConnected: true,
  roleCategory: { select: LOOKUP },
  decisionAuthority: { select: LOOKUP },
  orgType: { select: LOOKUP },
  revenueBand: { select: LOOKUP },
} as const satisfies Prisma.ClientSpocSelect;

// field names as people say them, for the timeline ("Updated mobile 2, city")
const FIELD_LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  phone: "mobile",
  phone2: "mobile 2",
  phone3: "mobile 3",
  linkedinUrl: "LinkedIn",
  totalExpYears: "total experience",
  currentOrgExpYears: "experience at this org",
  businessUnitId: "business unit",
  serviceLineId: "service line",
  locationId: "office",
  sourceId: "source",
  emailSourceId: "email source",
  isPrimary: "primary SPOC",
  erp: "ERP",
  dataFlag: "data flag",
  projectIds: "projects",
  callConnected: "call connected",
  roleCategoryId: "role category",
  decisionAuthorityId: "decision authority",
  orgTypeId: "organization type",
  revenueBandId: "SPOC revenue",
};
const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

const fullNameOf = (p: { firstName: string; lastName: string | null }) => `${p.firstName} ${p.lastName ?? ""}`.trim();

// who set a mark and when — stamped whenever the mark itself is sent
const markStamps = (
  body: { dataFlag?: unknown; projectIds?: unknown },
  userId: string,
): Prisma.ClientSpocUncheckedUpdateInput => {
  const now = new Date();
  return {
    ...(body.dataFlag !== undefined && { dataFlagById: body.dataFlag ? userId : null, dataFlagAt: body.dataFlag ? now : null }),
    ...(body.projectIds !== undefined && { projectSetById: userId, projectSetAt: now }),
  };
};

// ── field mask ───────────────────────────────────────────────────────────────

export const toSpocResponse = <T extends { email: string | null; phone: string | null }>(
  spoc: T,
  map: PermissionMap,
): T =>
  map["spocs.view_contact"]
    ? spoc
    : { ...spoc, email: null, phone: null, ...("phone2" in spoc && { phone2: null, phone3: null }) };

const spocLookups = (body: UpdateSpocInput) =>
  assertLookups({
    sourceId: [body.sourceId, "SPOC_SOURCE"],
    emailSourceId: [body.emailSourceId, "EMAIL_SOURCE"],
    salesStatusId: [body.salesStatusId, "SALES_STATUS"],
    roleCategoryId: [body.roleCategoryId, "SPOC_ROLE"],
    decisionAuthorityId: [body.decisionAuthorityId, "DECISION_AUTHORITY"],
    orgTypeId: [body.orgTypeId, "ORG_TYPE"],
    revenueBandId: [body.revenueBandId, "REVENUE_BAND"],
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

// data flag filter; with none picked, "both wrong" SPOCs stay out of lists (as in CASPA)
const dataFlagWhere = (picked: ListSpocsQuery["dataFlag"]): Prisma.ClientSpocWhereInput => {
  if (!picked?.length) return { OR: [{ dataFlag: null }, { dataFlag: { not: "BOTH_WRONG" } }] };
  const flags = picked.filter((f): f is Exclude<typeof f, "NONE"> => f !== "NONE");
  return {
    OR: [...(picked.includes("NONE") ? [{ dataFlag: null }] : []), ...(flags.length ? [{ dataFlag: { in: flags } }] : [])],
  };
};

// the list filters — shared by GET /spocs and GET /spocs/stats
/** who is asking: the route's req, or the assistant with the user's spocs.read grant */
export type Asker = { user: Request["user"]; scope?: Request["scope"] | true | null | undefined };
const scopeOf = async (who: Asker) => (who.scope === true || who.scope == null ? {} : spocScopeWhere(who.user, who.scope));

const spocListWhere = async (req: Asker, q: ListSpocsQuery): Promise<Prisma.ClientSpocWhereInput> => ({
    AND: [
      await scopeOf(req),
      {
        isActive: q.isActive,
        client: { deletedAt: null },
        ...(q.clientId && { clientId: q.clientId }),
        ...(q.handlerId?.length && { handlerId: { in: q.handlerId } }),
        // phone app's Mine / My team
        ...(q.handledBy === "me" && { handlerId: req.user.id }),
        ...(q.handledBy === "team" && { handlerId: { in: [req.user.id, ...(await getReportingLineIds(req.user.id))] } }),
        ...(q.businessUnitId?.length && { businessUnitId: { in: q.businessUnitId } }),
        ...(q.serviceLineId?.length && { serviceLineId: { in: q.serviceLineId } }),
        ...(q.salesStatusId?.length && { salesStatusId: { in: q.salesStatusId } }),
        ...(q.emailStatus?.length && { emailStatus: { in: q.emailStatus } }),
        ...(q.validationBand?.length && { validationBand: { in: q.validationBand } }),
        ...(q.approvalStatus?.length && { approvalStatus: { in: q.approvalStatus } }),
        ...(q.reviewFlag !== undefined && { reviewFlag: q.reviewFlag }),
        ...(q.keyAccount === "me" && { keyAccountUserId: req.user.id }),
        ...(q.keyAccount === "any" && { keyAccountUserId: { not: null } }),
        ...(q.keyAccount === "none" && { keyAccountUserId: null }),
        ...(q.projectId?.length && { projectIds: { hasSome: q.projectId } }),
        ...(q.erp && { erp: { contains: q.erp, mode: "insensitive" } }),
        ...(q.search && {
          OR: (["firstName", "lastName", "email", "designation"] as const).map((field) => ({
            [field]: { contains: q.search, mode: "insensitive" },
          })),
        }),
      },
      dataFlagWhere(q.dataFlag),
    ],
});

// ── GET /spocs
export const listSpocs = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListSpocsQuery;
  const where = await spocListWhere(req, q);

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

  // the same person's roles at other clients ("Also works with") — only clients this user may see
  const alsoWorksWith = await otherRoles(id, await spocScopeWhere(req.user, req.scope!));
  res.json({ success: true, data: { ...toSpocResponse(spoc, req.permissions!), alsoWorksWith } });
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
  await assertLookupIds(body.projectIds, "PROJECT", "projectIds");
  await assertLocation(client.id, body.locationId);
  await assertEmailFreeAtClient(client.id, body.email);

  const spoc = await prisma.$transaction(async (tx) => {
    const s = await tx.clientSpoc.create({
      data: {
        ...definedOnly(body),
        ...(markStamps(body, req.user.id) as object),
        tenantId: req.user.tenantId,
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
  // the human behind it — an existing person when their personal email / name + mobile is already known
  await linkSpocPersons([spoc.id]);

  res.status(201).json({
    success: true,
    message: "SPOC added",
    data: toSpocResponse(spoc, req.permissions!),
  });
};

// ── PATCH /spocs/:id
/** one email = one SPOC row per client (the same person at another client is another row of the same Person) */
const assertEmailFreeAtClient = async (clientId: string, email?: string | null, exceptId?: string) => {
  const e = email?.trim();
  if (!e) return;
  const taken = await prisma.clientSpoc.findFirst({
    where: { clientId, isActive: true, email: { equals: e, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) },
    select: { firstName: true, lastName: true },
  });
  if (taken) throw ApiError(409, `${[taken.firstName, taken.lastName].filter(Boolean).join(" ")} at this client already has that email`, "DUPLICATE_EMAIL");
};

/** changeable by anyone allowed to update SPOCs — the rest is data (fill-only unless super admin) */
const SPOC_WORK_FIELDS = ["salesStatusId", "callConnected", "dataFlag", "isPrimary", "notes", "projectIds", "projectMode"] as const;

export const updateSpoc = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateSpocInput;

  const existing = await findSpocInScope(req, id);
  // filled contact data: only a super admin changes it; sales status / call status / flags / notes are work
  const full = await prisma.clientSpoc.findUnique({ where: { id } });
  if (full) assertFillOnly(req.user, full, body, SPOC_WORK_FIELDS);
  await spocLookups(body);
  await assertLookupIds(body.projectIds, "PROJECT", "projectIds");
  await assertLocation(existing.clientId, body.locationId);
  if (body.email !== undefined) await assertEmailFreeAtClient(existing.clientId, body.email, id);

  const data: Prisma.ClientSpocUncheckedUpdateInput = definedOnly(body);
  const stamps = markStamps(body, req.user.id);

  if (body.firstName !== undefined || body.lastName !== undefined) {
    data.nameKey = toNameKey(
      body.firstName ?? existing.firstName,
      body.lastName !== undefined ? body.lastName : existing.lastName,
    );
  }

  // status history: CASPA overwrote the status; here every change is a timeline row
  const before =
    body.salesStatusId !== undefined
      ? await prisma.clientSpoc.findUnique({
          where: { id },
          select: { salesStatusId: true, salesStatus: { select: { label: true } } },
        })
      : null;
  const statusChanged = !!before && before.salesStatusId !== (body.salesStatusId ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.clientSpoc.update({ where: { id }, data: { ...data, ...stamps }, select: SPOC_SELECT });

    if (statusChanged) {
      await logClientActivity(tx, {
        clientId: existing.clientId,
        spocId: id,
        actorId: req.user.id,
        type: "SALES_STATUS_CHANGED",
        summary: `${before!.salesStatus?.label ?? "No status"} → ${s.salesStatus?.label ?? "No status"}`,
        meta: { from: before!.salesStatusId, to: s.salesStatus?.id ?? null },
      });
    }
    const others = Object.keys(data).filter((k) => k !== "nameKey" && k !== "salesStatusId");
    if (others.length) {
      await logClientActivity(tx, {
        clientId: existing.clientId,
        spocId: id,
        actorId: req.user.id,
        type: "SPOC_UPDATED",
        summary: `Updated ${others.map(fieldLabel).join(", ")}`,
      });
    }

    return s;
  });
  // same human, other clients: their name / email / phone / LinkedIn follow
  await syncPersonFromSpoc(id, {
    firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone, linkedinUrl: body.linkedinUrl,
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
  assertSuperAdmin(req.user, "delete a SPOC");
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

// ── POST /spocs/:id/key-account — star / unstar for me. One holder per SPOC:
// someone else's star is locked (an admin can take it over).
export const toggleSpocKeyAccount = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const spoc = await findSpocInScope(req, id);
  const current = await prisma.clientSpoc.findUnique({
    where: { id },
    select: { keyAccountUserId: true, keyAccountUser: { select: PERSON } },
  });
  const mine = current?.keyAccountUserId === req.user.id;
  if (current?.keyAccountUserId && !mine && !req.user.isSuperAdmin) {
    throw ApiError(409, `Key account of ${fullNameOf(current.keyAccountUser!)}`, "KEY_ACCOUNT_TAKEN");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.clientSpoc.update({
      where: { id },
      data: { keyAccountUserId: mine ? null : req.user.id },
      select: SPOC_SELECT,
    });
    await logClientActivity(tx, {
      clientId: spoc.clientId,
      spocId: id,
      actorId: req.user.id,
      type: "SPOC_UPDATED",
      summary: `${fullNameOf(spoc)} ${mine ? "removed from" : "marked as"} key account`,
    });
    return s;
  });

  res.json({
    success: true,
    message: mine ? "Key account removed" : "Marked as your key account",
    data: toSpocResponse(updated, req.permissions!),
  });
};

// ── PATCH /spocs/bulk-update — set status / data flag / ERP / projects on many
export const bulkUpdateSpocs = async (req: Request, res: Response) => {
  const body = req.validatedBody as BulkUpdateSpocsInput;
  await assertLookups({ salesStatusId: [body.salesStatusId, "SALES_STATUS"] });
  if (body.projectIds) await assertLookupIds(body.projectIds, "PROJECT", "projectIds");

  const found = await prisma.clientSpoc.findMany({
    where: { id: { in: body.spocIds }, ...(await spocScopeWhere(req.user, req.scope!)) },
    select: { id: true, clientId: true, firstName: true, lastName: true, isActive: true, projectIds: true, erp: true },
  });
  // ERP is data: a non-super-admin only fills it where it is empty
  if (body.erp !== undefined && !req.user.isSuperAdmin && found.some((s) => s.erp && s.erp !== body.erp)) {
    throw ApiError(403, "Only a super admin can change an ERP that is already filled. Pick only SPOCs without one.", "EDIT_LOCKED");
  }
  const byId = new Map(found.map((s) => [s.id, s]));
  const skipped: { id: string; reason: string }[] = [];
  const eligible: typeof found = [];
  for (const id of body.spocIds) {
    const s = byId.get(id);
    if (!s) skipped.push({ id, reason: "SPOC not found" });
    else if (!s.isActive) skipped.push({ id, reason: "SPOC is inactive" });
    else eligible.push(s);
  }

  const base: Prisma.ClientSpocUncheckedUpdateInput = {
    ...(body.salesStatusId !== undefined && { salesStatusId: body.salesStatusId }),
    ...(body.dataFlag !== undefined && { dataFlag: body.dataFlag }),
    ...(body.erp !== undefined && { erp: body.erp }),
    ...markStamps(body, req.user.id),
  };
  const fields = [
    body.salesStatusId !== undefined && "sales status",
    body.dataFlag !== undefined && "data flag",
    body.erp !== undefined && "ERP",
    body.projectIds !== undefined && "projects",
  ].filter(Boolean).join(", ");

  const nextProjects = (had: string[]) => {
    const picked = body.projectIds!;
    if (body.projectMode === "replace") return picked;
    if (body.projectMode === "remove") return had.filter((p) => !picked.includes(p));
    return [...new Set([...had, ...picked])];
  };

  if (eligible.length) {
    await prisma.$transaction(
      async (tx) => {
        if (body.projectIds === undefined) {
          await tx.clientSpoc.updateMany({ where: { id: { in: eligible.map((s) => s.id) } }, data: base as Prisma.ClientSpocUncheckedUpdateManyInput });
        } else {
          // projects merge per SPOC (add / remove keep the others)
          for (const s of eligible) {
            await tx.clientSpoc.update({ where: { id: s.id }, data: { ...base, projectIds: nextProjects(s.projectIds) } });
          }
        }
        for (const s of eligible) {
          await logClientActivity(tx, {
            clientId: s.clientId,
            spocId: s.id,
            actorId: req.user.id,
            type: "SPOC_UPDATED",
            summary: `Updated ${fields} on ${fullNameOf(s)}`,
            meta: { bulk: true },
          });
        }
      },
      { timeout: 30_000 },
    );
  }

  res.json({
    success: true,
    message: `${eligible.length} SPOC${eligible.length === 1 ? "" : "s"} updated`,
    data: { updated: eligible.length, skipped },
  });
};

// ── GET /spocs/stats — counts for the Stats view, same filters as the list.
// One light query, counted in memory (a tenant has thousands of SPOCs, not millions).
const STATS_CAP = 50_000;
export const computeSpocStats = async (who: Asker, q: ListSpocsQuery) => {
  const where = await spocListWhere(who, q);
  const rows = await prisma.clientSpoc.findMany({
    where,
    take: STATS_CAP,
    select: {
      clientId: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      designation: true,
      approvalStatus: true,
      validationBand: true,
      emailStatus: true,
      dataFlag: true,
      keyAccountUserId: true,
      projectIds: true,
      salesStatus: { select: { id: true, label: true } },
      handler: { select: PERSON },
      businessUnit: { select: { id: true, name: true } },
      location: { select: { state: true } },
      client: {
        select: {
          category: { select: { id: true, label: true } },
          locations: { where: { isPrimary: true, isActive: true }, select: { state: true }, take: 1 },
        },
      },
    },
  });

  type Bucket = { key: string; label: string; count: number };
  const tally = () => new Map<string, Bucket>();
  const add = (m: Map<string, Bucket>, key: string | null | undefined, label: string | null | undefined) => {
    const k = key ?? "_none";
    const b = m.get(k) ?? { key: k, label: key ? (label ?? key) : "Not set", count: 0 };
    b.count++;
    m.set(k, b);
  };
  const by = {
    salesStatus: tally(),
    category: tally(),
    state: tally(),
    handler: tally(),
    businessUnit: tally(),
    approval: tally(),
    band: tally(),
  };
  const clients = new Set<string>();
  const has = { email: 0, phone: 0, linkedin: 0, designation: 0, salesStatus: 0, location: 0 };
  let keyAccounts = 0;
  let flagged = 0;
  let withProjects = 0;

  for (const r of rows) {
    clients.add(r.clientId);
    if (r.email) has.email++;
    if (r.phone) has.phone++;
    if (r.linkedinUrl) has.linkedin++;
    if (r.designation) has.designation++;
    if (r.salesStatus) has.salesStatus++;
    const state = (r.location?.state ?? r.client.locations[0]?.state ?? "").trim();
    if (state) has.location++;
    if (r.keyAccountUserId) keyAccounts++;
    if (r.dataFlag) flagged++;
    if (r.projectIds.length) withProjects++;
    add(by.salesStatus, r.salesStatus?.id, r.salesStatus?.label);
    add(by.category, r.client.category?.id, r.client.category?.label);
    add(by.state, state ? state.toLowerCase() : null, state);
    add(by.handler, r.handler.id, fullNameOf(r.handler));
    add(by.businessUnit, r.businessUnit.id, r.businessUnit.name);
    add(by.approval, r.approvalStatus, r.approvalStatus);
    add(by.band, r.validationBand, r.validationBand);
  }
  const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    capped: rows.length === STATS_CAP,
    clients: clients.size,
    keyAccounts,
    flagged,
    withProjects,
    has,
    by: Object.fromEntries(Object.entries(by).map(([k, m]) => [k, sorted(m)])) as Record<keyof typeof by, Bucket[]>,
  };
};

/** ids of the SPOCs a list filter shows (for an AI action on "these"), capped */
export const spocIdsFor = async (who: Asker, q: ListSpocsQuery, cap: number) => {
  const where = await spocListWhere(who, q);
  const [total, rows] = await Promise.all([
    prisma.clientSpoc.count({ where }),
    prisma.clientSpoc.findMany({ where, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" }, take: cap }),
  ]);
  return { total, rows: rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName ?? ""}`.trim() })) };
};

export const spocStats = async (req: Request, res: Response) => {
  res.json({ success: true, data: await computeSpocStats(req, req.validatedQuery as ListSpocsQuery) });
};
