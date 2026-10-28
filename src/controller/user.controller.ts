// File: user.controller.ts
// Path: src/controller/user.controller.ts

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";
import prisma from "@/utils/prisma/client";
import { getReportingLineIds, userScopeWhere } from "@/services/scope.service";
import { logAuthEvent } from "@/services/authLog.service";
import { sendMail } from "@/utils/mailer";
import { getUserPermissionMap } from "@/services/permission.service";
import { forbidden, grantScope } from "@/services/grant.service";
import { definedOnly, pageMeta, toSkipTake } from "@/utils/pagination";
import { ApiError, notFound } from "@/utils/httpError";
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
  UserOptionsQuery,
} from "@/validators/user.validators";

const PERSON = { id: true, firstName: true, lastName: true, employeeId: true } as const satisfies Prisma.UserSelect;

const USER_LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
  employeeId: true,
  phone: true,
  workingLocation: true,
  isActive: true,
  isSuperAdmin: true,
  dateOfJoin: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  reportingTo: { select: PERSON },
  teamLead: { select: PERSON },
  _count: {
    select: {
      subordinates: true,
      teamMembers: true,
      spocsHandled: { where: { isActive: true } },
    },
  },
} as const satisfies Prisma.UserSelect;

const USER_DETAIL_SELECT = {
  ...USER_LIST_SELECT,
  middleName: true,
  timezone: true,
  dateOfBirth: true,
  updatedAt: true,
  createdBy: { select: PERSON },
  businessUnits: { select: { businessUnit: { select: { id: true, name: true } } } },
  serviceLines: { select: { serviceLine: { select: { id: true, name: true } } } },
  subordinates: { where: { isActive: true }, select: PERSON, orderBy: { firstName: "asc" } },
  teamMembers: { where: { isActive: true }, select: PERSON, orderBy: { firstName: "asc" } },
} as const satisfies Prisma.UserSelect;

// non-super-admins can't create, edit or reset a super admin
const assertCanManage = (actor: Request["user"], target: { isSuperAdmin: boolean }) => {
  if (target.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError(403, "Only a super admin can manage a super admin", "FORBIDDEN");
  }
};

// ── GET /users
export const listUsers = async (req: Request, res: Response) => {
  const q = req.validatedQuery as ListUsersQuery;

  const where: Prisma.UserWhereInput = {
    AND: [
      await userScopeWhere(req.user, req.scope!),
      {
        ...(q.isActive !== undefined && { isActive: q.isActive }),
        ...(q.roleId?.length && { roleId: { in: q.roleId } }),
        ...(q.departmentId?.length && { departmentId: { in: q.departmentId } }),
        ...(q.designationId?.length && { designationId: { in: q.designationId } }),
        ...(q.reportingToId?.length && { reportingToId: { in: q.reportingToId } }),
        ...(q.teamLeadId?.length && { teamLeadId: { in: q.teamLeadId } }),
        ...(q.businessUnitId?.length && {
          businessUnits: { some: { businessUnitId: { in: q.businessUnitId } } },
        }),
        ...(q.serviceLineId?.length && {
          serviceLines: { some: { serviceLineId: { in: q.serviceLineId } } },
        }),
        ...(q.search && {
          OR: (["firstName", "lastName", "email", "employeeId", "phone"] as const).map(
            (field) => ({ [field]: { contains: q.search, mode: "insensitive" } }),
          ),
        }),
      },
    ],
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: USER_LIST_SELECT,
      orderBy: { [q.sortBy]: q.sortDir },
      ...toSkipTake(q),
    }),
  ]);

  res.json({ success: true, data: users, meta: pageMeta(total, q.page, q.limit) });
};

// ── GET /users/:id — out of scope = 404
export const getUserById = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const user = await prisma.user.findFirst({
    where: { id, ...(await userScopeWhere(req.user, req.scope!)) },
    select: USER_DETAIL_SELECT,
  });
  if (!user) throw notFound("User");

  res.json({ success: true, data: user });
};

// ── POST /users — creates the account and mails a set-password link
export const createUser = async (req: Request, res: Response) => {
  const body = req.validatedBody as CreateUserInput;
  assertCanManage(req.user, body);

  const { businessUnitIds, serviceLineIds, ...fields } = body;

  // user sets the real password from the link — reuses the reset-token fields
  const setupToken = crypto.randomBytes(32).toString("hex");
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        ...definedOnly(fields),
        passwordHash: placeholderHash,
        createdById: req.user.id,
        resetPasswordToken: setupToken,
        resetPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        businessUnits: { create: businessUnitIds.map((businessUnitId) => ({ businessUnitId })) },
        serviceLines: { create: serviceLineIds.map((serviceLineId) => ({ serviceLineId })) },
      },
      select: USER_LIST_SELECT,
    });

    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "CREATE",
        module: "users",
        recordId: u.id,
        newData: body,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    return u;
  });

  await logAuthEvent(user.id, "ACCOUNT_CREATED", req);

  // outside the transaction — a mail failure must not roll back the user
  try {
    const setupUrl = `${process.env.FRONTEND_URL}/sign-in?token=${setupToken}`;
    await sendMail({
      to: user.email,
      subject: "Welcome — Set up your password",
      html: `
        <h2>Welcome to the team, ${user.firstName}!</h2>
        <p>Your account has been created. Click below to set your password and get started:</p>
        <a href="${setupUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
          Set Your Password
        </a>
        <p style="color:#6B7280;font-size:14px;">This link expires in 24 hours. If you weren't expecting this email, you can ignore it.</p>
      `,
    });
  } catch (mailErr) {
    console.error("createUser: welcome email failed:", mailErr);
  }

  res.status(201).json({
    success: true,
    message: "User created. A password setup email has been sent.",
    data: user,
  });
};

// ── PUT /users/:id
export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const body = req.validatedBody as UpdateUserInput;

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { isSuperAdmin: true },
  });
  if (!existing) throw notFound("User");
  assertCanManage(req.user, existing);
  if (body.isSuperAdmin !== undefined) assertCanManage(req.user, { isSuperAdmin: true });

  if (body.reportingToId) {
    if (body.reportingToId === id) {
      throw ApiError(400, "User cannot report to themselves", "REPORTING_CYCLE");
    }
    if ((await getReportingLineIds(id)).includes(body.reportingToId)) {
      throw ApiError(400, "Circular reporting chain detected", "REPORTING_CYCLE");
    }
  }
  if (body.teamLeadId && body.teamLeadId === id) {
    throw ApiError(400, "User cannot be their own team lead", "TEAM_LEAD_SELF");
  }

  const { businessUnitIds, serviceLineIds, ...fields } = body;
  const data = definedOnly(fields);

  const updated = await prisma.$transaction(async (tx) => {
    if (businessUnitIds) {
      await tx.userBusinessUnit.deleteMany({ where: { userId: id } });
      await tx.userBusinessUnit.createMany({
        data: businessUnitIds.map((businessUnitId) => ({ userId: id, businessUnitId })),
      });
    }
    if (serviceLineIds) {
      await tx.userServiceLine.deleteMany({ where: { userId: id } });
      await tx.userServiceLine.createMany({
        data: serviceLineIds.map((serviceLineId) => ({ userId: id, serviceLineId })),
      });
    }

    const u = await tx.user.update({ where: { id }, data, select: USER_DETAIL_SELECT });

    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "UPDATE",
        module: "users",
        recordId: id,
        newData: body,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    return u;
  });

  res.json({ success: true, message: "User updated", data: updated });
};

// ── PATCH /users/:id/toggle — deactivating also kills their sessions
export const toggleUser = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  if (id === req.user.id) throw ApiError(400, "Cannot deactivate yourself", "SELF");

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { isActive: true, isSuperAdmin: true },
  });
  if (!existing) throw notFound("User");
  if (existing.isSuperAdmin) {
    throw ApiError(400, "Cannot deactivate a super admin", "SUPER_ADMIN");
  }

  const isActive = !existing.isActive;
  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    }),
    ...(isActive ? [] : [prisma.refreshToken.deleteMany({ where: { userId: id } })]),
  ]);

  await logAuthEvent(id, isActive ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED", req);

  res.json({
    success: true,
    message: `User ${isActive ? "activated" : "deactivated"}`,
    data: updated,
  });
};

// ── PATCH /users/:id/reset-password — admin sets a password, all sessions end
export const adminResetPassword = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const { newPassword } = req.validatedBody;

  if (id === req.user.id) {
    throw ApiError(400, "Use change-password to update your own password", "SELF_RESET");
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { firstName: true, lastName: true, isActive: true, isSuperAdmin: true },
  });
  if (!target) throw notFound("User");
  assertCanManage(req.user, target);
  if (!target.isActive) {
    throw ApiError(400, "Cannot reset password for an inactive user", "USER_INACTIVE");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: id } }),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "ADMIN_RESET_PASSWORD",
        module: "users",
        recordId: id,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    }),
  ]);

  await logAuthEvent(id, "PASSWORD_RESET", req);

  res.json({
    success: true,
    message: `Password reset for ${target.firstName} ${target.lastName}. All sessions invalidated.`,
  });
};

// ── GET /users/options — picker rows; scope depends on what the list is for
//   assign → spocs.assign scope (403 without it); client_assign → clients.assign
//   filter → spocs.read scope, else users.read, else just the caller
export const listUserOptions = async (req: Request, res: Response) => {
  const q = req.validatedQuery as UserOptionsQuery;
  const map = await getUserPermissionMap(req.user);

  let scopeWhere: Prisma.UserWhereInput;
  if (q.for === "assign" || q.for === "client_assign") {
    const key = q.for === "assign" ? "spocs.assign" : "clients.assign";
    const scope = grantScope(map, key);
    if (!scope) throw forbidden([key]);
    scopeWhere = await userScopeWhere(req.user, scope);
  } else {
    const scope = grantScope(map, "spocs.read") ?? grantScope(map, "users.read");
    scopeWhere = scope ? await userScopeWhere(req.user, scope) : { id: req.user.id };
  }

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      AND: [
        scopeWhere,
        q.search
          ? {
              OR: (["firstName", "lastName", "email", "employeeId"] as const).map((field) => ({
                [field]: { contains: q.search, mode: "insensitive" },
              })),
            }
          : {},
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employeeId: true,
      designation: { select: { id: true, name: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: q.limit,
  });

  res.json({ success: true, data: users });
};
